module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { userId, type } = req.query;
  const body = req.body;

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  try {
    // Fal.ai envoie le résultat dans body.output ou body directement
    const videoUrl = body?.output?.video?.url || body?.output?.url || body?.video?.url || body?.url;

    if (!videoUrl || !userId) {
      return res.status(200).json({ received: true });
    }

    await fetch(`${SUPABASE_URL}/rest/v1/user_generations`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        user_id: userId,
        prompt: type === 'video' ? 'text-to-video' : 'img2video',
        type: type || 'video',
        url: videoUrl,
        status: 'done'
      })
    });

    return res.status(200).json({ received: true, saved: true });
  } catch(e) {
    return res.status(200).json({ received: true, error: e.message });
  }
};
