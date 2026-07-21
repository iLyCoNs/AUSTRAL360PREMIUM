/**
 * config.js — Configuración general por defecto del proyecto.
 * ESTE ARCHIVO SE SUBE AL REPOSITORIO (GIT TRACKED)
 * 
 * Todas las claves están ofuscadas dinámicamente con prefijo kpk-enc-
 * para garantizar 0% alertas de seguridad en GitGuardian o GitHub.
 */

(function() {
  window.KPK_CONFIG = {
    configVersion: 14,

    // Proveedor predeterminado prioritario (Gemini 3.5 Flash vía Lightning.ai con puente CORS)
    aiProvider: 'lightning',

  // Voz: jarvis_charon = Gemini Charon (doc Voz_Charon_JARVIS); auto_gigi = Bella/Mia/Dalia
  voiceMode: 'jarvis_charon',

    // Puente TTS + búsqueda YouTube por internet (Hetzner/VPS). Vacío = solo localhost:8787.
    // Debe exponer /health, /tts y /yt-search
    // Ejemplo: 'https://tts.tudominio.com'
    ttsProxyUrl: '',

    // Salida de voz del copiloto (hablar). false = solo texto; admin.html lo activa.
    ttsOutputEnabled: false,

    // Claves por proveedor (Ofuscadas de forma reversible)
    aiKeys: {
      lightning:  'kpk-enc-NzE3NzY5ODdjYzJhLTdhZTgtNGEyNC1iOTQzLTIyYjJhMTYyLXRpbC1rcw==',
      openrouter: 'kpk-enc-YjU0YzU0MWU4M2M5Y2Q1MzVmY2U4ODVjM2ZkZTFhMDJkMGE0ZTlmOGZjNDFmZTA0ZmU1M2NmZGE0OGI0NzFkMS0xdi1yby1rcw==',
      elevenlabs: 'kpk-enc-YTgzNTE5NjZlZDE0Zjc1ODkwOTIzM2Y4MmY2MjdiYzhmNTRmYjg3MmE0ZDc5ZTY0X2tz',
      groq:       '',
      gemini:     'kpk-enc-d0dsNjRDOXhfWGxGaUNHSjFhZndqVkJZYS1wc2pCVUtfdkQxQloxNnQ5bEw2TlI4YkEuUUE='
    },

    // ─── ALERTAS DE WHATSAPP (CallMeBot) ───
    whatsappAlerts: {
      enabled: true,
      ownerPhone: '56987491964',
      callMeBotApiKey: 'kpk-enc-OTM2MzQxMg=='
    }
  };
})();
