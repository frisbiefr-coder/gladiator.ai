module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { requestId, userId } = req.body;
  if (!requestId || !userId) return res.status(400).json({ error: 'requestId et userId requis' });

  const FAL_KEY = process.env.FAL_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  try {
    // Chercher la generation pending dans Supabase
    const genRes = await fetch(`${SUPABASE_URL}/rest/v1/user_generations?user_id=eq.${userId}&fal_request_id=eq.${requestId}&select=*`, {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      }
    });
    const gens = await genRes.json();
    const gen = gens?.[0];

    if (!gen) return res.status(404).json({ error: 'Generation non trouvee' });
    if (gen.status === 'done' && gen.url) return res.status(200).json({ status: 'done', url: gen.url });
    if (gen.status === 'failed') return res.status(200).json({ status: 'failed' });

    // Vérifier le statut chez fal.ai
    const modelPath = gen.fal_model_path;
    const statusRes = await fetch(`https://queue.fal.run/${modelPath}/requests/${requestId}/status`, {
      headers: { 'Authorization': 'Key ' + FAL_KEY }
    });
    const statusData = await statusRes.json();

    if (statusData.status === 'COMPLETED') {
      // Récupérer le résultat
      const resultRes = await fetch(`https://queue.fal.run/${modelPath}/requests/${requestId}`, {
        headers: { 'Authorization': 'Key ' + FAL_KEY }
      });
      const result = await resultRes.json();
      const url = result.video ? result.video.url : result.url;

      if (url) {
        // Mettre à jour Supabase
        await fetch(`${SUPABASE_URL}/rest/v1/user_generations?user_id=eq.${userId}&fal_request_id=eq.${requestId}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ url, status: 'done' })
        });
        return res.status(200).json({ status: 'done', url });
      } else {
        await fetch(`${SUPABASE_URL}/rest/v1/user_generations?user_id=eq.${userId}&fal_request_id=eq.${requestId}`, {
          method: 'PATCH',
          headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'failed' })
        });
        return res.status(200).json({ status: 'failed', raw: JSON.stringify(result) });
      }
    } else if (statusData.status === 'FAILED') {
      await fetch(`${SUPABASE_URL}/rest/v1/user_generations?user_id=eq.${userId}&fal_request_id=eq.${requestId}`, {
        method: 'PATCH',
        headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'failed' })
      });
      return res.status(200).json({ status: 'failed' });
    } else {
      return res.status(200).json({ status: 'processing' });
    }
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
