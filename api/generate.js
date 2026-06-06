module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { prompt, type = 'image' } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt requis' });
  const FAL_KEY = process.env.FAL_KEY;
  if (!FAL_KEY) return res.status(500).json({ error: 'FAL_KEY manquante' });
  try {
    let falUrl, falBody;
    if (type === 'video') {
      falUrl = 'https://fal.run/fal-ai/ltx-video';
      falBody = { prompt, num_inference_steps: 30, guidance_scale: 3, num_frames: 97 };
    } else {
      falUrl = 'https://fal.run/fal-ai/flux/schnell';
      falBody = { prompt, image_size: 'portrait_4_3', num_images: 1 };
    }
    const response = await fetch(falUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Key ' + FAL_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(falBody)
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(500).json({ error: 'Erreur FAL', details: data });
    }
    let url = null;
    if (type === 'video') {
      url = data.video ? data.video.url : data.url;
    } else {
      url = data.images ? data.images[0].url : data.url;
    }
    if (!url) {
      return res.status(500).json({ error: 'Pas URL', raw: data });
    }
    return res.status(200).json({ url: url });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
