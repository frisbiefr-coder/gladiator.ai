const fetch = require('node-fetch');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') return res.status(200).end();
          if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

            const { prompt, type = 'image' } = req.body;
              if (!prompt) return res.status(400).json({ error: 'Prompt requis' });

                const FAL_KEY = process.env.FAL_KEY;
                  if (!FAL_KEY) return res.status(500).json({ error: 'FAL_KEY manquante' });

                    try {
                        if (type === 'image') {
                              const response = await fetch('https://fal.run/fal-ai/flux/schnell', {
                                      method: 'POST',
                                              headers: {
                                                        'Authorization': `Key ${FAL_KEY}`,
                                                                  'Content-Type': 'application/json'
                                                                          },
                                                                                  body: JSON.stringify({ prompt, image_size: 'square_hd', num_images: 1 })
                                                                                        });

                                                                                              const data = await response.json();
                                                                                                    if (!response.ok) return res.status(500).json({ error: data.message || 'Erreur FAL' });
                                                                                                          return res.status(200).json({ url: data.images[0].url });

                                                                                                              } else {
                                                                                                                    const submitRes = await fetch('https://fal.run/fal-ai/kling-video/v1.6/standard/text-to-video', {
                                                                                                                            method: 'POST',
                                                                                                                                    headers: {
                                                                                                                                              'Authorization': `Key ${FAL_KEY}`,
                                                                                                                                                        'Content-Type': 'application/json'
                                                                                                                                                                },
                                                                                                                                                                        body: JSON.stringify({ prompt, duration: '5', aspect_ratio: '9:16' })
                                                                                                                                                                              });

                                                                                                                                                                                    const submitData = await submitRes.json();
                                                                                                                                                                                          const requestId = submitData.request_id;
                                                                                                                                                                                                if (!requestId) return res.status(500).json({ error: 'Pas de request_id' });

                                                                                                                                                                                                      for (let i = 0; i < 30; i++) {
                                                                                                                                                                                                              await new Promise(r => setTimeout(r, 6000));
                                                                                                                                                                                                                      const statusRes = await fetch(`https://fal.run/fal-ai/kling-video/v1.6/standard/text-to-video/requests/${requestId}`, {
                                                                                                                                                                                                                                headers: { 'Authorization': `Key ${FAL_KEY}` }
                                                                                                                                                                                                                                        });
                                                                                                                                                                                                                                                const statusData = await statusRes.json();
                                                                                                                                                                                                                                                        if (statusData.status === 'COMPLETED') {
                                                                                                                                                                                                                                                                  return res.status(200).json({ url: statusData.video?.url });
                                                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                                                                }
                                                                                                                                                                                                                                                                                      return res.status(500).json({ error: 'Timeout vidéo' });
                                                                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                                                                            } catch (err) {
                                                                                                                                                                                                                                                                                                return res.status(500).json({ error: err.message });
                                                                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                                                                  };