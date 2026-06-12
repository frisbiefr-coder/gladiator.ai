export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const {imageData, audioData} = req.body;
  if (!imageData || !audioData) return res.status(400).json({error: 'Image et audio requis'});

  const falKey = process.env.FAL_KEY;
  if (!falKey) return res.status(500).json({error: 'Clé fal.ai manquante'});

  try {
    // Step 1: Upload image to fal.ai storage
    const imgBuffer = Buffer.from(imageData.split(',')[1], 'base64');
    const imgBlob = new Blob([imgBuffer], {type: 'image/jpeg'});
    const imgForm = new FormData();
    imgForm.append('file', imgBlob, 'image.jpg');

    const imgUpload = await fetch('https://fal.run/fal-ai/storage/upload', {
      method: 'POST',
      headers: {'Authorization': `Key ${falKey}`},
      body: imgForm
    });
    const imgData = await imgUpload.json();
    if (!imgData.url) throw new Error('Erreur upload image');
    const imageUrl = imgData.url;

    // Step 2: Upload audio to fal.ai storage
    const audioBuffer = Buffer.from(audioData.split(',')[1], 'base64');
    const audioBlob = new Blob([audioBuffer], {type: 'audio/mpeg'});
    const audioForm = new FormData();
    audioForm.append('file', audioBlob, 'audio.mp3');

    const audioUpload = await fetch('https://fal.run/fal-ai/storage/upload', {
      method: 'POST',
      headers: {'Authorization': `Key ${falKey}`},
      body: audioForm
    });
    const audioUploadData = await audioUpload.json();
    if (!audioUploadData.url) throw new Error('Erreur upload audio');
    const audioUrl = audioUploadData.url;

    // Step 3: Submit lip sync job via fal.ai queue
    const submitResp = await fetch('https://queue.fal.run/fal-ai/sync-lipsync', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${falKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        video_url: imageUrl,
        audio_url: audioUrl,
        model: 'wav2lip',
        enhance: true
      })
    });

    const submitData = await submitResp.json();
    if (!submitData.request_id) throw new Error('Erreur soumission fal.ai');

    const requestId = submitData.request_id;

    // Step 4: Poll for result (max 3 minutes)
    const maxAttempts = 36;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 5000));

      const statusResp = await fetch(`https://queue.fal.run/fal-ai/sync-lipsync/requests/${requestId}/status`, {
        headers: {'Authorization': `Key ${falKey}`}
      });
      const statusData = await statusResp.json();

      if (statusData.status === 'COMPLETED') {
        const resultResp = await fetch(`https://queue.fal.run/fal-ai/sync-lipsync/requests/${requestId}`, {
          headers: {'Authorization': `Key ${falKey}`}
        });
        const resultData = await resultResp.json();
        const videoUrl = resultData.video?.url || resultData.video_url;
        if (!videoUrl) throw new Error('Pas de vidéo dans le résultat');
        return res.status(200).json({videoUrl});
      }

      if (statusData.status === 'FAILED') {
        throw new Error('Génération échouée sur fal.ai');
      }
    }

    throw new Error('Timeout - la génération a pris trop de temps');

  } catch(e) {
    console.error('Lipsync error:', e);
    res.status(500).json({error: e.message || 'Erreur serveur'});
  }
}
