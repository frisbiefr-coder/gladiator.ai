export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const {text, voiceId, language} = req.body;

  if (!text) return res.status(400).json({error: 'Texte requis'});
  if (text.length > 500) return res.status(400).json({error: 'Texte trop long (max 500 caractères)'});

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return res.status(500).json({error: 'Clé API manquante'});

  // Voix disponibles sur plan gratuit ElevenLabs
  const FREE_VOICES = {
    'rachel': 'EXAVITQu4vr4xnSDxMaL',
    'bella': 'EXAVITQu4vr4xnSDxMaL',
    'default': 'EXAVITQu4vr4xnSDxMaL'
  };

  // Sur plan gratuit, utiliser la première voix disponible via /voices
  try {
    // D'abord récupérer les voix disponibles pour ce compte
    const voicesResp = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: {'xi-api-key': apiKey}
    });
    const voicesData = await voicesResp.json();
    const voices = voicesData.voices || [];
    
    // Prendre la première voix disponible du compte
    let selectedVoiceId = voices.length > 0 ? voices[0].voice_id : voiceId;

    // Si l'ID demandé est dans les voix du compte, l'utiliser
    const requested = voices.find(v => v.voice_id === voiceId);
    if (requested) selectedVoiceId = voiceId;

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}`, {
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
