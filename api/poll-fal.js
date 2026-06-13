const { fal } = require('@fal-ai/client');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { requestId } = req.query;
  if (!requestId) return res.status(400).json({ error: 'requestId requis' });

  const FAL_KEY = process.env.FAL_KEY;
  fal.config({ credentials: FAL_KEY });

  try {
    const status = await fal.queue.status('fal-ai/kling-video/v3/pro/text-to-video', {
      requestId,
      logs: false,
    });

    // Statuts possibles : IN_QUEUE, IN_PROGRESS, COMPLETED, FAILED
    if (status.status === 'COMPLETED') {
      // Récupérer le résultat final
      const result = await fal.queue.result('fal-ai/kling-video/v3/pro/text-to-video', {
        requestId,
      });
      return res.status(200).json({
        status: 'completed',
        output: result.data,
      });
    }

    if (status.status === 'FAILED') {
      return res.status(200).json({ status: 'failed', error: 'Génération échouée' });
    }

    // IN_QUEUE ou IN_PROGRESS
    return res.status(200).json({ status: 'processing', queuePosition: status.queue_position });

  } catch(e) {
    // Le requestId peut venir de n'importe quel endpoint Kling v3
    // On essaie les autres endpoints si le premier échoue
    try {
      const status = await fal.queue.status('fal-ai/kling-video/v3/pro/image-to-video', {
        requestId,
        logs: false,
      });

      if (status.status === 'COMPLETED') {
        const result = await fal.queue.result('fal-ai/kling-video/v3/pro/image-to-video', {
          requestId,
        });
        return res.status(200).json({ status: 'completed', output: result.data });
      }

      if (status.status === 'FAILED') {
        return res.status(200).json({ status: 'failed', error: 'Génération échouée' });
      }

      return res.status(200).json({ status: 'processing', queuePosition: status.queue_position });

    } catch(e2) {
      return res.status(500).json({ error: e2.message });
    }
  }
};
