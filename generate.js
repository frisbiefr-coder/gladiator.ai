export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, type, userId } = req.body;
  if (!prompt || !type || !userId) return res.status(400).json({ error: 'Missing fields' });

  const FAL_KEY = process.env.FAL_KEY;

  try {
    let url = '';

    if (type === 'image') {
      // Generate image with FAL.ai Flux
      const submitRes = await fetch('https://queue.fal.run/fal-ai/flux/schnell', {
        method: 'POST',
        headers: {
          'Authorization': `Key ${FAL_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt,
          image_size: 'portrait_4_3',
          num_inference_steps: 4,
          num_images: 1
        })
      });

      const submitData = await submitRes.json();
      const requestId = submitData.request_id;

      // Poll for result
      let result = null;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const pollRes = await fetch(`https://queue.fal.run/fal-ai/flux/schnell/requests/${requestId}`, {
          headers: { 'Authorization': `Key ${FAL_KEY}` }
        });
        const pollData = await pollRes.json();
        if (pollData.status === 'COMPLETED' && pollData.output?.images?.[0]) {
          result = pollData.output.images[0].url;
          break;
        }
      }
      url = result;

    } else if (type === 'video') {
      // Generate video with FAL.ai LTX-Video
      const submitRes = await fetch('https://queue.fal.run/fal-ai/ltx-video', {
        method: 'POST',
        headers: {
          'Authorization': `Key ${FAL_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt,
          num_inference_steps: 30,
          guidance_scale: 3,
          num_frames: 97
        })
      });

      const submitData = await submitRes.json();
      const requestId = submitData.request_id;

      // Poll for result (videos take longer)
      let result = null;
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const pollRes = await fetch(`https://queue.fal.run/fal-ai/ltx-video/requests/${requestId}`, {
          headers: { 'Authorization': `Key ${FAL_KEY}` }
        });
        const pollData = await pollRes.json();
        if (pollData.status === 'COMPLETED' && pollData.output?.video?.url) {
          result = pollData.output.video.url;
          break;
        }
      }
      url = result;
    }

    if (!url) return res.status(500).json({ error: 'Generation failed' });
    return res.status(200).json({ url });

  } catch (error) {
    console.error('Generation error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
}
