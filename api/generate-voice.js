export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const {text} = req.body;

  if (!text) return res.status(400).json({error: 'Texte requis'});
  if (text.length > 500) return res.status(400).json({error: 'Texte trop long (max 500 caractères)'});

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return res.status(500).json({error: 'Clé API manquante'});

  // Voix personnelle du compte - fonctionne sur plan gratuit
  const VOICE_ID = 'E4FyMTjc8kqFCpto4KQC';

  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.2,
          use_speaker_boost: true
        }
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const msg = err.detail?.message || err.detail || 'Erreur ElevenLabs';
      return res.status(response.status).json({error: msg});
    }

    const audioBuffer = await response.arrayBuffer();
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.byteLength);
    res.status(200).send(Buffer.from(audioBuffer));

  } catch(e) {
    console.error('ElevenLabs error:', e);
    res.status(500).json({error: 'Erreur serveur'});
  }
}
