const { fal } = require('@fal-ai/client');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Types supportés :
  // 'image'      → Text → Image (Flux Schnell)
  // 'video'      → Text → Vidéo (Kling 3.0)
  // 'img2video'  → Image → Vidéo (Kling 3.0)
  // 'actor'      → Photo → Acteur principal (Kling 3.0 elements)

  const {
    prompt,
    type = 'image',
    userId,
    imageBase64,
    imageMimeType,
    duration = 5,        // 5, 10 ou 15 secondes
    universe = 'action', // pour le mode actor: action, scifi, fantasy, thriller
    withAudio = true,    // son activé par défaut
  } = req.body;

  if (!prompt && type !== 'img2video') return res.status(400).json({ error: 'Prompt requis' });
  if (!userId) return res.status(400).json({ error: 'userId requis' });

  const FAL_KEY = process.env.FAL_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const APP_URL = 'https://gladiator-ai-rho.vercel.app';

  fal.config({ credentials: FAL_KEY });

  // Coût en crédits selon le type et la durée (audio = +20%)
  const getCreditCost = (type, duration, withAudio) => {
    if (type === 'image') return 1;
    let base = 0;
    if (duration <= 5)  base = 5;
    else if (duration <= 10) base = 10;
    else base = 15;
    return withAudio ? Math.ceil(base * 1.2) : base;
  };
  const creditCost = getCreditCost(type, duration, withAudio);

  // Vérifier et déduire les crédits
  const getRes = await fetch(`${SUPABASE_URL}/rest/v1/user_credits?user_id=eq.${userId}&select=credits`, {
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` }
  });
  const data = await getRes.json();
  const current = data?.[0]?.credits || 0;

  if (current < creditCost) return res.status(402).json({ error: 'Credits insuffisants' });

  await fetch(`${SUPABASE_URL}/rest/v1/user_credits?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ credits: current - creditCost })
  });

  const refund = async () => {
    await fetch(`${SUPABASE_URL}/rest/v1/user_credits?user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ credits: current })
    });
  };

  try {
    // Traduction automatique du prompt en anglais
    let enhancedPrompt = prompt || 'Animate this scene with smooth cinematic motion';
    try {
      const transRes = await fetch('https://translate.argosopentech.com/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: enhancedPrompt, source: 'auto', target: 'en', format: 'text' })
      });
      const transData = await transRes.json();
      if (transData.translatedText) enhancedPrompt = transData.translatedText;
    } catch(e) {}

    const webhookUrl = `${APP_URL}/api/webhook-fal?userId=${userId}&type=${type}`;
    const durationStr = String(duration); // Kling attend une string "5", "10", "15"

    // ─── MODE 1 : TEXT → IMAGE ───────────────────────────────────────────────
    if (type === 'image') {
      const fullPrompt = enhancedPrompt + ', cinematic, 4K, highly detailed';
      const response = await fetch('https://fal.run/fal-ai/flux/schnell', {
        method: 'POST',
        headers: { 'Authorization': 'Key ' + FAL_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: fullPrompt, image_size: 'landscape_16_9', num_images: 1 })
      });
      const result = await response.json();
      if (!response.ok) { await refund(); return res.status(500).json({ error: 'Erreur FAL image', details: result }); }
      const url = result.images?.[0]?.url || result.url;
      if (!url) { await refund(); return res.status(500).json({ error: 'Pas URL image', raw: result }); }
      return res.status(200).json({ url, creditsLeft: current - creditCost });
    }

    // ─── MODE 2 : TEXT → VIDÉO ───────────────────────────────────────────────
    if (type === 'video') {
      const fullPrompt = enhancedPrompt + ', cinematic shot, photorealistic, 4K, smooth motion, dramatic lighting';
      const { request_id } = await fal.queue.submit('fal-ai/kling-video/v3/pro/text-to-video', {
        input: {
          prompt: fullPrompt,
          duration: durationStr,
          aspect_ratio: '16:9',
          generate_audio: withAudio,
          negative_prompt: 'blur, distort, low quality, watermark',
          cfg_scale: 0.5,
        },
        webhookUrl
      });
      return res.status(200).json({ status: 'processing', request_id, creditsLeft: current - creditCost });
    }

    // ─── MODE 3 : IMAGE → VIDÉO ──────────────────────────────────────────────
    if (type === 'img2video') {
      if (!imageBase64) { await refund(); return res.status(400).json({ error: 'imageBase64 manquant' }); }

      const mimeType = imageMimeType || 'image/jpeg';
      const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
      const imageBuffer = Buffer.from(base64Data, 'base64');
      const imageFile = new File([imageBuffer], 'input.jpg', { type: mimeType });
      const publicImageUrl = await fal.storage.upload(imageFile);

      const fullPrompt = (enhancedPrompt || 'Animate this image with smooth cinematic motion') + ', photorealistic, smooth motion, cinematic';

      const { request_id } = await fal.queue.submit('fal-ai/kling-video/v3/pro/image-to-video', {
        input: {
          start_image_url: publicImageUrl,
          prompt: fullPrompt,
          duration: durationStr,
          aspect_ratio: '16:9',
          generate_audio: withAudio,
          negative_prompt: 'blur, distort, low quality, watermark',
          cfg_scale: 0.5,
        },
        webhookUrl
      });
      return res.status(200).json({ status: 'processing', request_id, creditsLeft: current - creditCost });
    }

    // ─── MODE 4 : PHOTO → ACTEUR PRINCIPAL ───────────────────────────────────
    if (type === 'actor') {
      if (!imageBase64) { await refund(); return res.status(400).json({ error: 'imageBase64 manquant pour le mode acteur' }); }

      // Upload la photo de l'utilisateur
      const mimeType = imageMimeType || 'image/jpeg';
      const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
      const imageBuffer = Buffer.from(base64Data, 'base64');
      const imageFile = new File([imageBuffer], 'actor.jpg', { type: mimeType });
      const actorImageUrl = await fal.storage.upload(imageFile);

      // Prompts cinématiques par univers
      const universePrompts = {
        action: '@Actor1 is the main hero in an explosive action movie scene. Running through a burning city under attack, dodging explosions and debris. Military gear, intense slow-motion, cinematic wide shot, dramatic lighting, 4K',
        scifi: '@Actor1 is the protagonist of a sci-fi blockbuster. Standing on the bridge of a massive spaceship, stars and a nebula visible through the window. Futuristic suit, epic lighting, cinematic, 4K',
        fantasy: '@Actor1 is a legendary warrior in an epic fantasy world. Standing before a dragon in a magical forest, glowing sword raised, dramatic golden light, cinematic 4K shot',
        thriller: '@Actor1 is a secret agent in a high-stakes thriller. Running through rainy neon-lit streets at night, pursued by shadows, trench coat, cinematic tension, 4K',
      };

      const actorPrompt = universePrompts[universe] || universePrompts['action'];

      const { request_id } = await fal.queue.submit('fal-ai/kling-video/v3/pro/text-to-video', {
        input: {
          prompt: actorPrompt,
          duration: durationStr,
          aspect_ratio: '16:9',
          generate_audio: withAudio,
          negative_prompt: 'blur, distort, low quality, watermark',
          cfg_scale: 0.5,
          elements: [
            {
              image_url: actorImageUrl,
              description: 'Main character, the actor, full body visible, clear face',
            }
          ]
        },
        webhookUrl
      });
      return res.status(200).json({ status: 'processing', request_id, creditsLeft: current - creditCost });
    }

    await refund();
    return res.status(400).json({ error: 'Type inconnu : ' + type });

  } catch(e) {
    await refund();
    return res.status(500).json({ error: e.message });
  }
};
