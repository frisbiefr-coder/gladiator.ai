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

    if (type === 'img2video') {
      if (!imageBase64) {
        await fetch(`${SUPABASE_URL}/rest/v1/user_credits?user_id=eq.${userId}`, {
          method: 'PATCH',
          headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ credits: current })
        });
        return res.status(400).json({ error: 'imageBase64 manquant' });
      }

      // 1) Upload image vers fal.ai storage
      const mimeType = imageMimeType || 'image/jpeg';
      const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
      const imageBuffer = Buffer.from(base64Data, 'base64');

      // Multipart form upload vers fal storage
      const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
      const header = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="input.jpg"\r\nContent-Type: ${mimeType}\r\n\r\n`
      );
      const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
      const formBody = Buffer.concat([header, imageBuffer, footer]);

      const uploadRes = await fetch('https://fal.run/storage/upload', {
        method: 'POST',
        headers: {
          'Authorization': 'Key ' + FAL_KEY,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': formBody.length
        },
        body: formBody
      });
      const uploadData = await uploadRes.json();
      if (!uploadData.url) {
        return res.status(500).json({ error: 'Upload fal storage échoué', details: uploadData });
      }

      const publicImageUrl = uploadData.url;

      // 2) Soumettre le job img2video (async queue)
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
      for (let i = 0; i < 48; i++) {
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
      const falUrl = 'https://fal.run/fal-ai/minimax/hailuo-02/standard/text-to-video';
      const falBody = { prompt: enhancedPrompt, duration: 6, resolution: '768P' };
      const response = await fetch(falUrl, {
        method: 'POST',
        headers: { 'Authorization': 'Key ' + FAL_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(falBody)
      });
      const result = await response.json();
      if (!response.ok) return res.status(500).json({ error: 'Erreur FAL', details: result });
      const url = result.video ? result.video.url : result.url;
      if (!url) return res.status(500).json({ error: 'Pas URL', raw: result });
      return res.status(200).json({ url, creditsLeft: current - creditCost });

    } else {
      const falUrl = 'https://fal.run/fal-ai/flux/schnell';
      const falBody = { prompt: enhancedPrompt, image_size: 'portrait_4_3', num_images: 1 };
      const response = await fetch(falUrl, {
        method: 'POST',
        headers: { 'Authorization': 'Key ' + FAL_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(falBody)
      });
      const result = await response.json();
      if (!response.ok) return res.status(500).json({ error: 'Erreur FAL', details: result });
      const url = result.images ? result.images[0].url : result.url;
      if (!url) return res.status(500).json({ error: 'Pas URL', raw: result });
      return res.status(200).json({ url, creditsLeft: current - creditCost });
    }

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
