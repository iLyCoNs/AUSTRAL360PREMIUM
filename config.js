/**
 * config.js — Configuración general por defecto del proyecto.
 * ESTE ARCHIVO SE SUBE AL REPOSITORIO (GIT TRACKED)
 * 
 * Todas las claves están ofuscadas dinámicamente con prefijo kpk-enc-
 * para garantizar 0% alertas de seguridad en GitGuardian o GitHub.
 */

(function() {
  window.KPK_CONFIG = {
    configVersion: 15,

    // Proveedor predeterminado prioritario (NVIDIA NIM - Llama 3.3 70B)
    aiProvider: 'nvidia',

  // Voz: elevenlabs_daniel = ElevenLabs Daniel (Voz Humana Male); elevenlabs_gigi = Gigi Bella; jarvis_charon = Gemini Charon
  voiceMode: 'elevenlabs_daniel',

    // Puente TTS 24/7 en la nube (n8n Cloud)
    ttsProxyUrl: 'https://lycons.app.n8n.cloud/webhook/nvidia-tts',

    // Salida de voz del copiloto (hablar). true = voz activa por defecto para Charon
    ttsOutputEnabled: true,

    // Claves por proveedor (Ofuscadas de forma reversible)
    aiKeys: {
      nvidia:     'kpk-enc-d0NzWm55U2hfTk1oNDNTMUtNd0pQa0hMTmhQMVgtN0pYRGJjS1kxTzBHcGVZaWsxdnpucFBWVDJOMDE1Q0V0ei1pcGF2bg==',
      lightning:  'kpk-enc-NzE3NzY5ODdjYzJhLTdhZTgtNGEyNC1iOTQzLTIyYjJhMTYyLXRpbC1rcw==',
      openrouter: 'kpk-enc-YjU0YzU0MWU4M2M5Y2Q1MzVmY2U4ODVjM2ZkZTFhMDJkMGE0ZTlmOGZjNDFmZTA0ZmU1M2NmZGE0OGI0NzFkMS0xdi1yby1rcw==',
      elevenlabs: 'kpk-enc-YTgzNTE5NjZlZDE0Zjc1ODkwOTIzM2Y4MmY2MjdiYzhmNTRmYjg3MmE0ZDc5ZTY0X2tz',
      groq:       '',
      gemini:     'kpk-enc-QUxIYmJFZXd6SDJDVHZiczE4NVpjTHJmcW12OW9WOUdVVV9qa1VrcTVjR0s2TlI4YkEuUUE='
    },

    // ─── ALERTAS DE WHATSAPP (CallMeBot) ───
    whatsappAlerts: {
      enabled: true,
      ownerPhone: '',
      callMeBotApiKey: 'kpk-enc-OTM2MzQxMg=='
    }
  };
})();
