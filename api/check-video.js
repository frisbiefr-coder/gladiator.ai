const { fal } = require('@fal-ai/client');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { requestId, userId, type } = req.body;
  if (!requestId) return res.status(400).json({ error: 'requestId requis' });

  const FAL_KEY = process.env.FAL_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  fal.config({ credentials: FAL_KEY });

  const modelPath = type === 'video'
    ? 'fal-ai/minimax/hailuo-02/standard/text-to-video'
    : 'fal-ai/minimax/hailuo-02/standard/image-to-video';

  try {
    const status = await fal.queue.status(modelPath, { requestId, logs: false });

    if (status.status === 'COMPLETED') {
      const result = await fal.queue.result(modelPath, { requestId });
      const videoUrl = result.data?.video?.url || result.data?.url;

      if (videoUrl && userId) {
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/user_generations`, {
            method: 'POST',
            headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify({ user_id: userId, prompt: type === 'video' ? 'text-to-video' : 'img2video', type: type || 'img2video', url: videoUrl, status: 'done' })
          });
        } catch(e) {}
      }

      return res.status(200).json({ status: 'done', url: videoUrl });

    } else if (status.status === 'FAILED') {
      return res.status(200).json({ status: 'failed' });
    } else {
      return res.status(200).json({ status: 'processing' });
    }

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
