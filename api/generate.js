const { fal } = require('@fal-ai/client');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, type = 'image', userId, imageBase64, imageMimeType } = req.body;
  if (!prompt && type !== 'img2video') return res.status(400).json({ error: 'Prompt requis' });
  if (!userId) return res.status(400).json({ error: 'userId requis' });

  const FAL_KEY = process.env.FAL_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  fal.config({ credentials: FAL_KEY });

  const creditCost = type === 'video' ? 5 : type === 'img2video' ? 5 : 1;

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
    let enhancedPrompt = prompt || 'Animate this image with smooth motion';
    try {
      const transRes = await fetch('https://translate.argosopentech.com/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: enhancedPrompt, source: 'auto', target: 'en', format: 'text' })
      });
      const transData = await transRes.json();
      if (transData.translatedText) {
        enhancedPrompt = transData.translatedText;
        if (type !== 'img2video') enhancedPrompt += ', cinematic, 4K, highly detailed, smooth motion';
      }
    } catch(e) {}

    if (type === 'img2video') {
      if (!imageBase64) { await refund(); return res.status(400).json({ error: 'imageBase64 manquant' }); }

      // Convertir base64 en File et uploader via fal.storage
      const mimeType = imageMimeType || 'image/jpeg';
      const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
      const imageBuffer = Buffer.from(base64Data, 'base64');
      const imageFile = new File([imageBuffer], 'input.jpg', { type: mimeType });

      const publicImageUrl = await fal.storage.upload(imageFile);

      // Soumettre job async
      const { request_id } = await fal.queue.submit('fal-ai/minimax/hailuo-02/standard/image-to-video', {
        input: { image_url: publicImageUrl, prompt: enhancedPrompt, duration: 6, resolution: '768P' }
      });

      // Polling max 240s
      let videoUrl = null;
      for (let i = 0; i < 48; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const status = await fal.queue.status('fal-ai/minimax/hailuo-02/standard/image-to-video', { requestId: request_id });
        if (status.status === 'COMPLETED') {
          const result = await fal.queue.result('fal-ai/minimax/hailuo-02/standard/image-to-video', { requestId: request_id });
          videoUrl = result.data?.video?.url || result.data?.url;
          break;
        } else if (status.status === 'FAILED') {
          await refund();
          return res.status(500).json({ error: 'Job vidéo échoué' });
        }
      }

      if (!videoUrl) { await refund(); return res.status(500).json({ error: 'Timeout génération vidéo' }); }
      return res.status(200).json({ url: videoUrl, creditsLeft: current - creditCost });

    } else if (type === 'video') {
      const response = await fetch('https://fal.run/fal-ai/minimax/hailuo-02/standard/text-to-video', {
        method: 'POST',
        headers: { 'Authorization': 'Key ' + FAL_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: enhancedPrompt, duration: 6, resolution: '768P' })
      });
      const result = await response.json();
      if (!response.ok) { await refund(); return res.status(500).json({ error: 'Erreur FAL', details: result }); }
      const url = result.video?.url || result.url;
      if (!url) { await refund(); return res.status(500).json({ error: 'Pas URL', raw: result }); }
      return res.status(200).json({ url, creditsLeft: current - creditCost });

    } else {
      const response = await fetch('https://fal.run/fal-ai/flux/schnell', {
        method: 'POST',
        headers: { 'Authorization': 'Key ' + FAL_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: enhancedPrompt, image_size: 'portrait_4_3', num_images: 1 })
      });
      const result = await response.json();
      if (!response.ok) { await refund(); return res.status(500).json({ error: 'Erreur FAL', details: result }); }
      const url = result.images?.[0]?.url || result.url;
      if (!url) { await refund(); return res.status(500).json({ error: 'Pas URL', raw: result }); }
      return res.status(200).json({ url, creditsLeft: current - creditCost });
    }

  } catch(e) {
    await refund();
    return res.status(500).json({ error: e.message });
  }
};
