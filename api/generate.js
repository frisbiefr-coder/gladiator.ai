                                                                                                                                                                                    const submitData = await submitRes.json();
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
      falBody = {
        prompt,
        num_inference_steps: 30,
        guidance_scale: 3,
        num_frames: 97
      };
    } else {
      falUrl = 'https://fal.run/fal-ai/flux/schnell';
      falBody = {
        prompt,
        image_size: 'portrait_4_3',
        num_images: 1,
        enable_safety_checker: false
      };
    }

    const response = await fetch(falUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${FAL_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(falBody)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('FAL error:', JSON.stringify(data));
      return res.status(500).json({ error: 'Erreur FAL.ai', details: data });
    }

    let url = null;
    if (type === 'video') {
      url = data?.video?.url || data?.url || null;
    } else {
      url = data?.images?.[0]?.url || data?.image?.url || null;
    }

    if (!url) {
      console.error('No URL in FAL response:', JSON.stringify(data));
      return res.status(500).json({ error: 'Pas d\'URL dans la réponse FAL', raw: data });
    }

    return res.status(200).json({ url });

  } catch (e) {
    console.error('Exception:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
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
