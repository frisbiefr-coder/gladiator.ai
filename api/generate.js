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

  const creditCost = type === 'video' ? 5 : type === 'img2video' ? 5 : 1;

  const getRes = await fetch(`${SUPABASE_URL}/rest/v1/user_credits?user_id=eq.${userId}&select=credits`, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
    }
  });
  const data = await getRes.json();
  const current = data?.[0]?.credits || 0;

  if (current < creditCost) {
    return res.status(402).json({ error: 'Credits insuffisants' });
  }

  await fetch(`${SUPABASE_URL}/rest/v1/user_credits?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ credits: current - creditCost })
  });

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
        if (type !== 'img2video') {
          enhancedPrompt += ', cinematic, 4K, highly detailed, smooth motion';
        }
      }
    } catch(e) {}

    let falUrl, falBody;

    if (type === 'img2video') {
      if (!imageBase64) {
        await fetch(`${SUPABASE_URL}/rest/v1/user_credits?user_id=eq.${userId}`, {
          method: 'PATCH',
          headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ credits: current })
        });
        return res.status(400).json({ error: 'imageBase64 manquant' });
      }

      // 1) Upload base64 → fal.ai storage pour obtenir une URL publique
      const mimeType = imageMimeType || 'image/jpeg';
      const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
      const imageBuffer = Buffer.from(base64Data, 'base64');

      const uploadRes = await fetch('https://fal.run/fal-ai/storage/upload/initiate', {
        method: 'POST',
        headers: { 'Authorization': 'Key ' + FAL_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_name: 'input.jpg', content_type: mimeType })
      });
      const uploadData = await uploadRes.json();
      if (!uploadData.upload_url) {
        return res.status(500).json({ error: 'Impossible d\'initier upload fal storage', details: uploadData });
      }

      await fetch(uploadData.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body: imageBuffer
      });

      const publicImageUrl = uploadData.file_url;

      // 2) Soumettre le job img2video de façon asynchrone
      const submitRes = await fetch('https://queue.fal.run/fal-ai/minimax/hailuo-02/standard/image-to-video', {
        method: 'POST',
        headers: { 'Authorization': 'Key ' + FAL_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: publicImageUrl,
          prompt: enhancedPrompt,
          duration: 6,
          resolution: '768P'
        })
      });
      const submitData = await submitRes.json();
      if (!submitData.request_id) {
        return res.status(500).json({ error: 'Erreur soumission job video', details: submitData });
      }

      // 3) Polling jusqu'à completion (max 240s)
      const requestId = submitData.request_id;
      const statusUrl = `https://queue.fal.run/fal-ai/minimax/hailuo-02/standard/image-to-video/requests/${requestId}/status`;
      const resultUrl = `https://queue.fal.run/fal-ai/minimax/hailuo-02/standard/image-to-video/requests/${requestId}`;

      let videoUrl = null;
      const maxAttempts = 48; // 48 x 5s = 240s
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const statusRes = await fetch(statusUrl, { headers: { 'Authorization': 'Key ' + FAL_KEY } });
        const statusData = await statusRes.json();
        if (statusData.status === 'COMPLETED') {
          const resRes = await fetch(resultUrl, { headers: { 'Authorization': 'Key ' + FAL_KEY } });
          const resData = await resRes.json();
          videoUrl = resData.video?.url || resData.url;
          break;
        } else if (statusData.status === 'FAILED') {
          return res.status(500).json({ error: 'Job vidéo échoué', details: statusData });
        }
      }

      if (!videoUrl) {
        return res.status(500).json({ error: 'Timeout: vidéo non générée dans les temps' });
      }

      return res.status(200).json({ url: videoUrl, creditsLeft: current - creditCost });

    } else if (type === 'video') {
      falUrl = 'https://fal.run/fal-ai/minimax/hailuo-02/standard/text-to-video';

      falBody = { prompt: enhancedPrompt, duration: 6, resolution: '768P' };
    } else {
      falUrl = 'https://fal.run/fal-ai/flux/schnell';
      falBody = { prompt: enhancedPrompt, image_size: 'portrait_4_3', num_images: 1 };
    }

    const response = await fetch(falUrl, {
      method: 'POST',
      headers: { 'Authorization': 'Key ' + FAL_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(falBody)
    });
    const result = await response.json();
    if (!response.ok) return res.status(500).json({ error: 'Erreur FAL', details: result });

    let url = null;
    if (type === 'video' || type === 'img2video') {
      url = result.video ? result.video.url : result.url;
    } else {
      url = result.images ? result.images[0].url : result.url;
    }

    if (!url) return res.status(500).json({ error: 'Pas URL', raw: result });
    return res.status(200).json({ url, creditsLeft: current - creditCost });

  } catch(e) {
    await fetch(`${SUPABASE_URL}/rest/v1/user_credits?user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ credits: current })
    });
    return res.status(500).json({ error: e.message });
  }
};
