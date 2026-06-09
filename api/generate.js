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

      const mimeType = imageMimeType || 'image/jpeg';
      // Construire le data URI proprement
      const dataUri = imageBase64.startsWith('data:') ? imageBase64 : `data:${mimeType};base64,${imageBase64}`;

      // Soumettre en async via queue
      const submitRes = await fetch('https://queue.fal.run/fal-ai/minimax/hailuo-02/standard/image-to-video', {
        method: 'POST',
        headers: { 'Authorization': 'Key ' + FAL_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: dataUri, prompt: enhancedPrompt, duration: 6, resolution: '768P' })
      });
      const submitData = await submitRes.json();
      if (!submitData.request_id) { await refund(); return res.status(500).json({ error: 'Soumission job échouée', details: submitData }); }

      // Polling max 240s
      const requestId = submitData.request_id;
      const statusUrl = `https://queue.fal.run/fal-ai/minimax/hailuo-02/standard/image-to-video/requests/${requestId}/status`;
      const resultUrl  = `https://queue.fal.run/fal-ai/minimax/hailuo-02/standard/image-to-video/requests/${requestId}`;

      let videoUrl = null;
      for (let i = 0; i < 48; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const st = await (await fetch(statusUrl, { headers: { 'Authorization': 'Key ' + FAL_KEY } })).json();
        if (st.status === 'COMPLETED') {
          const rd = await (await fetch(resultUrl, { headers: { 'Authorization': 'Key ' + FAL_KEY } })).json();
          videoUrl = rd.video?.url || rd.url;
          break;
        } else if (st.status === 'FAILED') {
          await refund();
          return res.status(500).json({ error: 'Job vidéo échoué', details: st });
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
