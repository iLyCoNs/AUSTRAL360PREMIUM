/**
 * f-copilot.js — Asistente de Ventas IA interactivo para Ferrari360
 * Utiliza Google AI Studio (Gemini 1.5 Flash) para guiar visualmente al usuario.
 */

'use strict';

(function() {
  let _provider = 'gemini';
  let _apiKey = '';
  let _modelName = '';

  function _deobfuscateKey(encKey) {
    if (!encKey || typeof encKey !== 'string') return '';
    if (!encKey.startsWith('kpk-enc-')) return encKey;
    try {
      const rawBase = encKey.substring(8);
      return atob(rawBase).split('').reverse().join('');
    } catch (e) {
      return encKey;
    }
  }

  let _panel = null;
  let _bubble = null;
  let _log = null;
  let _input = null;
  let _btnMic = null;
  let _recognition = null;
  let _isListening = false;

  // Variables para la carga de archivos adjuntos en el chatbot
  let _attachedFile = null;
  let _activeSendFile = null;
  let _btnAttach = null;
  let _fileInput = null;
  let _attachmentBar = null;
  let _attachmentName = null;
  let _attachmentClear = null;
  let _chatHistory = []; // Para mantener memoria del diálogo
  let _jarvisMode = false;
  let _shouldRestartMic = false;
  let _activeLote = null; // Lote actualmente en foco (para contexto persistente de la IA)
  
  // Variables de interacción móvil y personalización
  let _clientName = localStorage.getItem('kpk_client_name') || '';
  let _isWaitingForName = !_clientName;
  let _bubblePopupTimeout = null;
  /** HUD móvil anclado: no auto-cerrar/minimizar mientras el usuario chatea */
  let _mobileHudPinned = false;
  /** Chips de acción (turismo/agenda) activos — no sobrescribir con sugerencias */
  let _actionChipsActive = false;
  let _isAISpeaking = false;
  let _lastSpokenText = '';
  let _aiSpeechStartTime = 0;
  let _globalAudio = null;
  let _activeJarvisAudio = null;
  let _lastUsedVoiceEngine = '';

  async function _unlockMobileAudio() {
    try {
      if (!_globalAudio) {
        _globalAudio = new Audio();
      }
      if (!_audioUnlocked) {
        _globalAudio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
        const p = _globalAudio.play();
        if (p && p.then) {
          p.then(() => {
            _audioUnlocked = true;
            console.log('[Ferrari/IA] 🔊 Audio HTML5 desbloqueado globalmente en _globalAudio');
          }).catch(() => {});
        }
      }

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        if (!_activeAudioCtx) {
          _activeAudioCtx = new AudioCtx();
        }
        if (_activeAudioCtx.state === 'suspended') {
          try { await _activeAudioCtx.resume(); } catch(e) {}
        }
        const buffer = _activeAudioCtx.createBuffer(1, 1, 22050);
        const source = _activeAudioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(_activeAudioCtx.destination);
        source.start(0);
      }
      if ('speechSynthesis' in window) {
        _cachedVoices = window.speechSynthesis.getVoices();
      }
    } catch(e) {}
  }

  // Inicializar UI al cargar la página


  function init() {
    if (document.getElementById('kpk-ai-root')) return;

    window.addEventListener('touchstart', _unlockMobileAudio, { passive: true });
    window.addEventListener('click', _unlockMobileAudio, { passive: true });

    // Estilos para el selector de voz
    const _vsStyle = document.createElement('style');
    _vsStyle.textContent = `
      .kpk-voice-opt:hover { background:rgba(255,255,255,0.06) !important; color:#f5f5f7 !important; }
    `;
    document.head.appendChild(_vsStyle);

    // No precargar Edge TTS si la salida de voz está OFF (modo solo texto)

    // Cargar config de IA desde la marca o localStorage
    let remoteProvider = null;
    if (window.FerrariBrandDock && typeof window.FerrariBrandDock.getBrand === 'function') {
      remoteProvider = window.FerrariBrandDock.getBrand().aiProvider;
    }

    const cfg = window.KPK_CONFIG || {};
    
    // Invalidador automático de caché de configuración (configVersion)
    const localCfgVer = localStorage.getItem('ferrari_config_version') || '0';
    const currentCfgVer = String(cfg.configVersion || '0');
    if (localCfgVer !== currentCfgVer && cfg.configVersion) {
      console.log(`[Ferrari/IA] Nueva versión de config detectada (${localCfgVer} -> ${currentCfgVer}). Limpiando caché local...`);
      localStorage.removeItem('ferrari_ai_provider');
      localStorage.removeItem('ferrari_ai_key_openrouter');
      localStorage.removeItem('ferrari_ai_key_groq');
      localStorage.removeItem('ferrari_ai_key_gemini');
      localStorage.removeItem('ferrari_ai_key_lightning');
      localStorage.setItem('ferrari_config_version', currentCfgVer);
    }

    _provider = localStorage.getItem('ferrari_ai_provider')
      || cfg.aiProvider
      || remoteProvider
      || 'lightning';

    // Key: localStorage tiene prioridad (configurada en el admin),
    // luego KPK_CONFIG (config.local.js del servidor), nunca hardcodeada
    _apiKey = localStorage.getItem(`ferrari_ai_key_${_provider}`)
      || (cfg.aiKeys && cfg.aiKeys[_provider])
      || '';

    // Persistir la key resuelta para que no se pierda en recargas
    if (_apiKey) localStorage.setItem(`ferrari_ai_key_${_provider}`, _apiKey);

    const models = {
      gemini: 'gemini-2.0-flash',
      groq: 'llama-3.1-8b-instant',
      openrouter: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
      lightning: 'google/gemini-3.5-flash'
    };
    _modelName = models[_provider] || models.openrouter;

    // TTS OFF duro (v2) ANTES de pintar UI — silencia Charon/Dalia/robot
    if (localStorage.getItem('kpk_tts_output_forced_v2') !== '1') {
      localStorage.setItem('kpk_tts_output', '0');
      localStorage.setItem('kpk_tts_output_forced_v2', '1');
    }
    _speechEnabled = localStorage.getItem('kpk_tts_output') === '1';
    try { stopAISpeech(); } catch (e) {}
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}

    // Ayudantes de nombres dinámicos de Jarvis/Gigi
    const mode = _getVoiceMode();
    const isGigi = mode.includes('gigi') || mode.includes('dalia') || mode.includes('stream') || mode === 'auto_gigi';
    const isJarvis = mode.includes('jarvis') || mode.includes('charon') || mode.includes('daniel');
    const assistantName = isJarvis ? 'Jarvis' : (isGigi ? 'Gigi' : 'Jarvis');
    // Sin "Charon" en UI mientras TTS está apagado (modo solo texto)
    const assistantTitle = isJarvis
      ? (_speechEnabled ? 'Asistente JARVIS · Charon' : 'Asistente JARVIS')
      : (isGigi ? 'Asistente de Ventas Gigi' : 'Asistente Inmobiliario Jarvis');

    // Crear elementos de UI (TTS salida OFF por defecto; sin selector de voces ni badge robot)
    const root = document.createElement('div');
    root.id = 'kpk-ai-root';
    root.innerHTML = `
      <!-- Botón Flotante -->
      <button class="kpk-ai-bubble" id="kpk-ai-bubble" title="Hablar con Asistente IA">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          <circle cx="12" cy="10" r="2"></circle>
          <line x1="12" y1="12" x2="12" y2="15"></line>
        </svg>
      </button>

      <!-- Panel de Chat -->
      <div class="kpk-ai-panel" id="kpk-ai-panel">
        <div class="kpk-ai-header">
          <div class="kpk-ai-header-title">
            <span class="kpk-ai-header-dot" title="En línea"></span>
            <div class="kpk-ai-header-copy">
              <span class="kpk-ai-header-eyebrow">Copiloto premium</span>
              <span class="kpk-ai-header-name">${assistantTitle}</span>
            </div>
          </div>
          <div class="kpk-ai-header-actions">
            <button class="kpk-ai-close" id="kpk-ai-close" title="Cerrar" aria-label="Cerrar">✕</button>
          </div>
        </div>
        <div class="kpk-voice-panel" id="kpk-voice-panel" style="display:none;"></div>


        <div class="kpk-ai-log" id="kpk-ai-log">
          <!-- El saludo lo escribe el onboarding (una sola vez) -->
        </div>
        <!-- Previsualización de Archivo Adjunto -->
        <div class="kpk-ai-attachment-bar" id="kpk-ai-attachment-bar" style="display: none;">
          <span class="kpk-ai-attachment-icon">📎</span>
          <span class="kpk-ai-attachment-name" id="kpk-ai-attachment-name">archivo.pdf</span>
          <button class="kpk-ai-attachment-clear" id="kpk-ai-attachment-clear" title="Quitar archivo">✕</button>
        </div>

        <!-- Contenedor de Sugerencias Rápidas (carrusel con flechas) -->
        <div class="kpk-ai-chips-rail" id="kpk-ai-chips-rail">
          <button type="button" class="kpk-ai-chips-nav kpk-ai-chips-nav--prev" id="kpk-ai-chips-prev" title="Anteriores" aria-label="Ver opciones anteriores">‹</button>
          <div class="kpk-ai-chips-container" id="kpk-ai-chips-container"></div>
          <button type="button" class="kpk-ai-chips-nav kpk-ai-chips-nav--next" id="kpk-ai-chips-next" title="Más opciones" aria-label="Ver más opciones">›</button>
        </div>

        <div class="kpk-ai-input-zone">
          <div class="kpk-ai-input-wrap">
            <button class="kpk-ai-attach-btn" id="kpk-ai-attach" title="Adjuntar archivo o imagen">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
              </svg>
            </button>
            <input type="file" id="kpk-ai-file-input" style="display: none;" accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document">
            <input type="text" class="kpk-ai-input" id="kpk-ai-input" placeholder="Escribe tu nombre aquí..." autocomplete="off">
            <button class="kpk-ai-action-btn" id="kpk-ai-mic" title="Grabar voz">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
              </svg>
            </button>
          </div>
          <button class="kpk-ai-action-btn kpk-ai-send-btn" id="kpk-ai-send" title="Enviar mensaje" aria-label="Enviar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(root);

    _bubble = document.getElementById('kpk-ai-bubble');
    _panel  = document.getElementById('kpk-ai-panel');
    _log    = document.getElementById('kpk-ai-log');
    _input  = document.getElementById('kpk-ai-input');
    _btnMic = document.getElementById('kpk-ai-mic');

    if (window.FerrariDrag && _panel) {
      window.FerrariDrag.attach(_panel, { handle: '.kpk-ai-header' });
    }

    // Referencias Uploader
    _btnAttach       = document.getElementById('kpk-ai-attach');
    _fileInput       = document.getElementById('kpk-ai-file-input');
    _attachmentBar   = document.getElementById('kpk-ai-attachment-bar');
    _attachmentName  = document.getElementById('kpk-ai-attachment-name');
    _attachmentClear = document.getElementById('kpk-ai-attachment-clear');

    // Eventos de adjuntos de archivos
    function _clearAttachment() {
      _attachedFile = null;
      if (_fileInput) _fileInput.value = '';
      if (_attachmentBar) _attachmentBar.style.display = 'none';
    }

    if (_btnAttach && _fileInput) {
      _btnAttach.addEventListener('click', () => _fileInput.click());
      _fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) {
          if (window.FerrariUI && window.FerrariUI.showToast) {
            window.FerrariUI.showToast('El archivo supera el límite de 10 MB.', 'error');
          }
          _fileInput.value = '';
          return;
        }
        _attachedFile = file;
        if (_attachmentName) {
          _attachmentName.textContent = `${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`;
        }
        if (_attachmentBar) _attachmentBar.style.display = 'flex';
        playFuturisticSound('click');
      });
    }
    if (_attachmentClear) {
      _attachmentClear.addEventListener('click', _clearAttachment);
    }
    window.FerrariUI = window.FerrariUI || {};
    window.FerrariUI.clearChatAttachment = _clearAttachment;

    // Eventos base
    _bubble.addEventListener('click', togglePanel);
    document.getElementById('kpk-ai-close').addEventListener('click', togglePanel);
    document.getElementById('kpk-ai-send').addEventListener('click', handleSend);
    _input.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSend(); });



    // Sincronizar lote activo ante clicks manuales en el mapa
    document.addEventListener('kpkLoteSelected', (e) => {
      const lote = findLoteById(e.detail.loteId);
      if (lote) {
        _activeLote = lote;
        _updateSuggestiveChips();
      }
    });

    // Por si queda HTML viejo en caché: quitar mic/speaker/badge del header
    ['kpk-ai-voice-select', 'kpk-ai-toggle-voice', 'kpk-voice-engine-badge'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });

    // Preferencia de voz v7: JARVIS Charon (Gemini) disponible vía Voz_Charon_JARVIS.txt
    const VOICE_DEFAULT_VER = '7';
    if (localStorage.getItem('kpk_voice_default_ver') !== VOICE_DEFAULT_VER) {
      // Sembrar Gemini ANTES de decidir default
      if (!localStorage.getItem('ferrari_ai_key_gemini')) {
        const cfg0 = window.KPK_CONFIG || {};
        const raw0 = (cfg0.aiKeys && cfg0.aiKeys.gemini) || '';
        if (raw0) localStorage.setItem('ferrari_ai_key_gemini', raw0);
      }
      const hasGemini = !!_getGeminiKey();
      localStorage.setItem('kpk_voice_mode', hasGemini ? 'jarvis_charon' : 'auto_gigi');
      if (hasGemini) localStorage.setItem('kpk_voice_user_override', '1');
      else localStorage.removeItem('kpk_voice_user_override');
      localStorage.removeItem('kpk_el_status_v1');
      localStorage.setItem('kpk_voice_default_ver', VOICE_DEFAULT_VER);
      console.log('[Ferrari/IA] Voz v7:', hasGemini ? 'JARVIS Charon (Gemini)' : 'Auto Dalia/Mia');
    }

    // Sembrar keys desde config
    if (!localStorage.getItem('ferrari_ai_key_elevenlabs')) {
      const elKey = _getElevenLabsKey();
      if (elKey) {
        const cfg = window.KPK_CONFIG || {};
        const raw = (cfg.aiKeys && cfg.aiKeys.elevenlabs) || '';
        if (raw) localStorage.setItem('ferrari_ai_key_elevenlabs', raw);
      }
    }
    if (!localStorage.getItem('ferrari_ai_key_gemini')) {
      const cfg = window.KPK_CONFIG || {};
      const raw = (cfg.aiKeys && cfg.aiKeys.gemini) || '';
      if (raw) localStorage.setItem('ferrari_ai_key_gemini', raw);
    }

    // Sondear proxy Dalia + ElevenLabs
    setTimeout(() => {
      _probeLocalTtsProxy(true).then((ok) => {
        console.log('[Ferrari/IA] Proxy Dalia local ' + (ok ? '✅ ACTIVO → voz humana' : '⛔ apagado (ejecuta: npm run tts)'));
      }).catch(() => {});
      _probeElevenLabs(false).then((ok) => {
        console.log('[Ferrari/IA] ElevenLabs ' + (ok ? '✅ con créditos → Gigi Bella' : '⛔ sin créditos → Dalia/Mia'));
      }).catch(() => {});
    }, 400);

    // Inicializar / sincronizar modo de voz (prioridad: brand → config → auto_gigi)
    // No pisar jarvis_charon / override manual
    if (localStorage.getItem('kpk_voice_user_override') !== '1') {
      let brandVoice = null;
      try {
        if (window.FerrariBrandDock && typeof window.FerrariBrandDock.getBrand === 'function') {
          brandVoice = window.FerrariBrandDock.getBrand().voiceMode || null;
        }
      } catch (e) {}
      const cfgVoice = (window.KPK_CONFIG && window.KPK_CONFIG.voiceMode) || null;
      const preferred = brandVoice || cfgVoice || 'auto_gigi';
      localStorage.setItem('kpk_voice_mode', preferred);
    } else if (!localStorage.getItem('kpk_voice_mode')) {
      localStorage.setItem('kpk_voice_mode', 'auto_gigi');
    }

    // ─── Selector interactivo de voz ───
    const VOICE_OPTIONS = [
      { id: 'jarvis_charon',     label: '🎩 JARVIS Charon (Gemini · voz del doc)', group: 'JARVIS' },
      { id: 'auto_gigi',         label: '⭐ Auto · Dalia local / Bella / Mia', group: 'Recomendado' },
      { id: 'local_dalia',       label: '🔥 Dalia Neural (npm run tts) — humana gratis', group: 'Humana gratis' },
      { id: 'stream_gigi',       label: 'Mia MX (StreamElements · gratis)', group: 'Humana gratis' },
      { id: 'stream_lucia',      label: 'Lucía ES (gratis)', group: 'Humana gratis' },
      { id: 'stream_penelope',   label: 'Penelope US (gratis)', group: 'Humana gratis' },
      { id: 'elevenlabs_gigi',   label: '🏆 ElevenLabs Gigi (créditos)', group: 'ElevenLabs' },
      { id: 'elevenlabs_daniel', label: '🏆 ElevenLabs Daniel', group: 'ElevenLabs' },
      { id: 'gemini_tts',        label: '🤖 Gemini TTS Kore', group: 'Gemini' },
      { id: 'webspeech',         label: 'Web Speech (robótica — evitar)', group: 'Navegador' }
    ];
    const voicePanel = document.getElementById('kpk-voice-panel');
    const voiceSelectBtn = document.getElementById('kpk-ai-voice-select');
    function _renderVoicePanel() {
      if (!voicePanel) return;
      const current = _getVoiceMode();
      let html = '';
      let lastGroup = '';
      for (const v of VOICE_OPTIONS) {
        if (v.group !== lastGroup) {
          html += `<div style="font-size:10px;font-weight:700;color:#6e6e73;text-transform:uppercase;letter-spacing:0.5px;padding:8px 0 4px;${lastGroup?';border-top:1px solid rgba(255,255,255,0.06);margin-top:4px':''}">${v.group}</div>`;
          lastGroup = v.group;
        }
        const active = v.id === current;
        html += `<div class="kpk-voice-opt" data-voice="${v.id}" style="display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px;cursor:pointer;font-size:12.5px;color:${active?'#00B4FF':'#a1a1a6'};background:${active?'rgba(0,180,255,0.1)':'transparent'}">`;
        html += `<span style="width:14px;height:14px;border-radius:50%;border:2px solid ${active?'#00B4FF':'rgba(255,255,255,0.2)'};display:flex;align-items:center;justify-content:center;flex-shrink:0;">${active?'<span style="width:8px;height:8px;border-radius:50%;background:#00B4FF"></span>':''}</span>`;
        html += `<span>${v.label}</span></div>`;
      }
      voicePanel.innerHTML = html;
      voicePanel.querySelectorAll('.kpk-voice-opt').forEach(el => {
        el.addEventListener('click', () => {
          let voice = el.dataset.voice;
          // Edge directo en Chrome → usar Dalia vía proxy local
          if (String(voice).startsWith('edge_') && !_isMicrosoftEdgeBrowser()) {
            voice = 'local_dalia';
          }
          localStorage.setItem('kpk_voice_mode', voice);
          localStorage.setItem('kpk_voice_user_override', '1');
          _lastUsedVoiceEngine = '';
          _renderVoicePanel();
          setTimeout(() => { voicePanel.style.display = 'none'; }, 300);
          if (_speechEnabled) {
            stopAISpeech();
            setTimeout(() => speakJarvis('Voz cambiada a ' + _voiceModeLabel(voice)), 200);
          }
        });
      });
    }
    // Exponer funcion de refresco para comandos inline (/voces)
    window._kpkRefreshVoice = function() {
      const panel = document.getElementById('kpk-voice-panel');
      if (panel && panel.style.display !== 'none') _renderVoicePanel();
      // Si /voces cambió kpk_voice_mode, marcar override y probar la voz
      if (localStorage.getItem('kpk_voice_mode')) {
        localStorage.setItem('kpk_voice_user_override', '1');
        _lastUsedVoiceEngine = '';
      }
    };

    if (voiceSelectBtn) {
      voiceSelectBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!voicePanel) return;
        const isOpen = voicePanel.style.display !== 'none';
        voicePanel.style.display = isOpen ? 'none' : 'block';
        if (!isOpen) _renderVoicePanel();
      });
      document.addEventListener('click', (e) => {
        if (voicePanel && !voicePanel.contains(e.target) && e.target !== voiceSelectBtn && !voiceSelectBtn.contains(e.target)) {
          voicePanel.style.display = 'none';
        }
      });
    }

    const btnVoice = document.getElementById('kpk-ai-toggle-voice');
    const voiceIcon = document.getElementById('kpk-voice-icon');
    if (btnVoice && voiceIcon) {
      // Mostrar qué motor de voz está activo en el tooltip
      function _updateVoiceTooltip() {
        if (!_speechEnabled) { btnVoice.title = 'Activar voz'; return; }
        const activeMode = _getVoiceMode();
        btnVoice.title = `🎙️ Voz activa: ${_voiceModeLabel(activeMode)}`;
      }

      btnVoice.addEventListener('click', () => {
        _speechEnabled = !_speechEnabled;
        if (!_speechEnabled) {
          // Detener TODO el audio activo (audio element, speechSynthesis, edge tts, audio context)
          stopAISpeech();
          if (window.speechSynthesis) window.speechSynthesis.cancel();
          btnVoice.style.color = 'rgba(255,255,255,0.25)';
          btnVoice.classList.remove('kpk-mute-glow');
          voiceIcon.innerHTML = `
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <line x1="23" y1="9" x2="17" y2="15"></line>
            <line x1="17" y1="9" x2="23" y2="15"></line>
          `;
        } else {
          btnVoice.style.color = '#39FF14';
          btnVoice.classList.add('kpk-mute-glow');
          voiceIcon.innerHTML = `
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
          `;
          playFuturisticSound('click');
          // Pre-cargar Edge TTS en segundo plano para reducir latencia de la primera respuesta
          _loadEdgeTTS().then(_updateVoiceTooltip);
        }
        _updateVoiceTooltip();
      });
    }

    _setupVoiceRecognition();

    // Comprobar visibilidad inicial dentro de Iframe
    checkIframeVisibility();

    // Escuchar cambios de fullscreen y de tamaño de pantalla
    document.addEventListener('fullscreenchange', checkIframeVisibility);
    document.addEventListener('webkitfullscreenchange', checkIframeVisibility);
    document.addEventListener('mozfullscreenchange', checkIframeVisibility);
    document.addEventListener('MSFullscreenChange', checkIframeVisibility);
    window.addEventListener('resize', checkIframeVisibility);

    // Ajustar posición del panel y la burbuja cuando se abre el teclado en móviles
    if (window.visualViewport) {
      const adjustForKeyboard = () => {
        const isMobile = window.innerWidth < 768;
        if (!isMobile) return;
        const panel = document.getElementById('kpk-ai-panel');
        const bubble = document.getElementById('kpk-ai-bubble');
        if (!panel || !bubble) return;

        const offsetBottom = window.innerHeight - window.visualViewport.height;
        if (offsetBottom > 50) {
          // Teclado abierto: desplazar hacia arriba y limitar altura
          panel.style.bottom = `${offsetBottom + 12}px`;
          bubble.style.bottom = `${offsetBottom + 12}px`;
          panel.style.height = `calc(${window.visualViewport.height}px - 100px)`;
        } else {
          // Teclado cerrado: restaurar estilos de la hoja CSS
          panel.style.removeProperty('bottom');
          panel.style.removeProperty('height');
          bubble.style.removeProperty('bottom');
        }
      };
      window.visualViewport.addEventListener('resize', adjustForKeyboard);
      window.visualViewport.addEventListener('scroll', adjustForKeyboard);
    }

    _updateSuggestiveChips();
    console.log('[Ferrari/IA] ✓ Copiloto Inicializado en Cliente');
    const isMobile = window.innerWidth < 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    // ── ONBOARDING: 1) Saludo  2) Pedir cómo llamarte (inmediato)
    _startWelcomeOnboarding(isMobile);
  }

  let _hasGreeted = false;
  let _welcomeSpoken = false;

  function _getAssistantMeta() {
    const brand = (window.FerrariBrandDock && typeof window.FerrariBrandDock.getBrand === 'function')
      ? window.FerrariBrandDock.getBrand() : {};
    const mode = _getVoiceMode();
    const isGigi = mode.includes('gigi') || mode.includes('dalia') || mode.includes('stream') || mode === 'auto_gigi';
    return {
      projectName: brand.projectName || 'Austral 360',
      assistantName: isGigi ? 'Gigi' : 'Jarvis',
      isGigi
    };
  }

  /** Un solo mensaje de bienvenida (texto + voz una sola vez) */
  function _buildWelcomePack() {
    const { projectName, assistantName, isGigi } = _getAssistantMeta();

    if (_clientName) {
      const text = isGigi
        ? `¡Hola, ${_clientName}! Qué gusto tenerte de vuelta en ${projectName}. Soy ${assistantName}. ¿Tour de lotes, o te muestro qué hacer cerca (termas, trekking, lagos)?`
        : `Bienvenido de nuevo, ${_clientName}. Soy ${assistantName}. ¿Tour de lotes o planes de turismo cerca del proyecto?`;
      return {
        messages: [text],
        speakText: text,
        waitingName: false
      };
    }

    const text = isGigi
      ? `¡Hola! Bienvenido a ${projectName}. Soy ${assistantName}, tu asesora virtual. ¿Cómo te gustaría que te llame?`
      : `Bienvenido a ${projectName}. Soy ${assistantName}. ¿Cómo desea que lo llame?`;
    return {
      messages: [text],
      speakText: text,
      waitingName: true
    };
  }

  function _startWelcomeOnboarding(isMobile) {
    try {
      const pack = _buildWelcomePack();
      _isWaitingForName = pack.waitingName;
      _hasGreeted = true;

      // Un solo mensaje en el chat (nada más)
      if (_log) _log.innerHTML = '';
      pack.messages.forEach((msg) => appendMessage(msg, 'system'));

      if (_input) {
        _input.placeholder = pack.waitingName
          ? 'Escribe tu nombre aquí...'
          : 'Pregunta algo aquí o adjunta un archivo...';
        if (pack.waitingName) {
          setTimeout(() => { try { _input.focus(); } catch (e) {} }, 400);
        }
      }

      if (!isMobile && _panel && !_panel.classList.contains('is-open')) {
        _panel.classList.add('is-open');
        _syncAiPanelBodyClass();
      }

      if (isMobile) {
        showMobileBubblePopup(pack.messages[0], true);
      }

      // Precargar Edge TTS para que el saludo no caiga a voz robótica
      _loadEdgeTTS().catch(() => {});

      function _playWelcome(e) {
        // Evita doble disparo click+touchstart en el mismo toque
        if (_welcomeSpoken) return;
        _welcomeSpoken = true;
        window.removeEventListener('click', _playWelcome);
        window.removeEventListener('touchstart', _playWelcome);
        _unlockMobileAudio();
        speakJarvis(pack.speakText);
      }
      window.addEventListener('click', _playWelcome, { passive: true });
      window.addEventListener('touchstart', _playWelcome, { passive: true });
    } catch (err) {
      console.error('[Ferrari/IA] Error en onboarding:', err);
      if (_panel) _panel.classList.add('is-open');
    }
  }

  /** Re-hablar el onboarding si abren el panel y aún no sonó (desktop) */
  function _triggerWelcomeGreeting() {
    if (_welcomeSpoken) return;
    const pack = _buildWelcomePack();
    _welcomeSpoken = true;
    _unlockMobileAudio();
    speakJarvis(pack.speakText);
  }

  function _syncAiPanelBodyClass() {
    try {
      if (_panel && _panel.classList.contains('is-open')) {
        document.body.classList.add('kpk-ai-panel-open');
      } else {
        document.body.classList.remove('kpk-ai-panel-open');
      }
    } catch (e) {}
  }

  function togglePanel() {
    const isMobileDevice = window.innerWidth < 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobileDevice) {
      let popup = document.getElementById('kpk-mobile-ai-bubble-popup');
      const visible =
        popup &&
        popup.classList.contains('is-visible') &&
        popup.style.display !== 'none';

      if (visible && popup.classList.contains('kpk-mbp-minimal')) {
        // Estaba minimizado → expandir para poder escribir
        _mobileHudPinned = true;
        if (_bubblePopupTimeout) clearTimeout(_bubblePopupTimeout);
        expandMobileBubblePopup();
        return;
      }
      if (visible) {
        // Abierto a tamaño completo → cerrar solo si el usuario lo pide
        closeMobileBubblePopup(true);
        return;
      }

      const pack = _buildWelcomePack();
      const txt = pack.waitingName
        ? pack.messages.join('<br><br>')
        : (_clientName
          ? pack.messages.join(' ')
          : pack.speakText);
      _mobileHudPinned = true;
      showMobileBubblePopup(txt, true);
      if (!_welcomeSpoken) {
        _welcomeSpoken = true;
        _unlockMobileAudio();
        speakJarvis(pack.speakText);
      }
      return;
    }
    if (!_panel) return;
    const isOpen = _panel.classList.toggle('is-open');
    _syncAiPanelBodyClass();
    if (isOpen) {
      if (_input) _input.focus();
      playFuturisticSound('start');
      if (!_welcomeSpoken) {
        _triggerWelcomeGreeting();
      }
    } else {
      playFuturisticSound('click');
    }
  }

  // ─── RECONOCIMIENTO DE VOZ (Modo Jarvis Continuo) ───────────────────
  function _setupVoiceRecognition() {
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) {
      _btnMic.style.display = 'none'; // Navegador no compatible
      return;
    }

    _recognition = new Speech();
    _recognition.lang = 'es-ES';
    _recognition.interimResults = false;

    _recognition.onstart = () => {
      _isListening = true;
      // Panel grande
      if (_btnMic) { _btnMic.classList.add('is-active'); _btnMic.style.color = '#FF2D8A'; }
      if (_input) _input.placeholder = '🔴 Escuchando... Habla ahora';
      // Burbuja móvil
      const popupMic = document.getElementById('kpk-mbp-mic-toggle');
      if (popupMic) { popupMic.classList.add('is-active'); popupMic.title = 'Detener micrófono'; }
      const popupMicInline = document.getElementById('kpk-mbp-mic-inline-btn');
      if (popupMicInline) popupMicInline.classList.add('is-active');
    };

    _recognition.onend = () => {
      _isListening = false;
      // Panel grande
      if (_btnMic) { _btnMic.classList.remove('is-active', 'is-recording'); _btnMic.style.removeProperty('color'); }
      if (_input) _input.placeholder = 'Pregunta algo aquí...';
      // Burbuja móvil
      const popupMic = document.getElementById('kpk-mbp-mic-toggle');
      if (popupMic) { popupMic.classList.remove('is-active'); popupMic.title = 'Hablar'; }
      const popupMicInline = document.getElementById('kpk-mbp-mic-inline-btn');
      if (popupMicInline) popupMicInline.classList.remove('is-active');

      // Auto-reiniciar si estamos en modo Jarvis y no se ha detenido a propósito
      if (_jarvisMode && _shouldRestartMic) {
        setTimeout(() => {
          if (_jarvisMode && !_isListening) {
            try { _recognition.start(); } catch(e) {}
          }
        }, 300);
      }
    };

    _recognition.onerror = (e) => {
      _isListening = false;
      const popupMic = document.getElementById('kpk-mbp-mic-toggle');
      if (popupMic) { popupMic.classList.remove('is-active'); }
      const popupMicInline = document.getElementById('kpk-mbp-mic-inline-btn');
      if (popupMicInline) popupMicInline.classList.remove('is-active');
      if (_btnMic) { _btnMic.classList.remove('is-active', 'is-recording'); _btnMic.style.removeProperty('color'); }
      console.warn('[Gigi/Mic] Error de reconocimiento:', e.error);

      // Mostrar toast/alerta visual si es un error de permisos o dispositivo
      if (e.error === 'not-allowed') {
        if (window.FerrariUI && typeof window.FerrariUI.showToast === 'function') {
          window.FerrariUI.showToast('Permiso de micrófono denegado. Actívalo en los ajustes de tu navegador.', 'error');
        } else {
          alert('Por favor, permite el acceso al micrófono en los ajustes de tu navegador para poder hablar.');
        }
      } else if (e.error !== 'aborted' && e.error !== 'no-speech') {
        if (window.FerrariUI && typeof window.FerrariUI.showToast === 'function') {
          window.FerrariUI.showToast(`Error de micrófono: ${e.error}`, 'warning');
        }
      }

      if (e.error === 'aborted' || e.error === 'no-speech') return;
      _jarvisMode = false;
      _shouldRestartMic = false;
    };

    const calculateSimilarity = (str1, str2) => {
      const words1 = str1.toLowerCase().split(/\s+/).filter(Boolean);
      const words2 = str2.toLowerCase().split(/\s+/).filter(Boolean);
      if (!words1.length || !words2.length) return 0;
      const intersection = words1.filter(w => words2.includes(w));
      return intersection.length / Math.max(words1.length, words2.length);
    };

    _recognition.onspeechstart = () => {
      const isSpeaking = _isAISpeaking || _activeJarvisAudio || (_activeAudioCtx && _activeAudioCtx.state === 'running') || (window.speechSynthesis && window.speechSynthesis.speaking) || _activeAudioSource;
      if (isSpeaking) {
        const elapsed = Date.now() - _aiSpeechStartTime;
        // Evitar auto-interrupción por eco inicial (guardia de 1.2 segundos para estabilización)
        if (elapsed > 1200) {
          console.log('[Ferrari/IA] User speech detected (barge-in). Interruption triggered.');
          stopAISpeech();
        } else {
          console.log('[Ferrari/IA] Speech detected too early, ignoring to prevent echo self-interruption.');
        }
      }
    };

    _recognition.onresult = (e) => {
      const resultIdx = e.results.length - 1;
      const txt = e.results[resultIdx][0].transcript.trim();
      if (txt) {
        console.log('[Gigi/Voz] Transcripción de voz recibida:', txt);

        if (_input) _input.value = txt;
        const mbpInput = document.getElementById('kpk-mbp-text-input');
        if (mbpInput) mbpInput.value = txt;

        _isListening = false;
        if (_btnMic) {
          _btnMic.classList.remove('is-active', 'is-recording');
          _btnMic.style.removeProperty('color');
        }
        if (_input) _input.placeholder = "Pregunta algo aquí...";

        // Enviar inmediatamente la transcripción al chat y a la IA
        handleSend();
      }
    };

    // Alternar grabación por micrófono (Clic para hablar / Clic para terminar)
    // Esta función es compartida por el botón del panel grande Y el botón de la burbuja móvil
    window._kpkToggleMic = function(e) {
      if (e) e.preventDefault();
      if (!_recognition) return;

      if (_isListening) {
        // Apagar micrófono
        playFuturisticSound('click');
        try { _recognition.stop(); } catch(err) {}
        // El estado _isListening = false lo actualiza onend automáticamente
      } else {
        // Encender micrófono
        _unlockMobileAudio();
        playFuturisticSound('start');
        try {
          _recognition.continuous = false;
          _recognition.start();
        } catch(err) {
          console.warn('[Gigi/Voz] No se pudo iniciar el micrófono:', err.message);
        }
      }
    };

    if (_btnMic) {
      _btnMic.addEventListener('click', window._kpkToggleMic);
    }
  }

  // ─── CIRCUITO EN CASCADA 3-TIER (REDUNDANCIA AUTOMÁTICA INFALIBLE) ────────
  async function _callAICascade(prompt, context, apiHistory) {
    const cfg = window.KPK_CONFIG || {};
    let brandKeys = null;
    try {
      if (window.FerrariBrandDock && typeof window.FerrariBrandDock.getBrand === 'function') {
        brandKeys = window.FerrariBrandDock.getBrand().aiKeys || null;
      }
    } catch(e) {}

    function _resolveKey(prov) {
      const raw = localStorage.getItem(`ferrari_ai_key_${prov}`)
        || (brandKeys && brandKeys[prov])
        || (cfg.aiKeys && cfg.aiKeys[prov])
        || '';
      return _deobfuscateKey(raw);
    }

    const primaryProv = _provider || 'openrouter';
    const primaryKey = _resolveKey(primaryProv);

    // Cascada de Redundancia Ininterrumpida: Tier 1 -> Tier 2 -> Tier 3
    const cascadeTiers = [
      { provider: primaryProv, key: primaryKey, model: _modelName },
      { provider: 'openrouter', key: _resolveKey('openrouter'), model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free' },
      { provider: 'groq', key: _resolveKey('groq'), model: 'llama-3.1-8b-instant' },
      { provider: 'openrouter', key: _resolveKey('openrouter'), model: 'google/gemma-4-26b-a4b-it:free' }
    ];

    const uniqueTiers = [];
    const seen = new Set();
    for (const tier of cascadeTiers) {
      const sig = `${tier.provider}:${tier.model}`;
      if (!seen.has(sig) && (tier.key || tier.provider === 'openrouter')) {
        seen.add(sig);
        uniqueTiers.push(tier);
      }
    }

    let lastError = null;
    for (let i = 0; i < uniqueTiers.length; i++) {
      const tier = uniqueTiers[i];
      try {
        const messages = [
          { role: 'system', content: context },
          ...apiHistory.map(h => ({ role: h.role, content: h.text }))
        ];

        let url = 'https://openrouter.ai/api/v1/chat/completions';
        if (tier.provider === 'groq') {
          url = 'https://api.groq.com/openai/v1/chat/completions';
        } else if (tier.provider === 'lightning') {
          url = 'https://cors.eu.org/https://lightning.ai/api/v1/chat/completions';
        }

        const headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tier.key}`
        };

        if (tier.provider === 'openrouter') {
          headers['HTTP-Referer'] = window.location.origin || 'https://ilycons.github.io';
          headers['X-Title'] = 'Austral 360 Copilot';
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            model: tier.model,
            messages: messages,
            temperature: 0.3,
            max_tokens: 1000
          })
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error?.message || `Error HTTP ${res.status}`);
        }

        const resJson = await res.json();
        const text = resJson.choices?.[0]?.message?.content;
        if (!text) throw new Error('Respuesta del modelo vacía');

        console.log(`[Ferrari/IA] ✅ Respuesta exitosa en Tier ${i + 1} (${tier.provider})`);
        return { text: text, tier: i + 1, provider: tier.provider, model: tier.model };
      } catch (err) {
        console.warn(`[Ferrari/IA] ⚠️ Tier ${i + 1} (${tier.provider}) falló: ${err.message}. Conmutando al siguiente nivel...`);
        lastError = err;
      }
    }

    throw lastError || new Error('Todos los niveles de cascada de IA fallaron.');
  }

  function _sanitizeDisplayText(raw) {
    if (!raw || typeof raw !== 'string') return '';
    let txt = raw;

    // 1. Si el texto contiene `"text": "..."`, extraer solo el contenido del campo de texto
    const textPropMatch = txt.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (textPropMatch && textPropMatch[1]) {
      txt = textPropMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
    }

    // 2. Quitar bloques de código ```json ... ```
    txt = txt.replace(/```(?:json)?[\s\S]*?```/gi, '');

    // 3. Quitar cualquier objeto o array JSON remanente {...} o [...]
    txt = txt.replace(/\{[\s\S]*?\}/g, '');
    txt = txt.replace(/\[[\s\S]*?\]/g, '');

    // 4. Quitar fugas de prompt del sistema o instrucciones del TTS
    txt = txt.replace(/\*\*\s*Refine\s+Text\s+for\s+TTS[\s\S]*/gi, '');
    txt = txt.replace(/\*\*\s*System\s*Prompt[\s\S]*/gi, '');
    txt = txt.replace(/-?\d+\.\d+,\s*"?lng"?:\s*-?\d+\.\d+/gi, '');

    // 5. Quitar marcas de formato markdown pesadas
    txt = txt.replace(/\*\*+/g, '').replace(/\*+/g, '').replace(/`+/g, '');
    txt = txt.replace(/^[-*+]\s+/gm, '');

    // 6. Limpiar caracteres JSON y comillas sobrantes en extremos
    txt = txt.replace(/^[{\s"']+|[}\s"']+$/g, '').trim();

    return txt;
  }

  function _parseAIResponse(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      return { text: 'Lo siento, no pude procesar la respuesta del servidor.' };
    }

    let cleaned = rawText.trim();
    let mainText = '';
    let actions = [];

    // 1) Intentar parseo directo si la respuesta es JSON puro
    try {
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        const jsonCandidate = cleaned.substring(firstBrace, lastBrace + 1);
        const parsed = JSON.parse(jsonCandidate);
        if (parsed) {
          if (typeof parsed.text === 'string') mainText = parsed.text;
          if (Array.isArray(parsed.actions)) actions = parsed.actions;
        }
      }
    } catch (e1) {}

    // 2) Desinfección completa del texto extraído o del texto plano
    mainText = _sanitizeDisplayText(mainText || cleaned);

    if (!mainText) mainText = 'Entendido. ¿En qué más te puedo ayudar sobre este proyecto?';

    return { text: mainText, actions: actions };
  }

  // ─── ENVIAR Y COMUNICAR CON GEMINI ──────────────────────────────────
  async function handleSend() {
    const prompt = _input.value.trim();
    if (!prompt && !_attachedFile) return;

    // Mantener HUD móvil abierto durante la conversación
    const isMob =
      window.innerWidth < 768 ||
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMob) {
      _mobileHudPinned = true;
      if (_bubblePopupTimeout) clearTimeout(_bubblePopupTimeout);
    }

    // Palabras clave que NUNCA deben guardarse como nombre propio de persona
    const NON_NAME_KEYWORDS = /(?:quiero|busco|necesito|deseo|ver|cu[aá]les|d[oó]nde|lote|parcela|precio|terreno|fotos|cu[aá]nto|hay|tienen|mostrar|acerca|dame|me\s+interesa|camino|vista|recorrido|tour|agua|luz|rol)/i;

    // Interceptar si el usuario solicita cambiar o corregir su nombre (ej: "no me llamo quiero", "me llamo sol", "cambiar nombre")
    if (prompt && /(?:no\s+me\s+llamo|cambiar\s+nombre|mi\s+nombre\s+es|me\s+llamo|soy)\s+/i.test(prompt) && !NON_NAME_KEYWORDS.test(prompt)) {
      let nameClean = prompt.trim();
      nameClean = nameClean.replace(/^(?:no\s+me\s+llamo\s+\w+\s*|cambiar\s+nombre\s+a\s*|mi\s+nombre\s+es\s*|me\s+llamo\s*|soy\s*|llámame\s*)[,\s!]*/gui, '');
      let nameParts = nameClean.trim().split(/[\s,.]+/).filter(Boolean);
      let name = nameParts[0] || '';
      if (name && name.length <= 20 && !NON_NAME_KEYWORDS.test(name)) {
        name = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
        _clientName = name;
        localStorage.setItem('kpk_client_name', name);
        _isWaitingForName = false;
        _input.value = '';
        const mode = _getVoiceMode();
        const isGigi = mode.includes('gigi') || mode.includes('dalia');
        const replyText = isGigi 
          ? `¡Listo! Disculpa la confusión 😊. Ahora te llamaré ${_clientName}. ¿En qué te puedo ayudar hoy?` 
          : `Entendido. Nombre actualizado a ${_clientName}, señor. ¿En qué puedo asistile?`;
        appendMessage(prompt, 'user');
        const isMobile = window.innerWidth < 768;
        if (isMobile) showMobileBubblePopup(replyText, true); else appendMessage(replyText, 'system');
        speakJarvis(replyText);
        _updateSuggestiveChips();
        return;
      }
    }

    // Interceptar si estamos esperando el nombre del cliente (Interacción 2)
    // Agenda de visita: dejar pasar (el widget pide nombre; no bloquear el chip «Agendar»)
    const _isAgendaIntent =
      /(agendar|agenda\s+visita|coordinar\s+(una\s+)?visita|visita\s+presencial|calendario|confirmar\s+(la\s+)?visita)/i.test(
        prompt || ''
      );
    if (_isWaitingForName && prompt && !_isAgendaIntent) {
      const modeWait = _getVoiceMode();
      const isGigiWait = modeWait.includes('gigi') || modeWait.includes('dalia');
      const isMobileWait = window.innerWidth < 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

      // Si manda consulta comercial sin nombre: pedir nombre otra vez (no saltar el onboarding)
      if (NON_NAME_KEYWORDS.test(prompt)) {
        _input.value = '';
        appendMessage(prompt, 'user');
        const nudge = isGigiWait
          ? `¡Me encanta tu ganas! 😊 Antes de eso, ¿cómo te gustaría que te llame? Solo tu nombre y seguimos.`
          : `Entendido. Antes, indíqueme cómo desea que lo llame.`;
        if (isMobileWait) showMobileBubblePopup(nudge, true); else appendMessage(nudge, 'system');
        speakJarvis(nudge);
        return;
      }

      let nameClean = prompt.trim();
      nameClean = nameClean.replace(/^(?:hola|buenos\s+días|buenas\s+tardes|buenas\s+noches|mucho\s+gusto|qué\s+tal|hola\s+gigi|hola\s+jarvis|gigi|jarvis)[,\s!]*/gui, '');
      nameClean = nameClean.replace(/^(?:me\s+llamo|mi\s+nombre\s+es|soy|llámame|puedes\s+llamarme|me\s+dicen|por\s+acá|acá|dime)[,\s!]*/gui, '');
      let nameParts = nameClean.trim().split(/[\s,.]+/).filter(Boolean);
      let name = nameParts[0] || '';
      if (name.length > 20) name = name.substring(0, 20);

      if (name && !NON_NAME_KEYWORDS.test(name) && !/^\d+$/.test(name)) {
        name = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
        _clientName = name;
        localStorage.setItem('kpk_client_name', name);
        _isWaitingForName = false;
        // No forzar TTS al capturar nombre — solo admin reactiva voces
        _jarvisMode = true;
        _shouldRestartMic = true;

        _input.value = '';
        _attachedFile = null;

        const brandObj = (window.FerrariBrandDock && typeof window.FerrariBrandDock.getBrand === 'function') ? window.FerrariBrandDock.getBrand() : {};
        const projectName = brandObj.projectName || 'Austral 360';

        const replyText = isGigiWait
          ? `¡Mucho gusto, ${_clientName}! Qué lindo nombre 😊. Ya quedamos. Te doy la bienvenida a ${projectName}: parcelas con Rol Propio y vistas de ensueño. ¿Te muestro el tour o prefieres un lote en específico?`
          : `Es un honor, ${_clientName}. Bienvenido a ${projectName}. Contamos con parcelas de Rol Propio SAG. ¿Desea un tour panorámico o analizar un lote?`;

        appendMessage(prompt, 'user');
        if (isMobileWait) {
          showMobileBubblePopup(replyText, true);
        } else {
          appendMessage(replyText, 'system');
        }

        if (_input) _input.placeholder = 'Pregunta algo aquí o adjunta un archivo...';

        _unlockMobileAudio();
        speakJarvis(replyText);
        playFuturisticSound('success');
        _updateSuggestiveChips();
        return;
      }

      // Nombre inválido: insistir
      _input.value = '';
      appendMessage(prompt, 'user');
      const retry = isGigiWait
        ? `Uy, no te escuché bien 😊. ¿Me dices solo tu nombre o cómo quieres que te diga?`
        : `No pude registrar el nombre. ¿Cómo desea que lo llame?`;
      if (isMobileWait) showMobileBubblePopup(retry, true); else appendMessage(retry, 'system');
      speakJarvis(retry);
      return;
    }

    // Agregar mensaje de usuario al log con enlace local temporal para descargas
    let userDisplayMsg = prompt || `Adjunto: ${_attachedFile.name}`;
    if (_attachedFile) {
      const blobUrl = URL.createObjectURL(_attachedFile);
      userDisplayMsg += `<div class="kpk-chat-attachment-link" style="margin-top:6px;padding:6px 10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;font-size:11px;display:flex;align-items:center;gap:6px;"><span style="color:#00B4FF;">📎</span> <a href="${blobUrl}" download="${_attachedFile.name}" style="color:#fff;text-decoration:underline;font-weight:600;">Ver/Descargar ${_attachedFile.name}</a></div>`;
    }

    appendMessage(userDisplayMsg, 'user');
    _input.value = '';

    // Interceptar comando de diagnóstico local
    const lowerPrompt = prompt.toLowerCase();
    if (lowerPrompt === '/debug' || lowerPrompt === '/status' || lowerPrompt === '/api') {
      const typingIndicator = showTypingIndicator();
      _bubble.classList.add('is-loading');
      
      setTimeout(() => {
        typingIndicator.remove();
        _bubble.classList.remove('is-loading');
        
        let brandKeys = null;
        let brandProvider = null;
        let configSrc = 'Configuración general (config.js)';
        
        try {
          if (window.FerrariBrandDock && typeof window.FerrariBrandDock.getBrand === 'function') {
            const brandObj = window.FerrariBrandDock.getBrand();
            brandKeys = brandObj.aiKeys || null;
            brandProvider = brandObj.aiProvider || null;
            if (brandProvider) {
              configSrc = 'Identidad publicada (brand.json de GitHub)';
            }
          }
        } catch(e) {}
        
        const localProvider = localStorage.getItem('ferrari_ai_provider');
        if (localProvider) {
          configSrc = 'Caché local de Administración (admin.html)';
        }
        
        const activeProvider = localProvider || brandProvider || (window.KPK_CONFIG && window.KPK_CONFIG.aiProvider) || 'openrouter';
        
        const models = {
          gemini: 'gemini-2.0-flash',
          groq: 'llama-3.1-8b-instant',
          openrouter: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
          lightning: 'google/gemini-3.5-flash'
        };
        const activeModel = models[activeProvider] || 'Desconocido';
        
        const cfg = window.KPK_CONFIG || {};
        const rawKey = localStorage.getItem(`ferrari_ai_key_${activeProvider}`)
          || (brandKeys && brandKeys[activeProvider])
          || (cfg.aiKeys && cfg.aiKeys[activeProvider])
          || '';
          
        const keyPrefix = rawKey ? rawKey.substring(0, 16) + '...' : 'SIN CONFIGURAR';
        const isEncrypted = rawKey && rawKey.startsWith('kpk-enc-');
        
        const diagMsg = `🔧 <b>Diagnóstico de Conexión Copiloto</b><br><br>` +
          `• <b>Proveedor Activo:</b> <code>${activeProvider}</code><br>` +
          `• <b>Origen de Ajustes:</b> <i>${configSrc}</i><br>` +
          `• <b>Modelo Ejecutándose:</b> <code>${activeModel}</code><br>` +
          `• <b>API Key:</b> ${rawKey ? '✅ Cargada' : '❌ Vacía'}<br>` +
          `• <b>Prefijo en memoria:</b> <code>${keyPrefix}</code><br>` +
          `• <b>¿Protegido contra GitGuardian?:</b> ${isEncrypted ? '🔒 Sí (Ofuscada)' : '🔓 No (Texto plano)'}<br>` +
          `• <b>Redundancia Ininterrumpida:</b> 🛡️ Activa (3-Tier Cascade Circuit)<br><br>` +
          `<i>Jarvis está verificado y listo en este cliente.</i>`;
          
        appendMessage(diagMsg, 'system');
        playFuturisticSound('success');
      }, 500);
      return;
    }

    // Comando /voz — muestra el modelo de voz activo del copiloto
    if (lowerPrompt === '/voz') {
      const typingIndicator = showTypingIndicator();
      _bubble.classList.add('is-loading');

      Promise.all([_probeElevenLabs(true), _probeLocalTtsProxy(true)]).then(([elOk, proxyOk]) => {
        typingIndicator.remove();
        _bubble.classList.remove('is-loading');

        const preferred = _getPreferredVoiceMode();
        const mode = _getVoiceMode();
        const lastEngine = _lastUsedVoiceEngine || 'aún no usado';
        const engineLabels = {
          jarvis_charon: 'JARVIS Charon (Gemini TTS)',
          gemini_tts: 'Gemini TTS — Kore',
          local_dalia: 'Dalia/Jorge Neural (proxy local)',
          streamelements: 'StreamElements',
          google_tts: 'Google Translate TTS',
          google_translate: 'Google Translate TTS',
          edge_tts: 'Edge TTS Neural (Dalia)',
          webspeech: 'Web Speech API (robótica)',
          elevenlabs: 'ElevenLabs Gigi Bella'
        };
        const remaining = _elStatus && _elStatus.remaining != null ? _elStatus.remaining : '?';
        const onHttps = typeof location !== 'undefined' && location.protocol === 'https:';
        let proxyLine = proxyOk
          ? `✅ Activo (<code>${LOCAL_TTS_PROXY}</code>)`
          : '⛔ Apagado o bloqueado → ejecuta <code>npm run tts</code>';
        if (!proxyOk && onHttps) {
          proxyLine += '<br>• <b>Aviso HTTPS:</b> si abres GitHub Pages, Chrome puede bloquear localhost. Usa <code>http://127.0.0.1</code> local o Hetzner.';
        }
        if (lastEngine === 'webspeech') {
          proxyLine += '<br>• <b>Por eso oyes robot:</b> cayó a WebSpeech (sin Charon ni Dalia).';
        }

        const vozMsg = `🎙️ <b>Modelo de Voz del Copiloto</b><br><br>` +
          `• <b>Preferencia:</b> <code>${preferred}</code> (${_voiceModeLabel(preferred)})<br>` +
          `• <b>Efectiva ahora:</b> <code>${mode}</code> (${_voiceModeLabel(mode)})<br>` +
          `• <b>Proxy Dalia:</b> ${proxyLine}<br>` +
          `• <b>ElevenLabs créditos:</b> ${elOk ? '✅ OK (' + remaining + ' restantes)' : '⛔ Sin créditos / key inválida'}<br>` +
          `• <b>Último motor:</b> <code>${engineLabels[lastEngine] || lastEngine}</code><br>` +
          `• <b>Saludo hablado:</b> ${_speechEnabled ? '✅ Activado' : '🔇 Silenciado'}<br><br>` +
          `<i>JARVIS: Charon (cupo) → Dalia/Jorge local → resto. Arranca siempre: npm run tts</i>`;

        appendMessage(vozMsg, 'system');
        playFuturisticSound('success');
      });
      return;
    }

    // Comando /voces — selector interactivo de voces
    if (lowerPrompt === '/voces') {
      const current = _getVoiceMode();
      const VOICE_OPTIONS_LOCAL = [
        { id: 'jarvis_charon',     label: '🎩 JARVIS Charon (Gemini · del doc)', group: 'JARVIS' },
        { id: 'auto_gigi',         label: '⭐ Auto · Dalia local / Bella / Mia', group: 'Recomendado' },
        { id: 'local_dalia',       label: '🔥 Dalia Neural (npm run tts) — humana gratis', group: 'Humana gratis' },
        { id: 'stream_gigi',       label: 'Mia MX (StreamElements · gratis)', group: 'Humana gratis' },
        { id: 'stream_lucia',      label: 'Lucía ES (gratis)', group: 'Humana gratis' },
        { id: 'stream_penelope',   label: 'Penelope US (gratis)', group: 'Humana gratis' },
        { id: 'elevenlabs_gigi',   label: '🏆 Gigi Bella (ElevenLabs)', group: 'ElevenLabs' },
        { id: 'elevenlabs_daniel', label: '🏆 Daniel (ElevenLabs)', group: 'ElevenLabs' },
        { id: 'gemini_tts',        label: '🤖 Kore (Gemini TTS)', group: 'Gemini' },
        { id: 'webspeech',         label: 'Web Speech (robótica — evitar)', group: 'Navegador' }
      ];
      let msg = '🎙️ <b>Selecciona una voz:</b><br><br><div style="display:flex;flex-direction:column;gap:6px;">';
      for (const v of VOICE_OPTIONS_LOCAL) {
        const isActive = v.id === current;
        msg += `<div onclick="(function(){localStorage.setItem('kpk_voice_mode','${v.id}');localStorage.setItem('kpk_voice_user_override','1');window._kpkRefreshVoice?.();})()" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;cursor:pointer;border:1px solid ${isActive?'rgba(0,180,255,0.4)':'rgba(255,255,255,0.06)'};background:${isActive?'rgba(0,180,255,0.08)':'rgba(255,255,255,0.02)'};transition:all 0.15s;" onmouseenter="this.style.borderColor='rgba(0,180,255,0.3)';this.style.background='rgba(0,180,255,0.05)'" onmouseleave="this.style.borderColor='${isActive?'rgba(0,180,255,0.4)':'rgba(255,255,255,0.06)'}';this.style.background='${isActive?'rgba(0,180,255,0.08)':'rgba(255,255,255,0.02)'}'">`;
        msg += `<span style="width:16px;height:16px;border-radius:50%;border:2px solid ${isActive?'var(--accent)':'rgba(255,255,255,0.2)'};display:flex;align-items:center;justify-content:center;flex-shrink:0;">${isActive?'<span style="width:8px;height:8px;border-radius:50%;background:var(--accent)"></span>':''}</span>`;
        msg += `<span style="font-size:13px;font-weight:${isActive?'700':'500'};color:${isActive?'var(--accent)':'var(--text)'};">${v.label}</span>`;
        if (isActive) msg += `<span style="margin-left:auto;font-size:10px;color:var(--accent);font-weight:700;">ACTIVA</span>`;
        msg += `</div>`;
      }
      msg += `</div><br><i>Haz clic en una voz para cambiarla al instante.</i>`;
      appendMessage(msg, 'system');
      // Exponer funcion de refresco para los onclick
      window._kpkRefreshVoice = () => {
        localStorage.setItem('kpk_voice_user_override', '1');
        _lastUsedVoiceEngine = '';
        _renderVoicePanel?.();
        const mode = _getVoiceMode();
        const greeting = 'Voz cambiada a ' + _voiceModeLabel(mode);
        if (_speechEnabled) {
          stopAISpeech();
          setTimeout(() => speakJarvis(greeting), 150);
        }
      };
      return;
    }

    // Guardar referencia del archivo localmente para esta interacción
    const fileToUpload = _attachedFile;
    if (window.FerrariUI && typeof window.FerrariUI.clearChatAttachment === 'function') {
      window.FerrariUI.clearChatAttachment();
    }

    // Mostrar burbuja de escribiendo
    const typingIndicator = showTypingIndicator();
    _bubble.classList.add('is-loading');

    let fileUrl = null;
    if (fileToUpload) {
      const bubbleDiv = typingIndicator.querySelector('div') || typingIndicator;
      bubbleDiv.innerHTML = `<span style="font-size:11px;color:#00B4FF;display:flex;align-items:center;gap:4px;">📎 Subiendo ${fileToUpload.name}...</span>`;
      try {
        const formData = new FormData();
        formData.append('file', fileToUpload);
        const uploadRes = await fetch('https://file.io', {
          method: 'POST',
          body: formData
        });
        const uploadData = await uploadRes.json();
        if (uploadData && uploadData.success) {
          fileUrl = uploadData.link;
          console.log('[Ferrari/IA] Archivo subido exitosamente a file.io:', fileUrl);
        } else {
          throw new Error('Upload fallido');
        }
      } catch (uploadErr) {
        console.warn('[Ferrari/IA] Error subiendo a file.io, intentando servicio secundario...', uploadErr);
        try {
          const formData = new FormData();
          formData.append('file', fileToUpload);
          const uploadRes = await fetch('https://tmpfiles.org/api/v1/upload', {
            method: 'POST',
            body: formData
          });
          const uploadData = await uploadRes.json();
          if (uploadData && uploadData.status === 'success') {
            fileUrl = uploadData.data.url;
            console.log('[Ferrari/IA] Archivo subido a tmpfiles:', fileUrl);
          }
        } catch(e) {
          console.error('[Ferrari/IA] Error en todos los servidores de subida:', e);
        }
      }
      bubbleDiv.innerHTML = `<span></span><span></span><span></span>`;
    }

    _activeSendFile = fileToUpload;

    // Enriquecer el prompt del usuario con el enlace del archivo adjunto
    let enrichedPrompt = prompt;
    if (fileToUpload) {
      enrichedPrompt += `\n\n[El usuario adjuntó un archivo: ${fileToUpload.name} - Enlace de descarga: ${fileUrl || 'No se pudo generar enlace público, pero el archivo se adjuntará nativamente si envía el formulario.'}]`;
    }

    // Desactivar temporalmente el mic mientras piensa para evitar auto-escucha
    _shouldRestartMic = false;
    if (_recognition && _isListening) {
      try { _recognition.stop(); } catch(e) {}
    }

    // --- ENRUTADOR LOCAL (HÍBRIDO): Ahorro de Tokens y Conexiones ---
    const localResp = routeLocalQuery(prompt);
    if (localResp) {
      setTimeout(() => {
        typingIndicator.remove();
        _bubble.classList.remove('is-loading');
        if (localResp.text) {
          appendMessage(localResp.text, 'system');
          playFuturisticSound('success');
          speakJarvis(localResp.text);
        } else {
          playFuturisticSound('success');
        }
        if (localResp.actions) {
          executeActions(localResp.actions);
        }
      }, 500);
      return;
    }

    // Si hay una sesión de WebSocket Live de Gemini activa, enviar por ahí
    if (_provider === 'gemini' && _liveWs && _liveWs.readyState === WebSocket.OPEN) {
      typingIndicator.remove();
      _liveWs.send(JSON.stringify({
        clientContent: {
          turns: [{
            role: 'user',
            parts: [{ text: enrichedPrompt }]
          }]
        }
      }));
      return;
    }

    try {
      // 0) Resolver key AHORA (en el momento del request, no al init)
      //    Orden: localStorage -> BrandConfig (de brand.json en dock) -> KPK_CONFIG -> _apiKey guardada al init
      let brandKeys = null;
      let brandProvider = null;
      try {
        if (window.FerrariBrandDock && typeof window.FerrariBrandDock.getBrand === 'function') {
          const brandObj = window.FerrariBrandDock.getBrand();
          brandKeys = brandObj.aiKeys || null;
          brandProvider = brandObj.aiProvider || null;
        }
        if (!brandKeys) {
          const brandStr = localStorage.getItem('ferrari360_brand');
          if (brandStr) {
            const parsed = JSON.parse(brandStr);
            brandKeys = parsed.aiKeys || null;
            if (!brandProvider) brandProvider = parsed.aiProvider || null;
          }
        }
      } catch(e) {}

      // Sincronizar el proveedor activo por si cambió dinámicamente en el backend
      if (brandProvider && brandProvider !== _provider) {
        _provider = brandProvider;
        const models = {
          gemini: 'gemini-2.0-flash',
          groq: 'llama-3.1-8b-instant',
          openrouter: 'google/gemma-4-26b-a4b-it:free',
          lightning: 'google/gemini-3.5-flash'
        };
        _modelName = models[_provider] || models.openrouter;
      }

      const cfg = window.KPK_CONFIG || {};
      let rawKey = localStorage.getItem(`ferrari_ai_key_${_provider}`)
        || (brandKeys && brandKeys[_provider])
        || (cfg.aiKeys && cfg.aiKeys[_provider])
        || _apiKey
        || '';

      // Desofuscar si viene encriptada con prefijo kpk-enc-
      let currentKey = rawKey;
      if (rawKey.startsWith('kpk-enc-')) {
        try {
          const rawBase = rawKey.substring(8);
          currentKey = atob(rawBase).split('').reverse().join('');
        } catch(e) {
          currentKey = rawKey;
        }
      }

      // Persistir para la próxima llamada
      if (currentKey) {
        _apiKey = currentKey;
        localStorage.setItem(`ferrari_ai_key_${_provider}`, currentKey);
      }

      if (!currentKey) {
        throw new Error(`No se encontró una API Key para el proveedor "${_provider}". Configúrala en el panel de administración.`);
      }

      // 1) Generar Contexto dinámico
      const context = buildContextPrompt();

      // 2) Crear historial temporal para la API (limitado a los últimos 6 turnos para evitar saturación de TPM/tokens)
      const slicedHistory = _chatHistory.slice(-6);
      const apiHistory = [...slicedHistory, { role: 'user', text: enrichedPrompt }];

      let responseText = null;
      let audioData = null;

      if (_provider === 'gemini') {
        // --- PROVEEDOR: GEMINI NATIVO ---
        const geminiHistory = apiHistory.map(h => ({
          role: h.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: h.text }]
        }));

        const requestBody = {
          systemInstruction: { parts: [{ text: context }] },
          contents: geminiHistory,
          generationConfig: {
            responseMimeType: 'application/json',
            responseModalities: ["TEXT", "AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } } }
          }
        };

        const isAccessToken = currentKey.startsWith('ya29.') || currentKey.startsWith('AQ.');
        const url = isAccessToken
          ? `https://generativelanguage.googleapis.com/v1beta/models/${_modelName}:generateContent`
          : `https://generativelanguage.googleapis.com/v1beta/models/${_modelName}:generateContent?key=${currentKey}`;

        const headers = { 'Content-Type': 'application/json' };
        if (isAccessToken) headers['Authorization'] = `Bearer ${currentKey}`;

        try {
          const response = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(requestBody) });
          if (response.ok) {
            const resJson = await response.json();
            const parts = resJson.candidates?.[0]?.content?.parts || [];
            for (const part of parts) {
              if (part.text) responseText = part.text;
              else if (part.inlineData) audioData = part.inlineData.data;
            }
          }
        } catch(gErr) {
          console.warn('[Ferrari/IA] Gemini nativo falló, ejecutando cascada de redundancia...', gErr);
        }
      }

      // Si Gemini nativo no devolvió respuesta o estamos en OpenRouter/Groq/Lightning, ejecutar Circuito en Cascada (3-Tier Cascade)
      if (!responseText) {
        const cascadeResult = await _callAICascade(enrichedPrompt, context, apiHistory);
        responseText = cascadeResult.text;
      }

      // 4) Remover burbuja escribiendo
      typingIndicator.remove();

      if (!responseText) {
        throw new Error('La respuesta del modelo de IA está vacía');
      }

      // 5) Parsear respuesta de IA con tolerancia total a fallos
      const data = _parseAIResponse(responseText);

      // Agregar respuesta de IA al log
      appendMessage(data.text, 'system');
      playFuturisticSound('success');
      
      // Hablar respuesta mediante el motor de voz de Gigi
      if (_speechEnabled) {
        speakJarvis(data.text);
      }
      
      // Guardar el turno completo en el historial permanente (sólo tras éxito)
      _chatHistory.push({ role: 'user', text: prompt });
      _chatHistory.push({ role: 'assistant', text: responseText });

      // Limitar historial a los últimos 6 turnos (12 entradas) para ahorrar tokens
      if (_chatHistory.length > 12) {
        _chatHistory = _chatHistory.slice(_chatHistory.length - 12);
      }

      // 6) Ejecutar acciones estructuradas en el plano 360°
      if (Array.isArray(data.actions)) {
        executeActions(data.actions);
      }

    } catch (e) {
      console.error('[Ferrari/IA] Error procesando consulta con proveedor ' + _provider + ':', e);

      // --- REINTENTO AUTOMÁTICO VÍA OPENROUTER (FALLBACK DE EMERGENCIA PARA CORS / RED) ---
      if (_provider !== 'openrouter' || e.message.includes('Failed to fetch') || e.message.includes('429')) {
        console.warn('[Ferrari/IA] Intentando fallback automático vía OpenRouter...');
        try {
          const cfg = window.KPK_CONFIG || {};
          const fallbackRawKey = (cfg.aiKeys && cfg.aiKeys.openrouter) || '';
          let fallbackKey = fallbackRawKey;
          if (fallbackRawKey && fallbackRawKey.startsWith('kpk-enc-')) {
            fallbackKey = atob(fallbackRawKey.substring(8)).split('').reverse().join('');
          }
          
          if (fallbackKey) {
            const fallbackBody = {
              model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
              messages: [
                { role: 'system', content: context },
                ...apiHistory.map(h => ({ role: h.role, content: h.text }))
              ],
              temperature: 0.3,
              max_tokens: 1000
            };
            
            const fbRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${fallbackKey}`,
                'HTTP-Referer': window.location.origin || 'https://ilycons.github.io',
                'X-Title': 'Austral 360 Copilot'
              },
              body: JSON.stringify(fallbackBody)
            });
            
            if (fbRes.ok) {
              const fbJson = await fbRes.json();
              const fbText = fbJson.choices?.[0]?.message?.content;
              if (fbText) {
                const fbData = _parseAIResponse(fbText);
                typingIndicator.remove();
                appendMessage(fbData.text, 'system');
                playFuturisticSound('success');
                speakJarvis(fbData.text);
                if (Array.isArray(fbData.actions)) executeActions(fbData.actions);
                _chatHistory.push({ role: 'user', text: prompt });
                _chatHistory.push({ role: 'assistant', text: fbText });
                return;
              }
            }
          }
        } catch (fbErr) {
          console.error('[Ferrari/IA] Fallback automático también falló:', fbErr);
        }
      }

      typingIndicator.remove();

      let friendlyError = 'Lo siento, tuve un problema conectando con el servicio de IA.';
      if (e.message.includes('429')) {
        friendlyError = 'Límite de velocidad de la IA excedido (429: Too Many Requests). Por favor, espera unos segundos y vuelve a intentar.';
      } else if (e.message.includes('401') || e.message.includes('403') || e.message.includes('Invalid API key')) {
        friendlyError = 'Error de autenticación (401/403). Confirma que la API Key en el panel de administración esté bien configurada.';
      } else {
        friendlyError += ` Detalles: ${e.message}`;
      }

      appendMessage(friendlyError, 'system');
    } finally {
      _bubble.classList.remove('is-loading');
      _activeSendFile = null;
      // Auto-reiniciar micrófono si el modo Jarvis sigue activo
      if (_jarvisMode) {
        _shouldRestartMic = true;
        setTimeout(() => {
          if (_jarvisMode && !_isListening) {
            try { _recognition.start(); } catch(e) {}
          }
        }, 600);
      }
      _updateSuggestiveChips();
    }
  }

  async function offerTourismCategory(category) {
    if (!window.FerrariTourism) return;
    if (window.FerrariTourism.isOpen && window.FerrariTourism.isOpen()) {
      window.FerrariTourism.closeWidget();
    }
    const menu =
      typeof window.FerrariTourism.prepareOfferMenu === 'function'
        ? await window.FerrariTourism.prepareOfferMenu(category === 'nearest' ? 'nearest' : category, {
            limit: 8
          })
        : null;

    if (!menu || !menu.items || !menu.items.length) {
      appendMessage(
        'En este momento no tengo lugares con foto o video <b>verificado</b> en ese radio. Prueba Termas, Trekking, Lagos o Pueblos.',
        'system'
      );
      return;
    }

    const html =
      typeof window.FerrariTourism.formatMenuHtml === 'function'
        ? window.FerrariTourism.formatMenuHtml(menu)
        : `Tengo ${menu.items.length} opciones de cerca a lejos. ¿Cuál te muestro?`;
    appendMessage(html, 'system');
    try {
      if (typeof speakJarvis === 'function') {
        const plain = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        speakJarvis(plain.slice(0, 280));
      }
    } catch (e) {}

    _mobileHudPinned = true;
    if (_bubblePopupTimeout) clearTimeout(_bubblePopupTimeout);

    const chipActions = [];
    chipActions.push({
      label: '📍 El más cercano',
      featured: true,
      onClick: async () => {
        if (window.FerrariTourism.selectOfferByPoiId) {
          window.FerrariTourism.selectOfferByPoiId(menu.items[0].poiId);
        }
        _clearActionChips();
        const ok = await window.FerrariTourism.confirmPendingOffer();
        if (!ok) {
          appendMessage('No pude verificar media de ese lugar. Elige otro del listado.', 'system');
        }
      }
    });
    menu.items.forEach((it) => {
      chipActions.push({
        label: it.chipLabel || it.title,
        onClick: async () => {
          if (window.FerrariTourism.selectOfferByPoiId) {
            window.FerrariTourism.selectOfferByPoiId(it.poiId);
          }
          _clearActionChips();
          const ok = await window.FerrariTourism.confirmPendingOffer();
          if (!ok) {
            appendMessage('No pude verificar media de ese lugar. Elige otro del listado.', 'system');
          }
        }
      });
    });
    chipActions.push({
      label: 'Ahora no',
      ghost: true,
      onClick: () => {
        window.FerrariTourism.clearPendingOffer();
        _clearActionChips();
        appendMessage('Cuando quieras, pide termas, trekking, lagos o “qué hacer cerca”.', 'system');
      }
    });
    _renderActionChips(chipActions);
  }

  /** Chips de sugerencia (query → handleSend) en desktop + HUD móvil */
  function _pushSuggestChips(items) {
    items = items || [];
    _actionChipsActive = false;
    const chips = document.getElementById('kpk-ai-chips-container');
    if (chips) {
      chips.innerHTML = '';
      chips.classList.remove('kpk-ai-chips-container--carousel');
      items.forEach((it) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'kpk-suggest-chip';
        b.textContent = it.label;
        b.setAttribute('data-query', it.query);
        b.addEventListener('click', () => {
          _mobileHudPinned = true;
          if (_bubblePopupTimeout) clearTimeout(_bubblePopupTimeout);
          if (_input) _input.value = it.query;
          handleSend();
        });
        chips.appendChild(b);
      });
      requestAnimationFrame(_refreshChipsNav);
    }

    const isMobile =
      window.innerWidth < 768 ||
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (!isMobile) return;

    let popup = document.getElementById('kpk-mobile-ai-bubble-popup');
    if (popup) {
      popup.classList.remove('kpk-mbp-minimal');
      popup.style.display = 'flex';
      popup.classList.add('is-visible');
      const inputRow = popup.querySelector('#kpk-mbp-input-row');
      const controlsRow = popup.querySelector('#kpk-mbp-controls-row');
      if (inputRow && controlsRow) {
        inputRow.style.display = 'flex';
        controlsRow.style.display = 'none';
      }
    }
    let mobile = document.getElementById('kpk-mbp-chips-row');
    if (!mobile && popup) {
      const body = popup.querySelector('.kpk-mbp-body');
      if (body) {
        mobile = document.createElement('div');
        mobile.id = 'kpk-mbp-chips-row';
        mobile.className = 'kpk-mbp-chips-row';
        body.appendChild(mobile);
      }
    }
    if (mobile) {
      mobile.innerHTML = '';
      mobile.style.display = items.length ? 'flex' : 'none';
      items.forEach((it) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'kpk-mbp-chip';
        b.textContent = it.label;
        b.setAttribute('data-query', it.query);
        b.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          _mobileHudPinned = true;
          if (_bubblePopupTimeout) clearTimeout(_bubblePopupTimeout);
          if (_input) _input.value = it.query;
          handleSend();
        });
        mobile.appendChild(b);
      });
    }
  }

  function _clearActionChips() {
    _actionChipsActive = false;
    const chips = document.getElementById('kpk-ai-chips-container');
    if (chips) {
      chips.innerHTML = '';
      chips.classList.remove('kpk-ai-chips-container--carousel');
    }
    const mobile = document.getElementById('kpk-mbp-chips-row');
    if (mobile) {
      mobile.innerHTML = '';
      mobile.style.display = 'none';
    }
    requestAnimationFrame(_refreshChipsNav);
  }

  /** Pinta chips de acción en desktop + HUD móvil */
  function _renderActionChips(actions) {
    actions = actions || [];
    _actionChipsActive = actions.length > 0;
    _mobileHudPinned = true;
    if (_bubblePopupTimeout) clearTimeout(_bubblePopupTimeout);

    const chips = document.getElementById('kpk-ai-chips-container');
    if (chips) {
      chips.innerHTML = '';
      chips.classList.add('kpk-ai-chips-container--carousel');
      actions.forEach((act) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className =
          'kpk-ai-chip' +
          (act.featured ? ' kpk-ai-chip--featured' : '') +
          (act.ghost ? ' kpk-ai-chip--ghost' : '');
        b.textContent = act.label;
        b.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          _mobileHudPinned = true;
          if (_bubblePopupTimeout) clearTimeout(_bubblePopupTimeout);
          act.onClick();
        });
        chips.appendChild(b);
      });
      requestAnimationFrame(_refreshChipsNav);
    }

    const isMobile =
      window.innerWidth < 768 ||
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (!isMobile) return;

    let popup = document.getElementById('kpk-mobile-ai-bubble-popup');
    if (popup) {
      popup.classList.remove('kpk-mbp-minimal');
      popup.style.display = 'flex';
      popup.classList.add('is-visible');
      const inputRow = popup.querySelector('#kpk-mbp-input-row');
      const controlsRow = popup.querySelector('#kpk-mbp-controls-row');
      if (inputRow && controlsRow) {
        inputRow.style.display = 'flex';
        controlsRow.style.display = 'none';
      }
    }
    let mobile = document.getElementById('kpk-mbp-chips-row');
    if (!mobile && popup) {
      const body = popup.querySelector('.kpk-mbp-body');
      if (body) {
        mobile = document.createElement('div');
        mobile.id = 'kpk-mbp-chips-row';
        mobile.className = 'kpk-mbp-chips-row';
        body.appendChild(mobile);
      }
    }
    if (mobile) {
      mobile.innerHTML = '';
      mobile.style.display = 'flex';
      actions.forEach((act) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className =
          'kpk-mbp-chip' +
          (act.featured ? ' kpk-mbp-chip--featured' : '') +
          (act.ghost ? ' kpk-mbp-chip--ghost' : '');
        b.textContent = act.label;
        b.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          _mobileHudPinned = true;
          if (_bubblePopupTimeout) clearTimeout(_bubblePopupTimeout);
          act.onClick();
        });
        mobile.appendChild(b);
      });
    }
  }

  async function openTourismFromAction(act) {
    if (!window.FerrariTourism) return;
    if (act.poiId) {
      await window.FerrariTourism.openWidget({ poiId: act.poiId });
      return;
    }
    if (act.category) {
      // Solo abrir si venía confirmación explícita en la acción
      if (act.confirmed === true || act.confirm === true) {
        await window.FerrariTourism.openWidget({ category: act.category });
      } else {
        await offerTourismCategory(act.category);
      }
    }
  }

  // ─── ACCIONES CLIENT-SIDE ───────────────────────────────────────────
  /** Completa lookAt ↔ ficha para que el UI siempre acompañe al lote del que se habla */
  function _enrichSceneActions(actions) {
    if (!Array.isArray(actions) || !actions.length) return actions || [];
    const out = actions.slice();
    const look = out.find((a) => a.type === 'lookAtLote');
    const panel = out.find((a) => a.type === 'openLotePanel');
    const gal = out.find((a) => a.type === 'openGallery');
    const pdf = out.find((a) => a.type === 'downloadPDF');
    const fin = out.find((a) => a.type === 'openFinanceWidget');

    let focusId =
      (look && look.loteId) ||
      (panel && panel.loteId) ||
      (gal && gal.loteId) ||
      (pdf && pdf.loteId) ||
      (fin && fin.loteId) ||
      null;

    if (!focusId && _activeLote && (gal || pdf || fin || look || panel)) {
      focusId = _activeLote.id;
    }

    if (focusId) {
      if (!out.some((a) => a.type === 'lookAtLote')) {
        out.unshift({ type: 'lookAtLote', loteId: focusId, hfov: 70 });
      }
      if (!out.some((a) => a.type === 'openLotePanel')) {
        out.push({ type: 'openLotePanel', loteId: focusId });
      }
      if (!out.some((a) => a.type === 'highlightLotes')) {
        out.push({
          type: 'highlightLotes',
          loteIds: [focusId],
          color: 'rgba(0, 255, 128, 0.55)'
        });
      }
    }
    return out;
  }

  function executeActions(actions) {
    const enriched = _enrichSceneActions(actions);
    autoCloseUnusedWidgets(enriched);
    enriched.forEach(act => {
      try {
        switch (act.type) {
          case 'lookAtLote':
            lookAtLote(act.loteId, act.hfov);
            // Pulsar el Smart Pin del lote para que el usuario lo vea claramente
            pulseSmartPin(act.loteId);
            break;
          case 'openLotePanel':
            // Si hay zoom/mirar en el mismo bloque, abrir ficha tras el giro (snappy)
            const hasLookAt = enriched.some(a => a.type === 'lookAtLote');
            if (hasLookAt) {
              setTimeout(() => {
                openLotePanel(act.loteId);
              }, 520);
            } else {
              openLotePanel(act.loteId);
            }
            break;
          case 'highlightLotes':
            highlightLotes(act.loteIds, act.color);
            break;
          case 'clearHighlights':
            clearHighlights();
            break;
          case 'submitLead':
            submitLead(act.name, act.email, act.phone, act.loteId, act.notes);
            break;
          case 'setNearbyRadius':
            if (window.FerrariBuyerDock && typeof window.FerrariBuyerDock.setRadius === 'function') {
              window.FerrariBuyerDock.setRadius(act.radiusKm);
              if (act.category && typeof window.FerrariBuyerDock.setFilter === 'function') {
                window.FerrariBuyerDock.setFilter(act.category);
              }
              if (typeof window.FerrariBuyerDock.searchNearby === 'function') {
                window.FerrariBuyerDock.searchNearby();
              }
            }
            break;
          case 'openNearbyTab':
            if (window.FerrariBuyerDock) {
              if (typeof window.FerrariBuyerDock.setExpanded === 'function') {
                window.FerrariBuyerDock.setExpanded(true);
              }
              if (typeof window.FerrariBuyerDock.setTab === 'function') {
                window.FerrariBuyerDock.setTab('lugares');
              }
            }
            break;
          case 'filterNearby':
            if (window.FerrariBuyerDock) {
              if (typeof window.FerrariBuyerDock.setExpanded === 'function') window.FerrariBuyerDock.setExpanded(true);
              if (typeof window.FerrariBuyerDock.setTab === 'function') window.FerrariBuyerDock.setTab('lugares');
              if (act.category && typeof window.FerrariBuyerDock.setFilter === 'function') {
                window.FerrariBuyerDock.setFilter(act.category);
              }
            }
            break;
          case 'focusNearbyPOI':
            focusNearbyPOI(act.poiName || act.poiId);
            break;
          case 'openMapWidget':
            openMapWidget(act.lat, act.lng, act.title);
            break;
          case 'closeMapWidget':
            closeMapWidget();
            break;
          case 'openWeatherWidget':
            openWeatherWidget();
            break;
          case 'openGallery':
            openGalleryForLote(act.loteId || null);
            break;
          case 'startAutoTour':
            startAutoTour();
            break;
          case 'stopAutoTour':
            stopAutoTour();
            break;
          case 'showStats':
            showStatsWidget();
            break;
          case 'showPriceComparison':
            showPriceWidget();
            break;
          case 'highlightAvailable':
            highlightAvailableLotes();
            break;
          case 'downloadPDF':
            const currentLote = window.FerrariUI && typeof window.FerrariUI.getCurrentLoteId === 'function' ? window.FerrariUI.getCurrentLoteId() : null;
            const targetLoteId = act.loteId || (_activeLote && _activeLote.id) || currentLote;
            if (targetLoteId) {
              if (typeof openLotePanel === 'function') openLotePanel(targetLoteId);
              setTimeout(() => {
                const pdfBtn = document.getElementById('spec-btn-pdf');
                if (pdfBtn) pdfBtn.click();
              }, 650);
            }
            break;
          case 'openCalendarWidget':
            openCalendarWidget(act.loteId || null, act);
            break;
          case 'fillCalendarVisit':
            fillCalendarVisit(act);
            break;
          case 'confirmCalendarVisit':
            confirmCalendarVisit();
            break;
          case 'closeCalendarWidget':
            closeCalendarWidget();
            break;
          case 'openFinanceWidget':
            openFinanceWidget(act.loteId || null);
            break;
          case 'openUrlInNewTab':
            window.open(act.url, '_blank', 'noopener');
            break;
          case 'offerTourism':
            offerTourismCategory(act.category || act.cat || '');
            break;
          case 'openTourismWidget':
            openTourismFromAction(act);
            break;
          case 'closeTourismWidget':
            if (window.FerrariTourism) window.FerrariTourism.closeWidget();
            break;
          case 'confirmTourismOffer':
            if (window.FerrariTourism) window.FerrariTourism.confirmPendingOffer();
            break;
          default:
            console.warn('[Ferrari/IA] Acción no soportada:', act.type);
        }
      } catch (err) {
        console.warn('[Ferrari/IA] Error ejecutando acción:', act, err);
      }
    });
  }

  function focusNearbyPOI(query) {
    if (!query) return;
    const cleanQ = String(query).toLowerCase().trim();
    let pins = [];
    try {
      pins = (window.FerrariGeo && window.FerrariGeo.pins) || [];
    } catch(e) {}

    // Buscar pin por ID o por coincidencia de nombre
    let targetPin = pins.find(p => p.id === query || (p.nombre && p.nombre.toLowerCase().includes(cleanQ)));
    if (!targetPin) {
      targetPin = pins.find(p => p.categoria && p.categoria.toLowerCase().includes(cleanQ));
    }

    if (window.FerrariBuyerDock) {
      if (typeof window.FerrariBuyerDock.setExpanded === 'function') window.FerrariBuyerDock.setExpanded(true);
      if (typeof window.FerrariBuyerDock.setTab === 'function') window.FerrariBuyerDock.setTab('lugares');
    }

    if (targetPin) {
      const viewer = window.Ferrari && window.Ferrari.viewer;
      if (viewer && targetPin.yaw != null) {
        try {
          if (typeof viewer.lookAt === 'function') {
            const targetPitch = targetPin.pitch != null ? Math.max(-20, Math.min(15, targetPin.pitch)) : 0;
            viewer.lookAt(targetPitch, targetPin.yaw, 75, 1200);
          } else if (typeof viewer.setYaw === 'function') {
            viewer.setYaw(targetPin.yaw);
          }
        } catch(e) {}
      }

      if (targetPin.lat != null && targetPin.lng != null) {
        openMapWidget(targetPin.lat, targetPin.lng, targetPin.nombre || 'Punto de Interés');
      }
    }
  }

  // ─── WEATHER WIDGET ───────────────────────────────────────────────────────
  function openWeatherWidget() {
    let widget = document.getElementById('kpk-weather-widget');
    if (!widget) {
      // Si el widget no existe, disparar refresh para que f-weather.js lo cree
      if (window.FerrariWeather && typeof window.FerrariWeather.refresh === 'function') {
        window.FerrariWeather.refresh();
      }
      widget = document.getElementById('kpk-weather-widget');
    }
    if (widget) {
      widget.style.display = '';
      widget.classList.add('kpk-widget-jarvis-highlight');
      setTimeout(() => widget && widget.classList.remove('kpk-widget-jarvis-highlight'), 2000);
    }
  }

  // ─── GALERÍA DE FOTOS DEL LOTE ────────────────────────────────────────────
  function openGalleryForLote(loteId) {
    const lote = loteId ? findLoteById(loteId) : _activeLote;
    if (!lote) {
      appendMessage('Ciertamente, señor. Para abrir la galería primero seleccione un lote específico.', 'system');
      return;
    }
    const fotos = Array.isArray(lote.fotos) ? lote.fotos.filter(f => f && f.src) : [];
    if (!fotos.length) {
      appendMessage(`Si me permite, el Lote ${lote.titulo} aún no tiene fotos cargadas en el sistema. Puede añadirlas desde el panel de administración.`, 'system');
      return;
    }
    if (window.FerrariGallery && typeof window.FerrariGallery.open === 'function') {
      window.FerrariGallery.open({ title: `Lote ${lote.titulo}`, fotos, startIndex: 0 });
    }
  }

  // ─── AUTO TOUR CINEMATOGRÁFICO ────────────────────────────────────────────
  let _autoTourActive = false;
  let _autoTourTimers = [];

  function stopAutoTour() {
    _autoTourActive = false;
    _autoTourTimers.forEach(t => clearTimeout(t));
    _autoTourTimers = [];
    // Cerrar widgets de tour si existen
    const tw = document.getElementById('kpk-tour-overlay');
    if (tw) tw.remove();
  }

  function startAutoTour() {
    stopAutoTour(); // cancelar cualquier tour previo
    _autoTourActive = true;

    const lotes = (window.allDrawnLines || [])
      .filter(l => l.tipo === 'lote-libre' || l.tipo === 'lote-organico');

    if (!lotes.length) {
      appendMessage('No hay lotes configurados en el plano para realizar el tour, señor.', 'system');
      return;
    }

    // Crear overlay de tour con progress
    let tourOverlay = document.createElement('div');
    tourOverlay.id = 'kpk-tour-overlay';
    tourOverlay.className = 'kpk-tour-overlay';
    tourOverlay.innerHTML = `
      <div class="kpk-tour-bar">
        <span class="kpk-tour-label">🎬 Tour Automático</span>
        <div class="kpk-tour-progress-wrap">
          <div class="kpk-tour-progress-fill" id="kpk-tour-fill"></div>
        </div>
        <span class="kpk-tour-counter" id="kpk-tour-counter">0 / ${lotes.length}</span>
        <button class="kpk-tour-stop" id="kpk-tour-stop">✕ Detener</button>
      </div>
    `;
    document.body.appendChild(tourOverlay);
    tourOverlay.querySelector('#kpk-tour-stop').addEventListener('click', () => {
      stopAutoTour();
      appendMessage('Tour detenido. ¿Hay algún lote específico que desea explorar, señor?', 'system');
    });

    const DELAY_PER_LOTE = 4000; // 4 segundos por lote
    const totalMs = lotes.length * DELAY_PER_LOTE;

    lotes.forEach((lote, i) => {
      const t = setTimeout(() => {
        if (!_autoTourActive) return;

        // Actualizar UI del tour
        const fill = document.getElementById('kpk-tour-fill');
        const counter = document.getElementById('kpk-tour-counter');
        if (fill) fill.style.width = `${((i + 1) / lotes.length) * 100}%`;
        if (counter) counter.textContent = `${i + 1} / ${lotes.length}`;

        // Girar cámara al lote
        lookAtLote(lote.id, 70);
        pulseSmartPin(lote.id);
        _activeLote = lote;
        _updateSuggestiveChips();

        // Resaltar el lote actual
        clearHighlights();
        highlightLotes([lote.id], 'rgba(57, 255, 20, 0.55)');

        // Mensaje en el chat para el primer y último lote
        if (i === 0) {
          appendMessage(`Tour iniciado. Recorriendo ${lotes.length} lotes. Lote ${lote.titulo} — ${lote.estado || 'disponible'}.`, 'system');
        } else if (i === lotes.length - 1) {
          const finT = setTimeout(() => {
            if (!_autoTourActive) return;
            stopAutoTour();
            clearHighlights();
            appendMessage(`Tour completado, señor. Hemos recorrido los ${lotes.length} lotes del proyecto. ¿Alguno le llamó la atención? Puedo abrir su ficha, mostrar sus fotos o calcular la ruta de acceso.`, 'system');
            speakJarvis(`Tour completado. Hemos recorrido los ${lotes.length} lotes. ¿Alguno le llamó la atención?`);
          }, DELAY_PER_LOTE - 500);
          _autoTourTimers.push(finT);
        }
      }, i * DELAY_PER_LOTE);
      _autoTourTimers.push(t);
    });
  }

  // ─── WIDGET DE ESTADÍSTICAS DEL PROYECTO ─────────────────────────────────
  function showStatsWidget() {
    const existing = document.getElementById('kpk-stats-widget');
    if (existing) { existing.remove(); return; } // toggle

    const lotes = (window.allDrawnLines || [])
      .filter(l => l.tipo === 'lote-libre' || l.tipo === 'lote-organico');

    const total = lotes.length;
    const disponibles = lotes.filter(l => l.estado === 'disponible' || !l.estado).length;
    const vendidos = lotes.filter(l => l.estado === 'vendido').length;
    const reservados = lotes.filter(l => l.estado === 'reservado').length;
    const conPrecio = lotes.filter(l => l.valorUF && !isNaN(parseFloat(l.valorUF)));
    const precios = conPrecio.map(l => parseFloat(l.valorUF)).sort((a, b) => a - b);
    const precioMin = precios.length ? precios[0].toFixed(0) : '–';
    const precioMax = precios.length ? precios[precios.length - 1].toFixed(0) : '–';
    const superficies = lotes.filter(l => l.dimensiones).map(l => parseFloat(l.dimensiones)).filter(v => !isNaN(v));
    const supProm = superficies.length ? (superficies.reduce((a, b) => a + b, 0) / superficies.length).toFixed(0) : '–';

    const widget = document.createElement('div');
    widget.id = 'kpk-stats-widget';
    widget.className = 'kpk-stats-widget kpk-float-widget';
    widget.innerHTML = `
      <div class="kpk-fw-header">
        <span class="kpk-fw-title">📊 Estadísticas del Proyecto</span>
        <button class="kpk-fw-close" onclick="this.closest('#kpk-stats-widget').remove()">×</button>
      </div>
      <div class="kpk-stats-grid">
        <div class="kpk-stat-card kpk-stat-total">
          <span class="kpk-stat-val">${total}</span>
          <span class="kpk-stat-lbl">Lotes Totales</span>
        </div>
        <div class="kpk-stat-card kpk-stat-disp">
          <span class="kpk-stat-val">${disponibles}</span>
          <span class="kpk-stat-lbl">Disponibles</span>
        </div>
        <div class="kpk-stat-card kpk-stat-vend">
          <span class="kpk-stat-val">${vendidos}</span>
          <span class="kpk-stat-lbl">Vendidos</span>
        </div>
        <div class="kpk-stat-card kpk-stat-res">
          <span class="kpk-stat-val">${reservados}</span>
          <span class="kpk-stat-lbl">Reservados</span>
        </div>
      </div>
      <div class="kpk-stats-info">
        <div class="kpk-si-row"><span>Precio mínimo</span><strong>${precioMin} UF</strong></div>
        <div class="kpk-si-row"><span>Precio máximo</span><strong>${precioMax} UF</strong></div>
        <div class="kpk-si-row"><span>Superficie promedio</span><strong>${supProm} m²</strong></div>
      </div>
      <button class="kpk-stats-cta" onclick="
        if(window.FerrariUI && window.FerrariUI.injectBotMessage)
          window.FerrariUI.injectBotMessage('¿Cuáles están disponibles?');
        this.closest('#kpk-stats-widget').remove();
      ">Ver lotes disponibles →</button>
    `;
    document.body.appendChild(widget);
    // Auto-cerrar en 18 segundos
    setTimeout(() => widget.isConnected && widget.remove(), 18000);
    if (window.FerrariDrag) {
      window.FerrariDrag.attach(widget, { handle: '.kpk-fw-header' });
    }
  }

  // ─── WIDGET DE COMPARACIÓN DE PRECIOS ────────────────────────────────────
  function showPriceWidget() {
    const existing = document.getElementById('kpk-price-widget');
    if (existing) { existing.remove(); return; }

    const lotes = (window.allDrawnLines || [])
      .filter(l => (l.tipo === 'lote-libre' || l.tipo === 'lote-organico') && l.valorUF)
      .sort((a, b) => parseFloat(a.valorUF || 0) - parseFloat(b.valorUF || 0))
      .slice(0, 8); // Top 8

    if (!lotes.length) {
      appendMessage('No hay lotes con precio configurado para comparar, señor.', 'system');
      return;
    }

    const rows = lotes.map(l => {
      const estado = l.estado || 'disponible';
      const estadoClass = estado === 'disponible' ? 'kpk-pc-disp' : estado === 'vendido' ? 'kpk-pc-vend' : 'kpk-pc-res';
      return `<div class="kpk-pc-row ${estadoClass}" data-lote-id="${l.id}" onclick="
        if(window.FerrariUI&&window.FerrariUI.openLotePanel) window.FerrariUI.openLotePanel('${l.id}');
        document.getElementById('kpk-price-widget')&&document.getElementById('kpk-price-widget').remove();
      ">
        <span class="kpk-pc-num">Lote ${l.titulo}</span>
        <span class="kpk-pc-uf">${parseFloat(l.valorUF).toFixed(0)} UF</span>
        <span class="kpk-pc-sup">${l.dimensiones || '–'} m²</span>
        <span class="kpk-pc-est">${estado}</span>
      </div>`;
    }).join('');

    const widget = document.createElement('div');
    widget.id = 'kpk-price-widget';
    widget.className = 'kpk-price-widget kpk-float-widget';
    widget.innerHTML = `
      <div class="kpk-fw-header">
        <span class="kpk-fw-title">💰 Comparador de Precios</span>
        <button class="kpk-fw-close" onclick="this.closest('#kpk-price-widget').remove()">×</button>
      </div>
      <div class="kpk-pc-head">
        <span>Lote</span><span>Precio</span><span>Superficie</span><span>Estado</span>
      </div>
      <div class="kpk-pc-list">${rows}</div>
      <p class="kpk-pc-hint">Toca una fila para abrir la ficha del lote</p>
    `;
    document.body.appendChild(widget);
    setTimeout(() => widget.isConnected && widget.remove(), 20000);
    if (window.FerrariDrag) {
      window.FerrariDrag.attach(widget, { handle: '.kpk-fw-header' });
    }
  }

  // ─── RESALTAR LOTES DISPONIBLES ───────────────────────────────────────────
  function highlightAvailableLotes() {
    const disponibles = (window.allDrawnLines || [])
      .filter(l => (l.tipo === 'lote-libre' || l.tipo === 'lote-organico')
        && (l.estado === 'disponible' || !l.estado))
      .map(l => l.id);
    clearHighlights();
    if (disponibles.length) highlightLotes(disponibles, 'rgba(57, 255, 20, 0.50)');
    return disponibles.length;
  }



  function lookAtLote(loteId, hfov = 90) {
    const lote = findLoteById(loteId);
    if (!lote) {
      console.warn('[Ferrari/IA] lookAtLote: lote no encontrado →', loteId);
      return;
    }

    let pitch = null, yaw = null;

    // ── ESTRATEGIA 1: Usar la posición cacheada del Smart Pin DOM ──────────
    // El Smart Pin ya tiene calculado _pinCentroid por f-svg-paths / f-smart-pins.
    // Es la referencia más exacta porque usa la misma matemática esférica del renderer.
    if (Array.isArray(lote._pinCentroid) && lote._pinCentroid.length === 2) {
      pitch = lote._pinCentroid[0];
      yaw   = lote._pinCentroid[1];
      console.log(`[Ferrari/IA] lookAtLote #${lote.titulo} → _pinCentroid [${pitch.toFixed(2)}, ${yaw.toFixed(2)}]`);
    }

    // ── ESTRATEGIA 2: Media esférica correcta sobre los vértices ──────────
    // Si no hay _pinCentroid, calculamos la media esférica REAL (no aritmética).
    // Esto evita el error de "averaging angles" que falla en bordes ±180°.
    if (pitch === null && Array.isArray(lote.puntos) && lote.puntos.length >= 3) {
      let sx = 0, sy = 0, sz = 0;
      for (let i = 0; i < lote.puntos.length; i++) {
        const pr = lote.puntos[i][0] * Math.PI / 180;
        const yr = lote.puntos[i][1] * Math.PI / 180;
        sx += Math.cos(pr) * Math.sin(yr);
        sy += Math.sin(pr);
        sz += Math.cos(pr) * Math.cos(yr);
      }
      const len = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
      pitch = Math.asin(Math.max(-1, Math.min(1, sy / len))) * 180 / Math.PI;
      yaw   = Math.atan2(sx / len, sz / len) * 180 / Math.PI;
      // Cachear para el próximo uso (evita recalcular cada vez)
      lote._pinCentroid = [pitch, yaw];
      console.log(`[Ferrari/IA] lookAtLote #${lote.titulo} → esférica calculada [${pitch.toFixed(2)}, ${yaw.toFixed(2)}]`);
    }

    if (pitch === null) {
      console.warn('[Ferrari/IA] lookAtLote: sin coordenadas para lote', lote.titulo);
      return;
    }

    // ── FIJAR LOTE ACTIVO ─────────────────────────────────────────────────
    // Desde este momento, _activeLote es el contexto persistente para la IA.
    // Cualquier consulta sin lote explícito se referirá a este lote.
    _activeLote = lote;
    _updateSuggestiveChips();
    console.log(`[Ferrari/IA] _activeLote → Lote ${lote.titulo} (${lote.id})`);

    // ── ADAPTACIÓN DE PLATAFORMA ──────────────────────────────────────────
    const isMobile    = window.innerWidth < 768;
    const isPanelOpen = _panel && _panel.classList.contains('is-open');

    let targetPitch = pitch;
    let targetYaw   = yaw;

    // En móvil con panel abierto: el panel cubre ~50% inferior de pantalla.
    // Inclinamos cámara para que el lote quede centrado en la zona VISIBLE superior.
    // El offset depende del HFOV actual (campo de visión vertical real).
    if (isMobile && isPanelOpen) {
      const viewer = window.Ferrari && window.Ferrari.viewer;
      if (viewer) {
        try {
          const currentHfov = viewer.getHfov() || 90;
          const container = document.getElementById('pannellum-viewer');
          const w = (container && container.clientWidth)  || window.innerWidth;
          const h = (container && container.clientHeight) || window.innerHeight;
          // VFOV real del visor en grados
          const vfov = 2 * Math.atan(
            Math.tan(currentHfov / 180 * Math.PI * 0.5) / (w / h)
          ) * 180 / Math.PI;
          // El panel ocupa ~50% de la pantalla, así que desplazamos 25% del VFOV hacia arriba
          const pitchOffset = vfov * 0.22;
          targetPitch = pitch - pitchOffset;
        } catch(e) {
          targetPitch = pitch - 12; // fallback seguro
        }
      }
    }

    // ── ZOOM HFOV ─────────────────────────────────────────────────────────
    let targetHfov = Math.max(25, Math.min(110, Number(hfov) || 90));
    if (isMobile) {
      // Pantallas verticales: necesitan más zoom para ver bien las parcelas
      targetHfov = targetHfov >= 90 ? 58 : Math.max(22, targetHfov - 18);
    }

    // ── EJECUTAR ANIMACIÓN EN PANNELLUM ───────────────────────────────────
    const viewer = window.Ferrari && window.Ferrari.viewer;
    if (viewer && typeof viewer.lookAt === 'function') {
      viewer.lookAt(targetPitch, targetYaw, targetHfov, 1200);
    }
  }

  function openLotePanel(loteId) {
    if (window.FerrariUI && typeof window.FerrariUI.openLotePanel === 'function') {
      window.FerrariUI.openLotePanel(loteId);
    }
  }

  // Pulsa visualmente el Smart Pin del lote: añade clase CSS y la quita al terminar
  function pulseSmartPin(loteId) {
    const lote = findLoteById(loteId);
    if (!lote) return;
    // El Smart Pin DOM usa data-lote-id con el UUID real del lote
    const pinEl = document.querySelector(`[data-lote-id="${lote.id}"]`);
    if (!pinEl) return;
    pinEl.classList.add('kpk-pin-ai-pulse');
    // Quitar la clase cuando termine la animación (2.4s × 2 ciclos)
    setTimeout(() => pinEl.classList.remove('kpk-pin-ai-pulse'), 2600);
  }

  async function submitLead(name, email, phone, loteId, notes) {
    // 1) Obtener correo de destino de la marca
    let contactEmail = '';
    try {
      if (window.FerrariBrandDock && typeof window.FerrariBrandDock.getContact === 'function') {
        contactEmail = window.FerrariBrandDock.getContact().formEmail;
      }
    } catch(e) {}

    if (!contactEmail || !contactEmail.includes('@')) {
      contactEmail = '';
    }
    if (!contactEmail) {
      window.FerrariUI && window.FerrariUI.showToast('Configura el correo FormSubmit en Admin → Contacto.', 'error');
      return false;
    }

    // 2) Preparar payload compatible con FormSubmit
    const isVisit =
      typeof notes === 'string' && /AGENDAMIENTO\s+DE\s+VISITA/i.test(notes);
    const payload = {
      nombre: name || 'Cliente Anónimo',
      email: email || 'no-email@chat.ia',
      telefono: phone || 'No especificado',
      lote: loteId || 'General/No especificado',
      mensaje: notes || 'Interesado en reserva/contacto directo vía Copiloto Chatbot IA.',
      _subject: isVisit
        ? `Visita en terreno IA — ${loteId || 'General'}`
        : `Nueva Reserva IA - Lote ${loteId || 'General'}`,
      _honey: '' // Campo antispam
    };

    console.log('[Ferrari/IA] Enviando lead a FormSubmit...', payload);

    try {
      let res;
      if (_activeSendFile) {
        const formData = new FormData();
        Object.keys(payload).forEach(k => formData.append(k, payload[k]));
        formData.append('attachment', _activeSendFile);
        res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(contactEmail)}`, {
          method: 'POST',
          body: formData
        });
      } else {
        res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(contactEmail)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(payload)
        });
      }
      
      const data = await res.json();
      if (res.ok) {
        console.log('[Ferrari/IA] Lead enviado exitosamente:', data);
        playFuturisticSound('success');
        if (window.FerrariUI && typeof window.FerrariUI.showToast === 'function') {
          window.FerrariUI.showToast(
            isVisit
              ? '✓ Visita enviada al propietario (correo + WhatsApp)'
              : '✓ Solicitud de reserva enviada al propietario',
            'success'
          );
        }
        // Disparar alerta silenciosa de WhatsApp al propietario
        sendWhatsAppAlert(name, phone, email, loteId, notes);
        return true;
      }
      throw new Error(data.message || 'Error en FormSubmit');
    } catch (err) {
      console.error('[Ferrari/IA] Error al enviar lead:', err);
      return false;
    }
  }

  function openMapWidget(lat, lng, title = 'Ubicación') {
    let widget = document.getElementById('kpk-map-widget');
    if (!widget) {
      widget = document.createElement('div');
      widget.id = 'kpk-map-widget';
      widget.className = 'kpk-map-widget';
      widget.innerHTML = `
        <div class="kpk-widget-header">
          <span id="kpk-widget-title">${title}</span>
          <button class="kpk-widget-close" id="kpk-widget-close-btn">&times;</button>
        </div>
        <div class="kpk-widget-body">
          <iframe id="kpk-widget-iframe" frameborder="0" allowfullscreen></iframe>
        </div>
        <div class="kpk-widget-footer" id="kpk-widget-footer-actions">
          <!-- Botones inyectados dinámicamente -->
        </div>
      `;
      document.body.appendChild(widget);
      
      widget.querySelector('#kpk-widget-close-btn').addEventListener('click', closeMapWidget);
      if (window.FerrariDrag) {
        window.FerrariDrag.attach(widget, { handle: '.kpk-widget-header' });
      }
    }
    
    const titleEl = widget.querySelector('#kpk-widget-title');
    const iframe = widget.querySelector('#kpk-widget-iframe');
    const footer = widget.querySelector('#kpk-widget-footer-actions');
    
    if (titleEl) titleEl.textContent = title;
    
    // Obtener origen del dron
    let origin = null;
    if (window.FerrariGeo && window.FerrariGeo.droneOrigin) {
      origin = window.FerrariGeo.droneOrigin;
    }
    
    // Generar URL del iframe con ruta o marcador simple
    if (iframe) {
      if (origin && origin.lat != null && origin.lng != null) {
        // Evitar el bug de ruta con origen y destino iguales
        const isSame = Math.abs(origin.lat - lat) < 0.0001 && Math.abs(origin.lng - lng) < 0.0001;
        if (isSame) {
          iframe.src = `https://maps.google.com/maps?q=${lat},${lng}&z=14&t=m&hl=es&output=embed`;
        } else {
          iframe.src = `https://maps.google.com/maps?saddr=${origin.lat},${origin.lng}&daddr=${lat},${lng}&z=11&t=m&hl=es&output=embed`;
        }
      } else {
        iframe.src = `https://maps.google.com/maps?q=${lat},${lng}&z=12&t=m&hl=es&output=embed`;
      }
    }
    
    // Generar enlaces externos para Google Maps y Waze
    let links = { google: '', waze: '' };
    if (window.FerrariGeo && typeof window.FerrariGeo.mapsLinks === 'function') {
      links = window.FerrariGeo.mapsLinks(lat, lng) || links;
    } else {
      const dest = `${lat},${lng}`;
      const originStr = origin ? `${origin.lat},${origin.lng}` : '';
      links.google = originStr
        ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originStr)}&destination=${encodeURIComponent(dest)}&travelmode=driving`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dest)}`;
      links.waze = `https://waze.com/ul?ll=${encodeURIComponent(dest)}&navigate=yes`;
    }
    
    if (footer) {
      footer.innerHTML = `
        <a href="${links.google}" target="_blank" rel="noopener" class="kpk-widget-btn kpk-widget-btn--maps">
          <img src="assets/icons/google-maps.svg" alt="" width="14" height="14">
          <span>Abrir en Maps</span>
        </a>
        <a href="${links.waze}" target="_blank" rel="noopener" class="kpk-widget-btn kpk-widget-btn--waze">
          <img src="assets/icons/waze.svg?v=2" alt="" width="14" height="14">
          <span>Navegar con Waze</span>
        </a>
      `;
    }
    
    widget.style.display = 'flex';
    setTimeout(() => {
      widget.classList.add('is-open');
    }, 50);
  }

  function closeMapWidget() {
    const widget = document.getElementById('kpk-map-widget');
    if (widget) {
      widget.classList.remove('is-open');
      setTimeout(() => {
        widget.style.display = 'none';
        const iframe = widget.querySelector('#kpk-widget-iframe');
        if (iframe) iframe.src = '';
      }, 300);
    }
  }

  async function sendWhatsAppAlert(name, phone, email, loteId, message) {
    // 1) Obtener configuración desde la identidad de la marca (localStorage o BrandDock)
    let brandContact = null;
    try {
      if (window.FerrariBrandDock && typeof window.FerrariBrandDock.getContact === 'function') {
        brandContact = window.FerrariBrandDock.getContact();
      } else {
        const brandStr = localStorage.getItem('ferrari360_brand');
        if (brandStr) {
          const parsed = JSON.parse(brandStr);
          brandContact = parsed.contact || null;
        }
      }
    } catch(e) {}

    const cfg = window.KPK_CONFIG || {};
    const waBase = cfg.whatsappAlerts || {};

    // Prioridad: Valores del Panel Admin (localStorage/brand.json) -> config.js -> vacíos
    const isEnabled = brandContact && brandContact.waAlertsEnabled !== undefined 
      ? !!brandContact.waAlertsEnabled 
      : !!waBase.enabled;
      
    const ownerPhone = brandContact && brandContact.waAlertsPhone 
      ? brandContact.waAlertsPhone 
      : waBase.ownerPhone;
      
    let rawApiKey = brandContact && brandContact.waAlertsKey 
      ? brandContact.waAlertsKey 
      : waBase.callMeBotApiKey;

    let callMeBotApiKey = rawApiKey;
    if (rawApiKey && rawApiKey.startsWith('kpk-enc-')) {
      try {
        const rawBase = rawApiKey.substring(8);
        callMeBotApiKey = atob(rawBase).split('').reverse().join('');
      } catch (e) {
        callMeBotApiKey = rawApiKey;
      }
    }

    if (!isEnabled || !ownerPhone || !callMeBotApiKey) {
      console.log('[Ferrari/Alerts] Alertas de WhatsApp desactivadas o incompletas en la configuración.');
      return;
    }

    // Formatear mensaje premium
    const brandName = (window.FerrariBrandDock && typeof window.FerrariBrandDock.getBrand === 'function') 
      ? window.FerrariBrandDock.getBrand().projectName || 'Austral 360' 
      : 'Austral 360';

    const textMsg = `🔔 *NUEVO PROSPECTO REGISTRADO*\n\n` +
      `🌐 *Proyecto:* ${brandName}\n` +
      `👤 *Cliente:* ${name || 'Anónimo'}\n` +
      `📞 *Teléfono:* ${phone || '—'}\n` +
      `✉️ *Email:* ${email || '—'}\n` +
      `🏡 *Terreno:* Lote ${loteId || 'General'}\n` +
      `💬 *Consulta:* ${message || 'Solicitud de contacto inmediata.'}\n\n` +
      `⚡ _Enviado desde el Asistente Copiloto Virtual_`;

    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(ownerPhone)}&text=${encodeURIComponent(textMsg)}&apikey=${encodeURIComponent(callMeBotApiKey)}`;

    try {
      // Fetch asíncrono y silencioso (mode: no-cors para evitar problemas de CORS del servidor de CallMeBot)
      fetch(url, { mode: 'no-cors' }).then(() => {
        console.log('[Ferrari/Alerts] Alerta de WhatsApp enviada exitosamente.');
      }).catch(e => console.warn('[Ferrari/Alerts] Error enviando WhatsApp:', e));
    } catch(err) {
      console.warn('[Ferrari/Alerts] Fallo en fetch de WhatsApp:', err);
    }
  }

  // Exponer globalmente en FerrariUI
  window.FerrariUI = window.FerrariUI || {};
  window.FerrariUI.openMapWidget = openMapWidget;
  window.FerrariUI.closeMapWidget = closeMapWidget;
  window.FerrariUI.sendWhatsAppAlert = sendWhatsAppAlert;
  window.FerrariUI.focusNearbyPOI = focusNearbyPOI;
  window.FerrariUI.startAutoTour = startAutoTour;
  window.FerrariUI.stopAutoTour = stopAutoTour;
  window.FerrariUI.showStatsWidget = showStatsWidget;
  window.FerrariUI.showPriceWidget = showPriceWidget;
  window.FerrariUI.highlightAvailableLotes = highlightAvailableLotes;
  window.FerrariUI.openWeatherWidget = openWeatherWidget;
  window.FerrariUI.openGalleryForLote = openGalleryForLote;

  // injectBotMessage: inserta un mensaje de Jarvis en el historial del chatbot sin llamar a la IA
  window.FerrariUI.injectBotMessage = function(text) {
    if (!text) return;
    try {
      appendMessage(text, 'system');
      speakJarvis(text);
    } catch(e) {}
  };

  // ══════════════════════════════════════════════════════════════════════════
  //  MOTOR DE VOZ GIGI — CASCADA 6 NIVELES
  //
  //  Tier 0: Gemini TTS           (Google AI API, si hay key configurada)
  //  Tier 1: Edge TTS Neural      (Microsoft, vía esm.sh, gratis)
  //  Tier 2: StreamElements TTS   (AWS Polly, sin key, gratis)
  //  Tier 3: Google Translate TTS (gratis, funciona siempre)
  //  Tier 4: Web Speech API       (navegador, instantáneo, sin red)
  //  Tier 5: ElevenLabs           (clave opcional en admin, calidad premium)
  // ══════════════════════════════════════════════════════════════════════════

  // TTS salida (hablar): OFF por defecto. Admin activa con kpk_tts_output=1
  const TTS_OUTPUT_KEY = 'kpk_tts_output';
  function _readTtsOutputEnabled() {
    try {
      if (localStorage.getItem(TTS_OUTPUT_KEY) === '1') return true;
      if (localStorage.getItem(TTS_OUTPUT_KEY) === '0') return false;
      const cfg = window.KPK_CONFIG || {};
      if (cfg.ttsOutputEnabled === true) return true;
    } catch (e) {}
    return false;
  }
  function _setTtsOutputEnabled(on) {
    try { localStorage.setItem(TTS_OUTPUT_KEY, on ? '1' : '0'); } catch (e) {}
    _speechEnabled = !!on;
    if (!_speechEnabled) {
      try { stopAISpeech(); } catch (e) {}
      try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
    }
    return _speechEnabled;
  }
  let _speechEnabled = _readTtsOutputEnabled();
  let _synthUtterance = null;
  window.__kpkSetTtsOutput = _setTtsOutputEnabled;
  window.__kpkGetTtsOutput = () => _speechEnabled;

  // ─── NIVEL 1: StreamElements TTS — Gratis, sin API key, voces AWS Polly Neural —
  //  Voces femeninas en español disponibles:
  //    Mia      → es-MX (mexicana, la más similar a Gigi)
  //    Penelope → es-US (estadounidense)
  //    Lucia    → es-ES (españa)
  //  Límite práctico: ~500 chars por petición (URL length), se parte automáticamente
  const STREAM_TTS_BASE = 'https://api.streamelements.com/kappa/v2/speech';

  // ─── Utilidad: reproducir directamente una URL de audio reutilizando _globalAudio ─────
  function _playAudioUrl(url) {
    return new Promise(resolve => {
      try {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        if (!_globalAudio) _globalAudio = new Audio();

        try { _globalAudio.pause(); } catch(e) {}
        _globalAudio.src = url;
        _globalAudio.load();
        _activeJarvisAudio = _globalAudio;

        _shouldRestartMic = false;
        if (_recognition && _isListening && !_jarvisMode) try { _recognition.stop(); } catch(e) {}

        _globalAudio.onended = () => {
          _activeJarvisAudio = null;
          setAISpeaking(false);
          resolve(true);
        };
        _globalAudio.onerror = (e) => {
          console.warn('[Gigi/Voz] Error reproduciendo _globalAudio:', e);
          _activeJarvisAudio = null;
          setAISpeaking(false);
          resolve(false);
        };
        setAISpeaking(true);
        const p = _globalAudio.play();
        if (p && p.catch) {
          p.catch(err => {
            console.warn('[Gigi/Voz] _globalAudio.play() bloqueado:', err.name, err.message);
            setAISpeaking(false);
            resolve(false);
          });
        }
      } catch(e) {
        console.warn('[Gigi/Voz] Excepción en _playAudioUrl:', e);
        setAISpeaking(false);
        resolve(false);
      }
    });
  }

  async function _speakStreamElements(text, forceVoice) {
    try {
      const clean = _cleanTextForTTS(text);
      if (!clean) return false;

      const mode = _getVoiceMode();
      let voice = forceVoice;
      if (!voice) {
        if (mode === 'stream_lucia' || mode === 'edge_alvaro' || mode === 'edge_elvira') voice = 'Lucia';
        else if (mode === 'stream_penelope') voice = 'Penelope';
        else if (mode === 'elevenlabs_daniel' || mode === 'edge_ryan' || mode === 'edge_jorge') voice = 'Miguel';
        else voice = 'Mia';
      }

      const MAX = 460;
      const fragments = [];
      let remaining = clean;
      while (remaining.length > 0) {
        if (remaining.length <= MAX) {
          fragments.push(remaining);
          break;
        }
        let cut = remaining.lastIndexOf('.', MAX);
        if (cut < 80) cut = remaining.lastIndexOf(',', MAX);
        if (cut < 80) cut = remaining.lastIndexOf(' ', MAX);
        if (cut < 1)  cut = MAX;
        fragments.push(remaining.substring(0, cut + 1));
        remaining = remaining.substring(cut + 1).trim();
      }

      // StreamElements bloquea el navegador (401). Usar proxy local si está arriba.
      const proxyUp = await _probeLocalTtsProxy(false);

      for (const frag of fragments) {
        let ok = false;

        if (proxyUp) {
          try {
            const proxyUrl = LOCAL_TTS_PROXY + '/se?voice=' + encodeURIComponent(voice)
              + '&text=' + encodeURIComponent(frag);
            const res = await fetch(proxyUrl, { method: 'GET', mode: 'cors', cache: 'no-store' });
            if (res.ok) {
              const blob = await res.blob();
              if (blob && blob.size > 100) ok = await _playAudioBlob(blob, text);
            }
          } catch (e) {
            console.warn('[Gigi/StreamTTS] proxy /se falló:', e.message);
          }
        }

        // Intento directo (puede fallar 401 desde el browser)
        if (!ok) {
          const url = `${STREAM_TTS_BASE}?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(frag)}`;
          ok = await _playAudioUrl(url);
          if (!ok) {
            try {
              const res = await fetch(url, { method: 'GET', mode: 'cors', cache: 'no-store', credentials: 'omit' });
              if (res.ok) {
                const blob = await res.blob();
                if (blob && blob.size > 100) ok = await _playAudioBlob(blob, text);
              } else {
                console.warn('[Gigi/StreamTTS] directo HTTP', res.status);
              }
            } catch (fetchErr) {
              console.warn('[Gigi/StreamTTS] fetch falló:', fetchErr.message);
            }
          }
        }

        if (!ok && voice !== 'Penelope' && proxyUp) {
          try {
            const fallbackUrl = LOCAL_TTS_PROXY + '/se?voice=Penelope&text=' + encodeURIComponent(frag);
            const res2 = await fetch(fallbackUrl, { method: 'GET', mode: 'cors', cache: 'no-store' });
            if (res2.ok) {
              const blob2 = await res2.blob();
              if (blob2 && blob2.size > 100) ok = await _playAudioBlob(blob2, text);
            }
          } catch (e2) {}
        }
        if (!ok) return false;
      }
      return true;
    } catch (e) {
      console.warn('[Gigi/StreamTTS] Error:', e.message);
      return false;
    }
  }

  // ─── Utilidad: Google Translate TTS — Voz femenina suave en español gratis ────
  async function _speakGoogleTranslate(text) {
    try {
      const clean = _cleanTextForTTS(text);
      if (!clean) return false;

      const MAX = 180;
      const fragments = [];
      let remaining = clean;
      while (remaining.length > 0) {
        if (remaining.length <= MAX) {
          fragments.push(remaining);
          break;
        }
        let cut = remaining.lastIndexOf('.', MAX);
        if (cut < 40) cut = remaining.lastIndexOf(',', MAX);
        if (cut < 40) cut = remaining.lastIndexOf(' ', MAX);
        if (cut < 1)  cut = MAX;
        fragments.push(remaining.substring(0, cut + 1));
        remaining = remaining.substring(cut + 1).trim();
      }

      for (const frag of fragments) {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=es-US&client=tw-ob&q=${encodeURIComponent(frag)}`;
        const ok = await _playAudioUrl(url);
        if (!ok) return false;
      }
      return true;
    } catch(e) {
      console.warn('[Gigi/GoogleTTS] Error:', e.message);
      return false;
    }
  }

  // ─── NIVEL 2 (opcional): ElevenLabs solo si hay key activa ────────────────────
  // Voice IDs oficiales:
  const ELEVENLABS_VOICE_GIGI   = 'hpp4J3VqNfWAUOO0d1Us'; // Gigi (Bella) — Locutora latina premium
  const ELEVENLABS_VOICE_DANIEL = 'onwK4e9ZLuTAKqWW03F9'; // Daniel — Mayordomo británico grave

  function _getElevenLabsKey() {
    // Orden: localStorage → brand.json → config.js
    let brandKeys = null;
    try {
      if (window.FerrariBrandDock && typeof window.FerrariBrandDock.getBrand === 'function') {
        brandKeys = window.FerrariBrandDock.getBrand().aiKeys || null;
      }
    } catch (e) {}
    const cfg = window.KPK_CONFIG || {};
    const raw = localStorage.getItem('ferrari_ai_key_elevenlabs')
      || (brandKeys && brandKeys.elevenlabs)
      || (cfg.aiKeys && cfg.aiKeys.elevenlabs)
      || '';
    return _deobfuscateKey(raw);
  }

  // ─── Auto Gigi/Dalia: sondea créditos ElevenLabs y elige motor ─────────
  let _elStatus = null; // { ok, keyFp, checkedAt, remaining }
  const EL_STATUS_KEY = 'kpk_el_status_v1';
  const EL_STATUS_TTL_MS = 5 * 60 * 1000; // re-chequear cada 5 min (o al cambiar key)

  function _elevenLabsKeyFp(key) {
    if (!key) return 'none';
    return String(key.length) + ':' + key.slice(0, 4) + key.slice(-6);
  }

  function _invalidateElevenLabsStatus() {
    _elStatus = null;
    try { localStorage.removeItem(EL_STATUS_KEY); } catch (e) {}
  }

  function _setElevenLabsStatus(ok, key, remaining) {
    _elStatus = {
      ok: !!ok,
      keyFp: _elevenLabsKeyFp(key),
      checkedAt: Date.now(),
      remaining: remaining == null ? null : remaining
    };
    try { localStorage.setItem(EL_STATUS_KEY, JSON.stringify(_elStatus)); } catch (e) {}
  }

  /** true si la key responde y quedan caracteres suficientes */
  async function _probeElevenLabs(force) {
    const key = _getElevenLabsKey();
    if (!key) {
      _setElevenLabsStatus(false, '', 0);
      return false;
    }
    const fp = _elevenLabsKeyFp(key);

    if (!force) {
      if (_elStatus && _elStatus.keyFp === fp && (Date.now() - _elStatus.checkedAt) < EL_STATUS_TTL_MS) {
        return !!_elStatus.ok;
      }
      try {
        const raw = localStorage.getItem(EL_STATUS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.keyFp === fp && (Date.now() - parsed.checkedAt) < EL_STATUS_TTL_MS) {
            _elStatus = parsed;
            return !!parsed.ok;
          }
        }
      } catch (e) {}
    }

    try {
      const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
        method: 'GET',
        headers: { 'xi-api-key': key, 'Accept': 'application/json' }
      });
      if (!res.ok) {
        console.warn('[Gigi/Voz] ElevenLabs subscription HTTP', res.status);
        _setElevenLabsStatus(false, key, 0);
        return false;
      }
      const data = await res.json();
      const used = Number(data.character_count || 0);
      const limit = Number(data.character_limit || 0);
      const remaining = limit > 0 ? Math.max(0, limit - used) : 0;
      const status = String(data.status || 'active').toLowerCase();
      const statusOk = status === 'active' || status === 'trialing' || status === 'free';
      // Pedimos al menos ~80 caracteres para un saludo corto
      const ok = statusOk && (limit === 0 || remaining >= 80);
      console.log(`[Gigi/Voz] ElevenLabs créditos restantes: ${remaining}/${limit || '?'} → ${ok ? 'Gigi Bella' : 'Mia gratis'}`);
      _setElevenLabsStatus(ok, key, remaining);
      return ok;
    } catch (e) {
      console.warn('[Gigi/Voz] ElevenLabs probe error:', e.message);
      _setElevenLabsStatus(false, key, 0);
      return false;
    }
  }

  async function _speakElevenLabs(text, voiceId) {
    const key = _getElevenLabsKey();
    if (!key) return false;
    try {
      const clean = _cleanTextForTTS(text);
      if (!clean) return false;
      const activeVoice = voiceId || ELEVENLABS_VOICE_GIGI;
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${activeVoice}`, {
        method: 'POST',
        headers: {
          'xi-api-key': key,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        body: JSON.stringify({
          text: clean,
          model_id: 'eleven_flash_v2_5',
          voice_settings: { stability: 0.45, similarity_boost: 0.80, style: 0.20, use_speaker_boost: true }
        })
      });
      if (!res.ok) {
        console.warn('[Gigi/Voz] ⚠️ ElevenLabs HTTP ' + res.status + ' → Mia gratis');
        // 401/402/429 = key inválida o sin créditos → invalidar caché
        if (res.status === 401 || res.status === 402 || res.status === 403 || res.status === 429) {
          _setElevenLabsStatus(false, key, 0);
        } else {
          _invalidateElevenLabsStatus();
        }
        return false;
      }
      const blob = await res.blob();
      _setElevenLabsStatus(true, key, _elStatus && _elStatus.remaining);
      return _playAudioBlob(blob, text);
    } catch (e) {
      console.warn('[Gigi/Voz] ElevenLabs no disponible:', e.message);
      _invalidateElevenLabsStatus();
      return false;
    }
  }

  // ─── Nivel 2: Microsoft Edge TTS Neural (sin key, gratis) ─────────────────
  const EDGE_TTS_VOICE_DALIA  = 'es-MX-DaliaNeural';
  const EDGE_TTS_VOICE_ELVIRA = 'es-ES-ElviraNeural';
  const EDGE_TTS_VOICE_JORGE  = 'es-MX-JorgeNeural';
  const EDGE_TTS_VOICE_ES     = 'es-ES-AlvaroNeural';
  const EDGE_TTS_VOICE_RYAN   = 'en-GB-RyanNeural';

  // Puente TTS: URL pública (Hetzner/VPS) o localhost. GitHub Pages necesita HTTPS remoto.
  const LOCAL_TTS_PORTS = [8787, 8788];
  let LOCAL_TTS_PROXY = 'http://127.0.0.1:8787';
  let _localTtsOk = null; // null=unknown, true/false
  let _localTtsCheckedAt = 0;

  /** true solo en desarrollo local — nunca sondear 127.0.0.1 desde github.io (Chrome pide "apps en este dispositivo") */
  function _mayProbeLoopbackTts() {
    try {
      const h = (location.hostname || '').toLowerCase();
      if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return true;
      if (location.protocol === 'http:' && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return true;
      // file:// o host vacío
      if (location.protocol === 'file:' || !h) return true;
    } catch (e) {}
    return false;
  }

  function _configuredTtsProxyUrl() {
    try {
      const fromLs = (localStorage.getItem('kpk_tts_proxy_url') || '').trim();
      if (fromLs) return fromLs.replace(/\/$/, '');
    } catch (e) {}
    try {
      const cfg = window.KPK_CONFIG || {};
      if (cfg.ttsProxyUrl) return String(cfg.ttsProxyUrl).trim().replace(/\/$/, '');
    } catch (e) {}
    try {
      if (window.FerrariBrandDock && typeof window.FerrariBrandDock.getBrand === 'function') {
        const b = window.FerrariBrandDock.getBrand();
        if (b && b.ttsProxyUrl) return String(b.ttsProxyUrl).trim().replace(/\/$/, '');
      }
    } catch (e) {}
    return '';
  }

  async function _probeOneTtsBase(base, timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs || 2500);
    try {
      const res = await fetch(base + '/health', { signal: ctrl.signal, cache: 'no-store', mode: 'cors' });
      clearTimeout(t);
      return !!(res && res.ok);
    } catch (e) {
      clearTimeout(t);
      return false;
    }
  }

  async function _probeLocalTtsProxy(force) {
    if (!force && _localTtsOk !== null && (Date.now() - _localTtsCheckedAt) < 30000) {
      return _localTtsOk;
    }
    _localTtsOk = false;

    // 1) Puente por internet (VPS) — funciona desde GitHub Pages
    const remote = _configuredTtsProxyUrl();
    if (remote) {
      if (await _probeOneTtsBase(remote, 3500)) {
        LOCAL_TTS_PROXY = remote;
        _localTtsOk = true;
        _localTtsCheckedAt = Date.now();
        console.log('[Gigi/Voz] Puente TTS remoto OK:', remote);
        return true;
      }
      console.warn('[Gigi/Voz] Puente TTS remoto no responde:', remote);
    }

    // 2) Localhost solo en PC/dev. En ilycons.github.io NO: dispara permiso
    // "acceder a otros servicios y apps en este dispositivo" (Chrome Local Network / Apps on device).
    if (!_mayProbeLoopbackTts()) {
      _localTtsCheckedAt = Date.now();
      return false;
    }

    for (const port of LOCAL_TTS_PORTS) {
      const base = 'http://127.0.0.1:' + port;
      if (await _probeOneTtsBase(base, 1200)) {
        LOCAL_TTS_PROXY = base;
        _localTtsOk = true;
        break;
      }
    }
    _localTtsCheckedAt = Date.now();
    return _localTtsOk;
  }

  async function _speakLocalDalia(text, forceVoice) {
    try {
      const clean = _cleanTextForTTS(text);
      if (!clean) return false;
      const voice = forceVoice || EDGE_TTS_VOICE_DALIA;
      const url = LOCAL_TTS_PROXY + '/tts?voice=' + encodeURIComponent(voice)
        + '&rate=' + encodeURIComponent('+8%')
        + '&pitch=' + encodeURIComponent('+2Hz')
        + '&text=' + encodeURIComponent(clean);
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(url, { method: 'GET', mode: 'cors', cache: 'no-store', signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) {
        console.warn('[Gigi/Voz] Proxy local HTTP', res.status);
        _localTtsOk = false;
        return false;
      }
      const blob = await res.blob();
      if (!blob || blob.size < 200) return false;
      _localTtsOk = true;
      _lastUsedVoiceEngine = 'local_dalia';
      return _playAudioBlob(blob, text);
    } catch (e) {
      console.warn('[Gigi/Voz] Proxy local Dalia no disponible:', e.message);
      _localTtsOk = false;
      return false;
    }
  }

  /** Preferencia cruda (admin / usuario) sin resolver Auto Gigi */
  function _isMicrosoftEdgeBrowser() {
    // Edg/ = Chromium Edge. No confundir con "Edge" legacy ni Chrome.
    return /\bEdg\/\d+/i.test(navigator.userAgent || '');
  }

  function _getPreferredVoiceMode() {
    if (localStorage.getItem('kpk_voice_user_override') === '1') {
      const userMode = localStorage.getItem('kpk_voice_mode');
      if (userMode) return userMode;
    }
    try {
      if (window.FerrariBrandDock && typeof window.FerrariBrandDock.getBrand === 'function') {
        const brandMode = window.FerrariBrandDock.getBrand().voiceMode;
        if (brandMode) {
          if (localStorage.getItem('kpk_voice_mode') !== brandMode) {
            localStorage.setItem('kpk_voice_mode', brandMode);
          }
          return brandMode;
        }
      }
    } catch (e) {}
    const stored = localStorage.getItem('kpk_voice_mode');
    if (stored) return stored;
    const cfg = window.KPK_CONFIG || {};
    if (cfg.voiceMode) return cfg.voiceMode;
    return 'auto_gigi';
  }

  /**
   * Modo efectivo sincrónico (UI / personalidad).
   * auto_gigi / elevenlabs_* → Bella si hay créditos; si no Mia (StreamElements).
   * Edge Dalia no es fiable en Chrome/Firefox (Microsoft bloquea el WebSocket).
   */
  function _getVoiceMode() {
    const preferred = _getPreferredVoiceMode();

    const wantsGigiAuto = preferred === 'auto_gigi' || preferred === 'elevenlabs_gigi';
    const wantsDaniel = preferred === 'elevenlabs_daniel';

    if (wantsGigiAuto || wantsDaniel) {
      const key = _getElevenLabsKey();
      if (!key) return 'stream_gigi';
      if (_elStatus && _elStatus.keyFp === _elevenLabsKeyFp(key)) {
        if (_elStatus.ok) return wantsDaniel ? 'elevenlabs_daniel' : 'elevenlabs_gigi';
        return 'stream_gigi';
      }
      // Aún no sondeado: Mia gratis hasta que el probe confirme créditos
      return 'stream_gigi';
    }

    return preferred;
  }

  /** Resuelve Bella vs Mia consultando créditos justo antes de hablar */
  async function _resolveVoiceModeAsync() {
    const preferred = _getPreferredVoiceMode();
    if (preferred === 'auto_gigi' || preferred === 'elevenlabs_gigi') {
      const ok = await _probeElevenLabs(false);
      return ok ? 'elevenlabs_gigi' : 'stream_gigi';
    }
    if (preferred === 'elevenlabs_daniel') {
      const ok = await _probeElevenLabs(false);
      return ok ? 'elevenlabs_daniel' : 'stream_gigi';
    }
    return preferred;
  }

  function _voiceModeLabel(mode) {
    switch (mode) {
      case 'auto_gigi':         return 'Auto · Dalia local / Bella / Mia';
      case 'jarvis_charon':     return 'JARVIS Charon (Gemini · voz grave del doc)';
      case 'gemini_charon':     return 'JARVIS Charon (Gemini)';
      case 'local_dalia':       return 'Dalia Neural MX (proxy local · humana gratis)';
      case 'stream_gigi':       return 'Gigi "Mia" MX (StreamElements • gratis · neural)';
      case 'stream_lucia':      return 'Gigi "Lucía" ES (StreamElements • gratis)';
      case 'stream_penelope':   return 'Gigi "Penelope" US (StreamElements • gratis)';
      case 'elevenlabs_gigi':   return 'Gigi "Bella" (ElevenLabs • premium)';
      case 'elevenlabs_daniel': return 'Daniel (ElevenLabs • premium)';
      case 'edge_dalia':        return 'Dalia Neural MX (proxy o Microsoft Edge)';
      case 'edge_elvira':       return 'Elvira Neural (Edge TTS)';
      case 'edge_jorge':        return 'Jorge Neural (Edge TTS)';
      case 'edge_alvaro':       return 'Álvaro Neural (Edge TTS)';
      case 'edge_ryan':         return 'Ryan Neural (Edge TTS)';
      case 'gemini_tts':        return 'Gemini TTS Kore (Google AI)';
      case 'webspeech':         return 'Voz del navegador (robótica)';
      default:                  return 'Voz activa';
    }
  }

  let _edgeTTSModule = null;
  let _edgeTTSLoading = false;

  async function _loadEdgeTTS() {
    if (_edgeTTSModule) return _edgeTTSModule;
    if (_edgeTTSLoading) {
      while (_edgeTTSLoading) await new Promise(r => setTimeout(r, 50));
      return _edgeTTSModule;
    }
    _edgeTTSLoading = true;
    try {
      const mod = await import('https://esm.sh/@andresaya/edge-tts@latest');
      _edgeTTSModule = mod;
      console.log('[Gigi/Voz] ✓ Módulo Edge TTS Neural cargado');
    } catch(e) {
      console.warn('[Gigi/Voz] Edge TTS no disponible:', e.message);
      _edgeTTSModule = null;
    }
    _edgeTTSLoading = false;
    return _edgeTTSModule;
  }

  function _cleanTextForTTS(text) {
    if (!text) return '';
    let clean = text;
    clean = clean.replace(/<[^>]*>/g, '');
    clean = clean.replace(/\{.*?\}/g, '');
    clean = clean.replace(/\bkm\b/gi, 'kilómetros');
    clean = clean.replace(/\bm²\b/gi, 'metros cuadrados');
    clean = clean.replace(/\bUF\b/g, 'U Efe');
    clean = clean.replace(/\bSAG\b/g, 'Ese A Ge');
    clean = clean.replace(/\$/g, 'pesos ');
    clean = clean.replace(/\*\*+/g, '');
    clean = clean.replace(/\*+/g, '');
    clean = clean.replace(/`+/g, '');
    clean = clean.replace(/^[-*+]\s+/gm, '');
    clean = clean.replace(/[#_*~[\]()]/g, '');
    clean = clean.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '');
    clean = clean.replace(/\s+/g, ' ').trim();
    return clean.substring(0, 1000);
  }

  async function _speakEdgeTTS(text, forceVoice) {
    try {
      const mod = await _loadEdgeTTS();
      if (!mod || !mod.EdgeTTS) return false;
      const clean = _cleanTextForTTS(text);
      if (!clean) return false;
      const tts = new mod.EdgeTTS();
      const chunks = [];
      let voice = forceVoice;
      if (!voice) {
        const mode = _getVoiceMode();
        if (mode === 'edge_dalia') voice = EDGE_TTS_VOICE_DALIA;
        else if (mode === 'edge_elvira') voice = EDGE_TTS_VOICE_ELVIRA;
        else if (mode === 'edge_jorge') voice = EDGE_TTS_VOICE_JORGE;
        else if (mode === 'edge_alvaro') voice = EDGE_TTS_VOICE_ES;
        else if (mode === 'edge_ryan') voice = EDGE_TTS_VOICE_RYAN;
        else voice = EDGE_TTS_VOICE_DALIA;
      }
      // Maquillaje vendedora: Dalia más alegre y viva (coqueteo comercial en la prosodia)
      const isDalia = voice === EDGE_TTS_VOICE_DALIA;
      const isFemale = isDalia || voice === EDGE_TTS_VOICE_ELVIRA;
      const edgeOpts = {
        rate: isDalia ? '+10%' : '+3%',
        pitch: isDalia ? '+4Hz' : (isFemale ? '+2Hz' : '+0Hz'),
        volume: isDalia ? '+2%' : '+0%'
      };
      for await (const chunk of tts.synthesizeStream(clean, voice, edgeOpts)) {
        chunks.push(chunk);
      }
      if (!chunks.length) return false;
      const blob = new Blob(chunks, { type: 'audio/mpeg' });
      return _playAudioBlob(blob, text);
    } catch(e) {
      console.warn('[Gigi/Voz] Edge TTS falló:', e.message);
      return false;
    }
  }

  function stopAISpeech() {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (_activeJarvisAudio) {
      try { _activeJarvisAudio.pause(); } catch(e) {}
      _activeJarvisAudio = null;
    }
    if (_activeAudioSource) {
      try { _activeAudioSource.stop(); } catch(e) {}
      _activeAudioSource = null;
    }
    if (_activeAudioCtx) {
      try { _activeAudioCtx.close(); } catch(e) {}
      _activeAudioCtx = null;
    }
    setAISpeaking(false);
  }

  // ─── Utilidad: reproducir un Blob de audio ─────────────────────────────────
  function _playAudioBlob(blob, fallbackText) {
    return new Promise(resolve => {
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        resolve(!!ok);
      };
      // Evita cuelgues si el audio nunca dispara onended/onerror
      const watchdog = setTimeout(() => {
        console.warn('[Gigi/Voz] timeout reproduciendo blob');
        try { if (_activeJarvisAudio) _activeJarvisAudio.pause(); } catch (e) {}
        setAISpeaking(false);
        done(false);
      }, 60000);
      try {
        if (_activeJarvisAudio) {
          _activeJarvisAudio.pause();
          _activeJarvisAudio.src = '';
        }
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        const url = URL.createObjectURL(blob);
        const audio = new Audio();
        audio.preload = 'auto';
        audio.src = url;
        _activeJarvisAudio = audio;
        _shouldRestartMic = false;
        if (_recognition && _isListening && !_jarvisMode) try { _recognition.stop(); } catch(e) {}
        audio.onended = () => {
          URL.revokeObjectURL(url);
          _activeJarvisAudio = null;
          setAISpeaking(false);
          if (_jarvisMode) {
            _shouldRestartMic = true;
            setTimeout(() => {
              if (_jarvisMode && !_isListening && !_bubble.classList.contains('is-loading')) {
                try { _recognition.start(); } catch(e) {}
              }
            }, 300);
          }
          done(true);
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          setAISpeaking(false);
          done(false);
        };
        setAISpeaking(true);
        const p = audio.play();
        if (p && p.then) {
          p.then(() => {
            // Si el audio es muy corto, onended puede fallar en algunos navegadores
            if (audio.duration && isFinite(audio.duration) && audio.duration < 0.2) {
              setTimeout(() => done(true), 250);
            }
          }).catch((err) => {
            console.warn('[Gigi/Voz] audio.play() bloqueado:', err && err.name, err && err.message);
            URL.revokeObjectURL(url);
            setAISpeaking(false);
            done(false);
          });
        }
      } catch(e) {
        setAISpeaking(false);
        done(false);
      }
    });
  }

  // ─── Caché de voces del navegador — cargada de forma diferida y robusta ────
  let _cachedVoices = [];
  let _voiceCacheReady = false;

  function _loadVoicesWhenReady(callback) {
    if (!('speechSynthesis' in window)) { if (callback) callback([]); return; }
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      _cachedVoices = voices;
      _voiceCacheReady = true;
      if (callback) callback(voices);
    } else {
      // En Chrome/Edge/Brave las voces se cargan de forma asíncrona
      window.speechSynthesis.onvoiceschanged = () => {
        _cachedVoices = window.speechSynthesis.getVoices();
        _voiceCacheReady = true;
        window.speechSynthesis.onvoiceschanged = null;
        if (callback) callback(_cachedVoices);
      };
      // Segundo intento manual tras 500ms por si onvoiceschanged nunca dispara
      setTimeout(() => {
        if (!_voiceCacheReady) {
          _cachedVoices = window.speechSynthesis.getVoices();
          _voiceCacheReady = true;
          if (callback) callback(_cachedVoices);
        }
      }, 500);
    }
  }

  // Iniciar carga de voces al momento de definir el módulo
  _loadVoicesWhenReady(() => {
    console.log('[Gigi/Voz] ✓ Voces cargadas:', _cachedVoices.filter(v => v.lang.startsWith('es')).map(v => v.name).join(', ') || '(ninguna en español)');
  });

  function _pickFemaleSpanishVoice() {
    const voices = _cachedVoices.length ? _cachedVoices : window.speechSynthesis.getVoices();
    // Prioridad: voces femeninas latinas/españolas con nombre conocido → cualquier voz femenina en español → cualquier voz en español
    return voices.find(v => v.lang.startsWith('es') && (v.name.includes('Sabina') || v.name.includes('Dalia') || v.name.includes('Helena') || v.name.includes('Laura') || v.name.includes('Monica') || v.name.includes('Paulina') || v.name.includes('Luciana') || v.name.includes('Google esp') || v.name.includes('Spanish Female') || v.name.includes('Conchita') || v.name.includes('Penelope') || v.name.includes('Mia') || v.name.includes('Lupe') || v.name.includes('Sofia') || v.name.includes('Victoria') || v.name.includes('Camila') || v.name.includes('Paloma') || v.name.includes('Angelica') || v.name.includes('Soledad') || v.name.includes('Francisca')))
        || voices.find(v => v.lang.startsWith('es') && !v.name.toLowerCase().includes('male') && !v.name.toLowerCase().includes('hombre') && !v.name.toLowerCase().includes('jorge') && !v.name.toLowerCase().includes('pablo') && !v.name.toLowerCase().includes('carlos') && !v.name.toLowerCase().includes('alvaro') && !v.name.toLowerCase().includes('miguel'))
        || voices.find(v => v.lang.startsWith('es'))
        || null;
  }

  // ─── Nivel 2 (en desktop): Web Speech API — instantánea, sin red, sin CORS ──
  function _speakWebSpeech(text) {
    if (!('speechSynthesis' in window)) return false;
    try {
      const voices = _cachedVoices.length ? _cachedVoices : window.speechSynthesis.getVoices();
      if (!voices.length) return false;

      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
      const cleanText = _cleanTextForTTS(text);
      if (!cleanText) return false;

      _synthUtterance = new SpeechSynthesisUtterance(cleanText);
      _synthUtterance.rate  = 1.0;
      _synthUtterance.pitch = 1.05;  // Voz femenina por defecto

      const voiceMatch = _pickFemaleSpanishVoice();

      if (voiceMatch) {
        _synthUtterance.voice = voiceMatch;
        _synthUtterance.lang  = voiceMatch.lang;
      } else {
        _synthUtterance.lang  = 'es-MX';
      }

      console.log('[Gigi/Voz] WebSpeech →', voiceMatch ? voiceMatch.name : 'voz femenina por defecto (es-MX)');

      _synthUtterance.onstart = () => {
        setAISpeaking(true);
        _shouldRestartMic = false;
        if (_recognition && _isListening && !_jarvisMode) try { _recognition.stop(); } catch(e) {}
      };
      _synthUtterance.onend   = () => { setAISpeaking(false); };
      _synthUtterance.onerror = (ev) => {
        console.warn('[Gigi/Voz] Error WebSpeech:', ev.error);
        setAISpeaking(false);
      };

      window.speechSynthesis.speak(_synthUtterance);
      return true;
    } catch(e) {
      console.warn('[Gigi/Voz] _speakWebSpeech excepción:', e);
      setAISpeaking(false);
      return false;
    }
  }

  // ─── Gemini TTS / JARVIS Charon (voz grave del doc Voz_Charon_JARVIS.txt) ───
  function _getGeminiKey() {
    const cfg = window.KPK_CONFIG || {};
    let brandKeys = null;
    try {
      if (window.FerrariBrandDock && typeof window.FerrariBrandDock.getBrand === 'function') {
        brandKeys = window.FerrariBrandDock.getBrand().aiKeys || null;
      }
    } catch (e) {}
    // Preferir config.js (tiene Charon key) sobre brand vacío
    const candidates = [
      localStorage.getItem('ferrari_ai_key_gemini'),
      cfg.aiKeys && cfg.aiKeys.gemini,
      brandKeys && brandKeys.gemini
    ];
    for (const raw of candidates) {
      if (!raw || !String(raw).trim()) continue;
      const key = _deobfuscateKey(String(raw).trim());
      if (key && key.length >= 20) return key;
    }
    return '';
  }

  function _pcmToWav(pcmData, sampleRate) {
    const numChannels = 1, bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataSize = pcmData.length;
    const buf = new ArrayBuffer(44 + dataSize);
    const v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true);
    w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, numChannels, true); v.setUint32(24, sampleRate, true);
    v.setUint32(28, byteRate, true); v.setUint16(32, blockAlign, true);
    v.setUint16(34, bitsPerSample, true); w(36, 'data');
    v.setUint32(40, dataSize, true);
    new Uint8Array(buf, 44).set(pcmData);
    return new Blob([buf], { type: 'audio/wav' });
  }

  function _b64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function _geminiAudioPartToBlob(part) {
    if (!part || !part.data) return null;
    const bytes = _b64ToBytes(part.data);
    const mime = String(part.mimeType || 'audio/pcm').toLowerCase();
    if (mime.includes('pcm') || mime.includes('l16') || mime === 'audio/raw') {
      // Gemini Live/TTS: PCM 24 kHz mono 16-bit LE (Voz_Charon_JARVIS.txt)
      return _pcmToWav(bytes, 24000);
    }
    return new Blob([bytes], { type: mime.includes('audio') ? mime : 'audio/mpeg' });
  }

  // Solo el TTS más barato (price-performance). Pro/3.1 cuestan ~2× y queman cuota free.
  // Paid: $0.50/1M input + $10/1M audio vs 3.1 Flash TTS $1 + $20.
  const GEMINI_TTS_CHEAPEST = 'gemini-2.5-flash-preview-tts';
  const GEMINI_TTS_MODELS = [
    GEMINI_TTS_CHEAPEST
    // No rotar a Pro/3.1: agotan la cuota free más rápido sin mejor precio.
  ];

  // Estrategia experta: cerebro (Lightning) ≠ voz.
  // Charon = presupuesto diario + frases cortas. Dalia/Jorge = motor del día.
  let _geminiTtsCooldownUntil = 0;
  let _geminiTtsPreferredModel = '';
  const GEMINI_TTS_COOLDOWN_MS = 3 * 60 * 1000; // respaldo corto
  const CHARON_DAILY_BUDGET = 12;          // turnos Charon/día (local)
  const CHARON_MAX_CHARS = 220;            // frases largas → Dalia (ahorra cuota)
  const CHARON_BUDGET_KEY = 'kpk_charon_budget_v1';

  function _charonDayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function _readCharonBudget() {
    try {
      const raw = localStorage.getItem(CHARON_BUDGET_KEY);
      const o = raw ? JSON.parse(raw) : null;
      if (!o || o.day !== _charonDayKey()) {
        return { day: _charonDayKey(), used: 0, locked: false };
      }
      return { day: o.day, used: Number(o.used) || 0, locked: !!o.locked };
    } catch (e) {
      return { day: _charonDayKey(), used: 0, locked: false };
    }
  }

  function _writeCharonBudget(state) {
    try {
      localStorage.setItem(CHARON_BUDGET_KEY, JSON.stringify({
        day: state.day || _charonDayKey(),
        used: state.used || 0,
        locked: !!state.locked
      }));
    } catch (e) {}
  }

  function _charonBudgetLeft() {
    const s = _readCharonBudget();
    if (s.locked) return 0;
    return Math.max(0, CHARON_DAILY_BUDGET - s.used);
  }

  function _consumeCharonBudget() {
    const s = _readCharonBudget();
    s.used = (s.used || 0) + 1;
    _writeCharonBudget(s);
    console.log('[Gigi/Voz] Charon presupuesto', s.used + '/' + CHARON_DAILY_BUDGET);
  }

  function _lockCharonForToday(reason) {
    const s = _readCharonBudget();
    s.locked = true;
    _writeCharonBudget(s);
    _geminiTtsCooldownUntil = Date.now() + GEMINI_TTS_COOLDOWN_MS;
    console.warn('[Gigi/Voz] Charon bloqueado hoy → Dalia. Motivo:', reason);
    try {
      if (window.FerrariUI && typeof window.FerrariUI.showToast === 'function') {
        window.FerrariUI.showToast('Charon agotado hoy → voz Dalia/Jorge', 'warning');
      }
    } catch (e) {}
  }

  function _geminiTtsOnCooldown() {
    const s = _readCharonBudget();
    if (s.locked || _charonBudgetLeft() <= 0) return true;
    return Date.now() < _geminiTtsCooldownUntil;
  }

  function _shouldSpendCharon(text) {
    if (_geminiTtsOnCooldown()) return false;
    const clean = _cleanTextForTTS(text || '');
    if (!clean) return false;
    // Frases largas queman audio tokens: Dalia las cubre mejor
    if (clean.length > CHARON_MAX_CHARS) {
      console.log('[Gigi/Voz] Texto largo (' + clean.length + 'c) → Dalia (ahorra Charon)');
      return false;
    }
    return _charonBudgetLeft() > 0;
  }

  function _tripGeminiTtsCooldown(reason) {
    // 429/403 = fin del día para Charon (no solo 3 min)
    _lockCharonForToday(reason || 'HTTP 429/403');
  }

  /** Charon = JARVIS vendedor. Kore = Gigi. */
  async function _speakGeminiVoice(text, voiceName) {
    const key = _getGeminiKey();
    if (!key) {
      console.warn('[Gigi/Voz] Sin key Gemini → no Charon/Kore');
      return false;
    }
    if (_geminiTtsOnCooldown()) {
      console.log('[Gigi/Voz] Gemini TTS en cooldown → saltando a Dalia');
      return false;
    }

    const clean = _cleanTextForTTS(text);
    if (!clean) return false;
    const voice = voiceName || 'Charon';

    // Prompt corto = menos tokens de entrada (más turnos antes del rate-limit)
    const speakPrompt = voice === 'Charon'
      ? `Say briskly with energetic Chilean real-estate salesman energy (fast, confident, no butler tone):\n"${clean}"`
      : `Say warmly and clearly:\n"${clean}"`;

    // Preferir el último modelo que funcionó
    const models = _geminiTtsPreferredModel
      ? [_geminiTtsPreferredModel].concat(GEMINI_TTS_MODELS.filter(m => m !== _geminiTtsPreferredModel))
      : GEMINI_TTS_MODELS.slice();

    let sawRateLimit = false;

    for (const model of models) {
      try {
        const body = JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: speakPrompt }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voice }
              }
            }
          }
        });
        let res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          { method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body }
        );
        if (!res.ok) {
          res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
          );
        }
        if (res.status === 429 || res.status === 403) {
          console.warn('[Gigi/Voz] Gemini', model, 'HTTP', res.status, '(cuota)');
          sawRateLimit = true;
          continue;
        }
        if (!res.ok) {
          console.warn('[Gigi/Voz] Gemini', model, 'HTTP', res.status);
          continue;
        }
        const data = await res.json();
        const parts = data.candidates?.[0]?.content?.parts || [];
        const inline = parts.find(p => p.inlineData && p.inlineData.data)?.inlineData;
        const blob2 = _geminiAudioPartToBlob(inline);
        if (blob2 && blob2.size > 100) {
          _geminiTtsPreferredModel = model;
          if (voice === 'Charon') _consumeCharonBudget();
          _lastUsedVoiceEngine = voice === 'Charon' ? 'jarvis_charon' : 'gemini_tts';
          console.log('[Gigi/Voz] ✓ Gemini', voice, 'vía', model);
          return _playAudioBlob(blob2, text);
        }
      } catch (e) {
        console.warn('[Gigi/Voz] Gemini', model, e.message);
      }
    }

    // Interactions API (otra cuota / ruta)
    try {
      const body = JSON.stringify({
        model: GEMINI_TTS_CHEAPEST,
        input: speakPrompt,
        response_format: { type: 'audio' },
        generation_config: {
          speech_config: [{ voice: voice }]
        }
      });
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body
      });
      if (res.status === 429 || res.status === 403) {
        sawRateLimit = true;
      } else if (res.ok) {
        const data = await res.json();
        const b64 = data.output_audio?.data || data.outputAudio?.data;
        if (b64) {
          const bytes = _b64ToBytes(b64);
          const blob = _pcmToWav(bytes, 24000);
          if (voice === 'Charon') _consumeCharonBudget();
          _lastUsedVoiceEngine = voice === 'Charon' ? 'jarvis_charon' : 'gemini_tts';
          console.log('[Gigi/Voz] ✓ Gemini', voice, 'vía interactions API');
          return _playAudioBlob(blob, text);
        }
      } else {
        console.warn('[Gigi/Voz] interactions HTTP', res.status);
      }
    } catch (e) {
      console.warn('[Gigi/Voz] interactions error:', e.message);
    }

    if (sawRateLimit) _tripGeminiTtsCooldown('HTTP 429/403');
    return false;
  }

  async function _speakGeminiTTS(text) {
    return _speakGeminiVoice(text, 'Kore');
  }

  async function _speakCharonJarvis(text) {
    return _speakGeminiVoice(text, 'Charon');
  }

  /** Siempre intentar Dalia local (proxy) — fallback humano obligatorio */
  async function _tryDaliaFallback(text, wantsMale) {
    const proxyUp = await _probeLocalTtsProxy(true); // force: no cachear "apagado"
    if (!proxyUp) {
      console.warn('[Gigi/Voz] Proxy Dalia apagado (npm run tts). Sin fallback humano local.');
      return false;
    }
    const localVoice = wantsMale ? EDGE_TTS_VOICE_JORGE : EDGE_TTS_VOICE_DALIA;
    if (await _speakLocalDalia(text, localVoice)) {
      _lastUsedVoiceEngine = 'local_dalia';
      console.log('[Gigi/Voz] ✓ Dalia Neural LOCAL (fallback humano)');
      return true;
    }
    return false;
  }

  // ─── speakJarvis: cerebro Lightning; voz Charon (presupuesto) → Dalia → resto ───
  let _speakGen = 0;
  async function speakJarvis(text) {
    if (!text) return;
    const gen = ++_speakGen;
    _lastSpokenText = _cleanTextForTTS(text);

    // Siempre releer admin flag (evita Charon+Dalia si se reactivó sola)
    _speechEnabled = localStorage.getItem(TTS_OUTPUT_KEY) === '1';

    const isMobile = window.innerWidth < 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) showMobileBubblePopup(text);

    // Cortar cualquier audio previo (doble voz Charon/Dalia/WebSpeech)
    try { stopAISpeech(); } catch (e) {}
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
    if (_activeJarvisAudio) { try { _activeJarvisAudio.pause(); } catch (e) {} _activeJarvisAudio = null; }

    if (!_speechEnabled) {
      console.log('[Gigi/Voz] TTS OFF (admin) — solo texto');
      return;
    }
    if (gen !== _speakGen) return;
    _unlockMobileAudio();

    const preferred = _getPreferredVoiceMode();
    let mode = await _resolveVoiceModeAsync();
    const isWebSpeechOnly = preferred === 'webspeech' || mode === 'webspeech';

    if (String(mode).startsWith('edge_') && !_isMicrosoftEdgeBrowser()) {
      mode = 'local_dalia';
    }

    const wantsMale = preferred.includes('daniel') || mode.includes('daniel') || mode.includes('jorge')
      || mode.includes('alvaro') || mode.includes('ryan') || mode.includes('miguel')
      || preferred.includes('jarvis') || preferred.includes('charon');
    let streamVoice = wantsMale ? 'Miguel' : 'Mia';
    if (mode === 'stream_lucia') streamVoice = 'Lucia';
    else if (mode === 'stream_penelope') streamVoice = 'Penelope';
    else if (mode === 'stream_gigi' || mode === 'auto_gigi') streamVoice = 'Mia';

    const wantsCharon = preferred === 'jarvis_charon' || preferred === 'gemini_charon' || mode === 'jarvis_charon'
      || preferred === 'gemini_tts' || mode === 'gemini_tts';
    const wantsDaliaFirst = preferred === 'local_dalia' || mode === 'local_dalia'
      || preferred === 'edge_dalia' || mode === 'edge_dalia';

    console.log('[Gigi/Voz] Preferencia:', preferred, '→ efectiva:', mode,
      '| Charon left:', _charonBudgetLeft(),
      _geminiTtsOnCooldown() ? '(Dalia mode)' : '');

    if (isWebSpeechOnly) {
      if (_speakWebSpeech(text)) _lastUsedVoiceEngine = 'webspeech';
      return;
    }

    // Modo JARVIS: Charon solo si hay presupuesto y frase corta; si no, Dalia/Jorge directo
    if (wantsCharon) {
      const spendCharon = (preferred === 'gemini_tts' || mode === 'gemini_tts')
        ? !_geminiTtsOnCooldown()
        : _shouldSpendCharon(text);

      if (spendCharon) {
        const vName = (preferred === 'gemini_tts' || mode === 'gemini_tts') ? 'Kore' : 'Charon';
        if (await _speakGeminiVoice(text, vName)) {
          console.log('[Gigi/Voz] ✓', vName === 'Charon' ? 'JARVIS Charon' : 'Gemini Kore');
          return;
        }
        console.warn('[Gigi/Voz] Charon/Gemini falló → Dalia/Jorge');
      }

      if (await _tryDaliaFallback(text, wantsMale)) return;

      // En JARVIS no quemamos ElevenLabs; saltamos a SE/Google solo si proxy apagado
      if (await _speakStreamElements(text, streamVoice)) {
        _lastUsedVoiceEngine = 'streamelements';
        return;
      }
      if (await _speakGoogleTranslate(text)) {
        _lastUsedVoiceEngine = 'google_tts';
        return;
      }
      console.warn('[Gigi/Voz] ⚠️ Solo WebSpeech. Arranca: npm run tts');
      try {
        if (window.FerrariUI && typeof window.FerrariUI.showToast === 'function') {
          window.FerrariUI.showToast('Sin Dalia: ejecuta npm run tts', 'warning');
        }
      } catch (e) {}
      if (_speakWebSpeech(text)) _lastUsedVoiceEngine = 'webspeech';
      return;
    }

    // 1) Dalia primero si el usuario la eligió
    if (wantsDaliaFirst) {
      if (await _tryDaliaFallback(text, wantsMale)) return;
    }

    // 2) Dalia para auto / otros modos
    if (!wantsDaliaFirst) {
      if (await _tryDaliaFallback(text, wantsMale)) return;
    }

    // 3) ElevenLabs si hay créditos
    if (preferred === 'auto_gigi' || preferred.startsWith('elevenlabs') || mode.startsWith('elevenlabs')) {
      const wantDaniel = preferred.includes('daniel') || mode.includes('daniel');
      const elOk = await _probeElevenLabs(false);
      if (elOk) {
        const v = wantDaniel ? ELEVENLABS_VOICE_DANIEL : ELEVENLABS_VOICE_GIGI;
        if (await _speakElevenLabs(text, v)) {
          _lastUsedVoiceEngine = 'elevenlabs';
          return;
        }
      }
    }

    // 4) Edge directo solo en Microsoft Edge
    if (String(mode).startsWith('edge_') && _isMicrosoftEdgeBrowser()) {
      let ev = EDGE_TTS_VOICE_DALIA;
      if (mode === 'edge_elvira') ev = EDGE_TTS_VOICE_ELVIRA;
      else if (mode === 'edge_jorge') ev = EDGE_TTS_VOICE_JORGE;
      else if (mode === 'edge_alvaro') ev = EDGE_TTS_VOICE_ES;
      else if (mode === 'edge_ryan') ev = EDGE_TTS_VOICE_RYAN;
      if (await _speakEdgeTTS(text, ev)) {
        _lastUsedVoiceEngine = 'edge_tts';
        return;
      }
    }

    // 5) StreamElements (vía proxy /se si está arriba)
    if (await _speakStreamElements(text, streamVoice)) {
      _lastUsedVoiceEngine = 'streamelements';
      console.log('[Gigi/Voz] ✓ StreamElements', streamVoice);
      return;
    }

    // 6) Google Translate
    if (await _speakGoogleTranslate(text)) {
      _lastUsedVoiceEngine = 'google_tts';
      return;
    }

    // 7) WebSpeech — solo si TODO humano falló
    console.warn('[Gigi/Voz] ⚠️ Solo WebSpeech. Arranca: npm run tts');
    try {
      if (window.FerrariUI && typeof window.FerrariUI.showToast === 'function') {
        window.FerrariUI.showToast('Sin Dalia/Charon: ejecuta npm run tts', 'warning');
      }
    } catch (e) {}
    if (_speakWebSpeech(text)) {
      _lastUsedVoiceEngine = 'webspeech';
    }
  }

  function playFuturisticSound(type) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      
      if (type === 'start') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(300, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1000, ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
      } else if (type === 'success') {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(750, ctx.currentTime);
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1150, ctx.currentTime);
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc1.start(ctx.currentTime);
        osc2.start(ctx.currentTime);
        osc1.stop(ctx.currentTime + 0.5);
        osc2.stop(ctx.currentTime + 0.5);
      } else if (type === 'click') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1400, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(700, ctx.currentTime + 0.04);
        gain.gain.setValueAtTime(0.04, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.04);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.04);
      }
    } catch(e) {}
  }

  async function fetchCharonAudio(text) {
    // Compat: usa el motor unificado Charon
    const ok = await _speakCharonJarvis(text);
    return ok ? 'played' : null;
  }

  let _activeAudioSource = null;
  let _activeAudioCtx = null;

  function playAudioBase64(base64Data, fallbackText = '') {
    if (fallbackText) {
      _lastSpokenText = _cleanTextForTTS(fallbackText);
    }
    try {
      // Detener audio anterior si estuviera sonando
      if (_activeAudioSource) {
        try { _activeAudioSource.stop(); } catch(e) {}
      }
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      _activeAudioCtx = ctx;

      const binaryString = atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const arrayBuffer = bytes.buffer;

      ctx.decodeAudioData(arrayBuffer, (buffer) => {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        _activeAudioSource = source;

        setAISpeaking(true);

        source.onended = () => {
          _activeAudioSource = null;
          setAISpeaking(false);
          if (_jarvisMode) {
            _shouldRestartMic = true;
            setTimeout(() => {
              if (_jarvisMode && !_isListening && !_bubble.classList.contains('is-loading')) {
                try { _recognition.start(); } catch(e) {}
              }
            }, 300);
          }
        };

        // Pausar mic mientras reproduce la voz (solo si no estamos en JarvisMode continuo)
        _shouldRestartMic = false;
        if (_recognition && _isListening && !_jarvisMode) {
          try { _recognition.stop(); } catch(e) {}
        }

        source.start(0);
      }, (err) => {
        console.error('[Ferrari/IA] Error decodificando audio de Gemini:', err);
        setAISpeaking(false);
        // Fallback si la decodificación falla
        speakJarvis(fallbackText);
      });
    } catch (e) {
      console.error('[Ferrari/IA] Error al reproducir audio base64:', e);
      setAISpeaking(false);
    }
  }

  let _liveWs = null;
  let _liveAudioCtxIn = null;
  let _liveProcessor = null;
  let _liveMicStream = null;
  let _liveAudioCtxOut = null;
  let _liveNextPlayTime = 0;
  let _liveActiveSource = null;
  let _currentSystemMsgNode = null;

  async function startLiveWebSocket() {
    if (_liveWs) stopLiveWebSocket();

    _isListening = true;
    _btnMic.classList.add('is-active');
    _bubble.classList.add('is-loading');

    const isAccessToken = _apiKey.startsWith('ya29.') || _apiKey.startsWith('AQ.');
    const wsUrl = isAccessToken
      ? `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?access_token=${_apiKey}`
      : `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${_apiKey}`;

    _liveWs = new WebSocket(wsUrl);
    _currentSystemMsgNode = null;

    _liveWs.onopen = async () => {
      console.log('[Ferrari/Live] WebSocket conectado. Enviando Setup...');
      const context = buildContextPrompt();

      const setupFrame = {
        setup: {
          model: "models/gemini-2.0-flash-exp",
          generationConfig: {
            responseModalities: ["TEXT", "AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: "Charon"
                }
              }
            }
          },
          systemInstruction: {
            parts: [{ text: context }]
          },
          tools: [{
            functionDeclarations: [
              {
                name: "lookAtLote",
                description: "Mueve la cámara hacia un lote específico.",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    loteId: { type: "STRING" },
                    hfov: { type: "NUMBER" }
                  },
                  required: ["loteId"]
                }
              },
              {
                name: "openLotePanel",
                description: "Abre la ficha del lote.",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    loteId: { type: "STRING" }
                  },
                  required: ["loteId"]
                }
              },
              {
                name: "openNearbyTab",
                description: "Abre la pestaña de cercanos.",
                parameters: {
                  type: "OBJECT"
                }
              }
            ]
          }]
        }
      };

      _liveWs.send(JSON.stringify(setupFrame));

      try {
        _liveMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        _liveAudioCtxIn = new AudioCtx({ sampleRate: 16000 });

        const source = _liveAudioCtxIn.createMediaStreamSource(_liveMicStream);
        _liveProcessor = _liveAudioCtxIn.createScriptProcessor(2048, 1, 1);

        _liveProcessor.onaudioprocess = (e) => {
          if (!_liveWs || _liveWs.readyState !== WebSocket.OPEN) return;

          const inputData = e.inputBuffer.getChannelData(0);
          const int16Buffer = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const val = Math.max(-1, Math.min(1, inputData[i]));
            int16Buffer[i] = val < 0 ? val * 0x8000 : val * 0x7FFF;
          }

          const base64Data = arrayBufferToBase64(int16Buffer.buffer);

          _liveWs.send(JSON.stringify({
            realtimeInput: {
              mediaChunks: [
                {
                  mimeType: "audio/pcm",
                  data: base64Data
                }
              ]
            }
          }));
        };

        source.connect(_liveProcessor);
        _liveProcessor.connect(_liveAudioCtxIn.destination);

        console.log('[Ferrari/Live] Micrófono transmitiendo a 16kHz');
      } catch (err) {
        console.error('[Ferrari/Live] Error micrófono:', err);
        appendMessage('No se pudo acceder al micrófono. Asegúrate de otorgar permisos.', 'system');
        stopLiveWebSocket();
      }
    };

    _liveWs.onmessage = async (e) => {
      const data = JSON.parse(e.data);

      if (data.serverContent) {
        _bubble.classList.remove('is-loading');
        const parts = data.serverContent.modelTurn?.parts || [];
        let textChunk = '';
        for (const part of parts) {
          if (part.text) {
            textChunk += part.text;
          }
          if (part.inlineData) {
            playLivePCMChunk(part.inlineData.data);
          }
        }

        if (textChunk) {
          appendOrUpdateLiveMessage(textChunk);
        }
      }

      if (data.toolCall) {
        const functionCalls = data.toolCall.functionCalls || [];
        for (const call of functionCalls) {
          let status = "success";
          try {
            if (call.name === 'lookAtLote') {
              lookAtLote(call.args.loteId, call.args.hfov);
            } else if (call.name === 'openLotePanel') {
              openLotePanel(call.args.loteId);
            } else if (call.name === 'openNearbyTab') {
              if (window.FerrariBuyerDock && typeof window.FerrariBuyerDock.setTab === 'function') {
                window.FerrariBuyerDock.setTab('lugares');
              }
            }
          } catch (err) {
            status = "error";
          }

          _liveWs.send(JSON.stringify({
            toolResponse: {
              functionResponses: [{
                response: { status: status },
                id: call.id
              }]
            }
          }));
        }
      }
    };

    _liveWs.onerror = (e) => {
      console.error('[Ferrari/Live] Error WebSocket:', e);
    };

    _liveWs.onclose = (e) => {
      console.log('[Ferrari/Live] WebSocket cerrado:', e.code, e.reason);
      stopLiveWebSocket();
      if (e.code === 4003 || e.code === 4401 || e.code === 1006) {
        appendMessage('Error de conexión con la voz de Jarvis. Revisa tu API Key de Google.', 'system');
      }
    };
  }

  function stopLiveWebSocket() {
    _isListening = false;
    _btnMic.classList.remove('is-active');
    _bubble.classList.remove('is-loading');

    if (_liveProcessor) {
      try { _liveProcessor.disconnect(); } catch (e) {}
      _liveProcessor = null;
    }
    if (_liveAudioCtxIn) {
      try { _liveAudioCtxIn.close(); } catch (e) {}
      _liveAudioCtxIn = null;
    }
    if (_liveMicStream) {
      _liveMicStream.getTracks().forEach(t => t.stop());
      _liveMicStream = null;
    }

    if (_liveWs) {
      try { _liveWs.close(); } catch (e) {}
      _liveWs = null;
    }

    if (_liveActiveSource) {
      try { _liveActiveSource.stop(); } catch (e) {}
      _liveActiveSource = null;
    }
    if (_liveAudioCtxOut) {
      try { _liveAudioCtxOut.close(); } catch (e) {}
      _liveAudioCtxOut = null;
    }
    _liveNextPlayTime = 0;
    _currentSystemMsgNode = null;
  }

  function appendOrUpdateLiveMessage(text) {
    if (!_currentSystemMsgNode) {
      _currentSystemMsgNode = document.createElement('div');
      _currentSystemMsgNode.className = 'kpk-ai-msg msg-system';

      const txtNode = document.createElement('span');
      txtNode.className = 'kpk-msg-text';
      txtNode.textContent = text;
      _currentSystemMsgNode.appendChild(txtNode);

      _log.appendChild(_currentSystemMsgNode);
    } else {
      const txtNode = _currentSystemMsgNode.querySelector('.kpk-msg-text');
      if (txtNode) {
        txtNode.textContent += text;
      }
    }
    _log.scrollTop = _log.scrollHeight;
  }

  function playLivePCMChunk(base64PCM) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!_liveAudioCtxOut) {
        _liveAudioCtxOut = new AudioCtx();
      }

      const binary = atob(base64PCM);
      const len = binary.length;
      const arrayBuffer = new ArrayBuffer(len);
      const view = new DataView(arrayBuffer);
      for (let i = 0; i < len; i++) {
        view.setUint8(i, binary.charCodeAt(i));
      }

      const sampleCount = len / 2;
      const floatData = new Float32Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        const sample = view.getInt16(i * 2, true);
        floatData[i] = sample / 32768.0;
      }

      const audioBuffer = _liveAudioCtxOut.createBuffer(1, sampleCount, 24000);
      audioBuffer.copyToChannel(floatData, 0);

      const source = _liveAudioCtxOut.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(_liveAudioCtxOut.destination);

      const currentTime = _liveAudioCtxOut.currentTime;
      const playTime = Math.max(currentTime, _liveNextPlayTime);
      source.start(playTime);

      _liveNextPlayTime = playTime + audioBuffer.duration;
    } catch (e) {
      console.error('Error en playLivePCMChunk:', e);
    }
  }

  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  // ══════════════════════════════════════════════════════════════════════════
  //  MOTOR DE AUTODESCUBRIMIENTO GEOGRÁFICO Y ENTORNO DINÁMICO
  // ══════════════════════════════════════════════════════════════════════════
  const MASTER_REGIONAL_HUBS = [
    // Región de Los Lagos (Carretera Austral / Hualaihué / Palena / Llanquihue)
    { nombre: "Contao (Pueblo rural y centro de servicios)", lat: -41.8214, lng: -72.7081, ferrying: false },
    { nombre: "Aulén (Pueblo costero)", lat: -41.8841, lng: -72.7912, ferrying: false },
    { nombre: "Caleta Puelche (Terminal Transbordador)", lat: -41.7451, lng: -72.6425, ferrying: false },
    { nombre: "Caleta La Arena (Cruce Ferry Carretera Austral Ruta 7)", lat: -41.6912, lng: -72.6391, ferrying: true },
    { nombre: "Hornopirén (Capital Comunal de Hualaihué)", lat: -41.9647, lng: -72.4419, ferrying: false },
    { nombre: "Puerto Montt (Capital Regional)", lat: -41.4689, lng: -72.9411, ferrying: false },
    { nombre: "Alerce (Ciudad de conexión)", lat: -41.3934, lng: -72.9056, ferrying: false },
    { nombre: "Puerto Varas (Ciudad turística Lago Llanquihue)", lat: -41.3194, lng: -72.9854, ferrying: false },
    { nombre: "Frutillar (Ciudad lacustre)", lat: -41.1274, lng: -73.0458, ferrying: false },
    { nombre: "Llanquihue", lat: -41.2589, lng: -73.0089, ferrying: false },
    { nombre: "Ensenada (Volcán Osorno / Todos los Santos)", lat: -41.2114, lng: -72.5369, ferrying: false },
    { nombre: "Aeropuerto Internacional El Tepual (PMC)", lat: -41.4397, lng: -73.0934, ferrying: false },

    // Chiloé
    { nombre: "Ancud (Chiloé)", lat: -41.8689, lng: -73.8241, ferrying: false },
    { nombre: "Castro (Chiloé)", lat: -42.4721, lng: -73.7732, ferrying: false },
    { nombre: "Chacao (Terminal Ferry Chiloé)", lat: -41.8312, lng: -73.5289, ferrying: true },

    // Los Ríos & La Araucanía
    { nombre: "Osorno", lat: -40.5739, lng: -73.1336, ferrying: false },
    { nombre: "Valdivia", lat: -39.8142, lng: -73.2459, ferrying: false },
    { nombre: "Pucón", lat: -39.2821, lng: -71.9772, ferrying: false },
    { nombre: "Temuco", lat: -38.7359, lng: -72.5904, ferrying: false },

    // Patagonia Sur
    { nombre: "Coyhaique", lat: -45.5752, lng: -72.0662, ferrying: false },
    { nombre: "Puerto Aysén", lat: -45.4056, lng: -72.6931, ferrying: false },
    { nombre: "Punta Arenas", lat: -53.1638, lng: -70.9171, ferrying: false },
    { nombre: "Puerto Natales", lat: -51.7269, lng: -72.5062, ferrying: false }
  ];

  function _haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round((R * c) * 10) / 10;
  }

  function getDynamicEnvironment(lat, lng) {
    if (!lat || !lng) {
      const g = (window.FerrariGeo && window.FerrariGeo.droneOrigin) || {};
      lat = g.lat || -41.87585;
      lng = g.lng || -72.748294;
    }

    const hubsWithDist = MASTER_REGIONAL_HUBS.map(hub => {
      const dist = _haversineKm(lat, lng, hub.lat, hub.lng);
      let min = Math.round((dist / 50) * 60);
      if (min < 3) min = 3;
      if (hub.ferrying) min += 25;

      return {
        ...hub,
        distKm: dist === 0 ? "En el loteo" : `${dist} km`,
        tiempoMin: `${min} min`,
        rawDist: dist
      };
    });

    hubsWithDist.sort((a, b) => a.rawDist - b.rawDist);
    const nearestHubs = hubsWithDist.slice(0, 6);
    const mainHub = nearestHubs[0];

    return {
      origin: { lat, lng },
      mainSector: mainHub ? mainHub.nombre.split('(')[0].trim() : "Zona Sur",
      hubs: nearestHubs
    };
  }

  const LOCAL_KNOWLEDGE_RULES = [
    // --- GRUPO 1: GENTILEZAS, SALUDOS Y AGRADECIMIENTOS ---
    {
      regex: /^(hola|buenos\s+dias|buenas\s+tardes|buenas\s+noches|quien\s+eres|como\s+te\s+llamas|hola\s+jarvis|hola\s+gigi|jarvis|gigi)/i,
      text: "¡Hola! Soy Jarvis, tu asesor en este tour 360°. ¿Qué lote o información te interesa?"
    },
    {
      regex: /^(gracias|muchas\s+gracias|agradecido|excelente|buenisimo|perfecto|genial|ok|vale|entendido)/i,
      text: "¡Con mucho gusto! ¿Hay algo más en lo que pueda ayudarte?"
    },
    {
      regex: /^(chao|adios|hasta\s+luego|nos\s+vemos|me\s+retiro|cerrar\s+sesion)/i,
      text: "¡Hasta luego! Gracias por visitar nuestro proyecto en 360°. Si deseas retomar la conversación o agendar una visita en persona, no dudes en volver a hablarme. ¡Que tengas un excelente día!"
    },

    // --- GRUPO 2: FINANCIAMIENTO Y FORMAS DE PAGO ---
    {
      regex: /^(¿?se\s+puede\s+pagar\s+en\s+cuotas\??|¿?tienen\s+financiamiento\s+directo\??|¿?ofrecen\s+credito\s+directo\??|¿?credito\s+directo\??|¿?financiamiento\s+directo\??)/i,
      text: "Sí, contamos con opciones de financiamiento directo flexible. Generalmente consiste en dar un pie inicial de reserva y el saldo restante se puede pactar en cuotas fijas en UF. Para armar una simulación personalizada a tu medida, te recomiendo contactar directamente al propietario por el WhatsApp de ventas del proyecto."
    },
    {
      regex: /^(¿?cuanto\s+es\s+el\s+pie\??|¿?cuanto\s+se\s+pide\s+de\s+pie\??|¿?pie\s+minimo\??|¿?monto\s+de\s+reserva\??|¿?con\s+cuanto\s+se\s+reserva\??)/i,
      text: "La reserva formal de una parcela se realiza con un pie mínimo o abono inicial de reserva (normalmente desde el 10% del valor total o un monto fijo acordado). Este abono asegura la exclusividad del lote mientras se redacta la promesa de compraventa. Usa el botón Contactar de la ficha para solicitar los datos de transferencia oficiales."
    },
    {
      regex: /^(¿?formas\s+de\s+pago\??|¿?como\s+se\s+puede\s+pagar\??|¿?se\s+puede\s+transferir\??|¿?aceptan\s+credito\s+hipotecario\??|¿?credito\s+hipotecario\??)/i,
      text: "Aceptamos pago al contado mediante transferencia bancaria directa, vale vista, y créditos hipotecarios de cualquier banco nacional para fines generales o autoconstrucción. También ofrecemos crédito directo flexible con la administración del loteo."
    },
    {
      regex: /^(¿?aceptan\s+vehiculo\??|¿?reciben\s+auto\??|¿?reciben\s+propiedad\??|¿?aceptan\s+permuta\??)/i,
      text: "Por regla general, el loteo no acepta vehículos o propiedades en parte de pago o permuta directa. Sin embargo, para ofertas excepcionales de pago al contado, te sugerimos plantearlo por el formulario Contactar de la ficha para que sea evaluado por el propietario."
    },
    {
      regex: /^(¿?descuento\s+por\s+pago\s+al\s+contado\??|¿?hay\s+descuento\s+contado\??|¿?precio\s+conversable\??|¿?se\s+puede\s+hacer\s+oferta\??)/i,
      text: "Sí, para pagos al contado (con vale vista o transferencia directa al momento de escriturar) es posible aplicar un descuento comercial sobre el valor de lista de las parcelas. Te invitamos a comunicarte vía WhatsApp de ventas del proyecto para negociar la oferta."
    },

    // --- GRUPO 3: SERVICIOS BÁSICOS (LUZ, AGUA, INTERNET) ---
    {
      regex: /^(¿?como\s+es\s+el\s+tema\s+de\s+la\s+luz\??|¿?tiene\s+electricidad\??|¿?tienen\s+luz\??|¿?el\s+loteo\s+tiene\s+luz\??|¿?luz\s+aerea\s+o\s+subterranea\??)/i,
      text: "El proyecto cuenta con postación eléctrica aérea y tendido habilitado en los caminos principales. Cada parcela tiene la factibilidad para solicitar su propio empalme directamente a la empresa distribuidora de la zona (Saesa) una vez que empiece su proceso de construcción."
    },
    {
      regex: /^(¿?tiene\s+agua\??|¿?como\s+se\s+obtiene\s+agua\??|¿?tiene\s+agua\s+potable\??|¿?hay\s+apr\??|¿?agua\s+por\s+pozo\??)/i,
      text: "El agua se obtiene de manera autónoma mediante la excavación de un pozo profundo o puntera (abundante napa subterránea en la zona a pocos metros). Asimismo, el loteo cuenta con derechos de agua inscritos y el proyecto de conexión a red de APR (Agua Potable Rural) local está en etapa de desarrollo técnico."
    },
    {
      regex: /^(¿?hay\s+alcantarillado\??|¿?como\s+es\s+el\s+alcantarillado\??|¿?fosa\s+septica\??|¿?donde\s+van\s+los\s+desechos\??)/i,
      text: "Al tratarse de una zona campestre de parcelaciones rurales, no existe red pública de alcantarillado. Cada propietario debe instalar su propio sistema de fosa séptica con drenaje certificado por el Servicio de Salud, lo cual es la norma estándar para parcelas en Chile."
    },
    {
      regex: /^(¿?tiene\s+internet\??|¿?hay\s+fibra\s+optica\??|¿?como\s+es\s+la\s+senal\??|¿?hay\s+cobertura\s+movil\??|¿?cobertura\s+de\s+celular\??)/i,
      text: "La cobertura móvil 4G/5G de Entel, Movistar y Claro es excelente en todo el loteo. Para internet domiciliario de alta velocidad, la mejor opción es Starlink (satelital con 100% de efectividad) o contratar internet inalámbrico dedicado rural con los proveedores locales."
    },

    // --- GRUPO 4: ASPECTOS LEGALES Y REGLAMENTARIOS ---
    {
      regex: /^(¿?las\s+parcelas\s+tienen\s+rol\s+propio\??|¿?tiene\s+rol\??|¿?cada\s+lote\s+tiene\s+rol\??|¿?rol\s+propio\??|¿?rol\s+individual\??|¿?estan\s+preaprobadas\s+por\s+el\s+sag\??)/i,
      text: "¡Absolutamente! Cada parcela cuenta con su **Rol propio individual e independiente**, certificado y preaprobado por el SAG y debidamente inscrito en el Conservador de Bienes Raíces (CBRS). Esto significa que la compra es de dominio absoluto (no es cesión de derechos ni loteo irregular)."
    },
    {
      regex: /^(¿?tienen\s+reglamento\s+de\s+copropiedad\??|¿?reglamento\s+interno\??|¿?hay\s+reglamento\??|¿?se\s+permiten\s+mascotas\??|¿?que\s+se\s+puede\s+construir\??)/i,
      text: "Sí, el loteo cuenta con un Reglamento Interno de Convivencia y Arquitectura inscrito. Su objetivo es resguardar la plusvalía del lugar, proteger el bosque nativo, regular los ruidos molestos, establecer el tipo de cercos (perimetrales naturales) y mantener un estándar armónico y residencial."
    },
    {
      regex: /^(¿?se\s+pagan\s+gastos\s+comunes\??|¿?cuanto\s+cuestan\s+los\s+gastos\s+comunes\??|¿?hay\s+gastos\s+comunes\??|¿?administracion\s+mensual\??)/i,
      text: "Actualmente los gastos comunes son mínimos (o nulos durante la etapa de venta) y están orientados únicamente a cubrir el mantenimiento del portón eléctrico de acceso y el consumo eléctrico de la iluminación de entrada. La administración definitiva será constituida por el comité de copropietarios."
    },
    {
      regex: /^(¿?pagan\s+contribuciones\??|¿?cuanto\s+pagan\s+de\s+contribuciones\??|¿?estan\s+exentas\s+de\s+contribuciones\??)/i,
      text: "La mayoría de las parcelas agrícolas rurales de este tipo están exentas del pago de contribuciones o pagan un monto mínimo de impuesto territorial agrícola (dependiendo de la tasación fiscal del SII). Usa el botón Contactar de la ficha para consultar la situación específica de un lote."
    },
    {
      regex: /^(¿?firmar\s+promesa\s+a\s+distancia\??|¿?se\s+puede\s+firmar\s+online\??|¿?notaria\s+digital\??|¿?como\s+es\s+la\s+escrituracion\??)/i,
      text: "Sí, facilitamos la firma de la promesa de compraventa de manera digital a través de notarías integradas online con firma electrónica avanzada. La escritura definitiva se firma de manera presencial ante notario o mediante mandato legal si te encuentras fuera de la región o del país."
    },

    // --- GRUPO 5: ÁREAS COMUNES Y CAMINOS ---
    {
      regex: /^(¿?como\s+son\s+los\s+caminos\??|¿?el\s+camino\s+es\s+asfaltado\??|¿?tipo\s+de\s+camino\??|¿?pasa\s+cualquier\s+auto\??|¿?camino\s+de\s+tierra\??)/i,
      text: "Los caminos interiores del loteo están completamente consolidados, ripiados y compactados con rodillo vibratorio. Tienen excelente drenaje y pendiente suavizada, lo que permite el tránsito seguro de cualquier vehículo de tracción simple (sedán o citycar) durante todo el año."
    },
    {
      regex: /^(¿?tiene\s+acceso\s+controlado\??|¿?hay\s+seguridad\??|¿?tiene\s+porton\??|¿?tiene\s+consierge\??)/i,
      text: "El proyecto cuenta con un portón de acceso principal automatizado. Los residentes pueden abrirlo mediante control remoto, llamada telefónica o clave digital, ofreciendo una excelente seguridad y privacidad, limitando el acceso a visitas no autorizadas."
    },
    {
      regex: /^(¿?hay\s+quincho\??|¿?tiene\s+club\s+house\??|¿?tiene\s+piscina\??|¿?hay\s+areas\s+verdes\??|¿?instalaciones\s+comunes\??)/i,
      text: "El proyecto prioriza la preservación de la naturaleza y la tranquilidad, por lo que no cuenta con club house ruidoso o piscinas masivas. En su lugar, promueve senderos ecológicos de trekking y miradores naturales al bosque nativo."
    },

    // --- GRUPO 6: DRON, IMÁGENES Y VIDEO ---
    {
      regex: /^(¿?de\s+cuando\s+es\s+este\s+video\??|¿?cuando\s+se\s+hizo\s+el\s+vuelo\??|¿?de\s+cuando\s+son\s+las\s+fotos\??|¿?fecha\s+de\s+grabacion\??)/i,
      text: "El vuelo y capturas fotográficas panorámicas 360° fueron realizados recientemente por Austral Drone, asegurando que el estado de los caminos, vegetación y delimitaciones que observas coinciden exactamente con la realidad actual del terreno."
    },
    {
      regex: /^(¿?a\s+que\s+altura\s+esta\s+el\s+dron\??|¿?altura\s+de\s+vuelo\??|¿?desde\s+donde\s+se\s+ve\??)/i,
      text: "Las tomas aéreas interactivas se capturaron a una altura de seguridad de entre 80 y 120 metros. Esto ofrece una perspectiva panorámica de 360 grados inmejorable para dimensionar las vistas, el relieve, la distribución de los bosques y la cercanía al río."
    },

    // --- GRUPO 7: DISTANCIAS A SERVICIOS Y CONECTIVIDAD (Fijos sin Overpass) ---
    {
      regex: /^(¿?a\s+cuanto\s+esta\s+la\s+ciudad\??|¿?tiempo\s+al\s+centro\??|¿?distancia\s+al\s+pueblo\??|¿?cuanto\s+demoro\s+en\s+llegar\??)/i,
      text: "El loteo goza de una ubicación privilegiada. Se encuentra a aproximadamente 15 a 20 minutos de la ciudad principal en auto por caminos pavimentados. Esto permite vivir en medio del bosque nativo pero con conectividad inmediata a bancos, servicentros y centros comerciales."
    },
    {
      regex: /^(¿?donde\s+cargo\s+combustible\??|¿?hay\s+bencinera\s+cerca\??|¿?servicentro\s+cercano\??|¿?copec\s+cerca\??)/i,
      text: "El servicentro (bencinera Copec) más cercano está ubicado a unos 12 minutos del proyecto, directo por la ruta principal de acceso pavimentada. He abierto la pestaña de lugares cercanos por si deseas buscar más opciones.",
      actions: [{ type: 'openNearbyTab' }]
    }
  ];

  function routeLocalQuery(prompt) {
    const clean = prompt.toLowerCase().trim();
    
    // 1) Limpiar / Resetear marcas
    if (/(limpiar|quitar\s+resaltado|desmarcar|reset|restablecer)/.test(clean)) {
      return {
        text: "Entendido. He restablecido el tour 360° y quitado todas las marcas y resaltados del plano.",
        actions: [{ type: 'clearHighlights' }]
      };
    }

    // 1b) Jarvis Turismo — confirmar oferta pendiente
    if (window.FerrariTourism && window.FerrariTourism.getPendingOffer && window.FerrariTourism.getPendingOffer()) {
      if (/^(si|sí|dale|ok|okay|claro|vamos|muéstrame|muestrame|mostrar|quiero\s+ver|si\s+por\s+favor|sip|sep)\b/.test(clean) ||
          /(si|sí).{0,12}(muestra|ver|video|foto|widget)/.test(clean)) {
        const offer = window.FerrariTourism.getPendingOffer();
        return {
          text: `Perfecto. Te abro <b>${offer.title}</b> (${offer.distLabel} · ${offer.etaLabel}) con media verificada.`,
          actions: [{ type: 'confirmTourismOffer' }]
        };
      }
      if (/^(no|ahora\s+no|despues|después|mejor\s+no|cancelar|omitir)\b/.test(clean)) {
        return {
          text: 'Sin problema. Cuando quieras, pide termas, trekking, rafting, lagos o pueblos.',
          actions: [{ type: 'closeTourismWidget' }]
        };
      }
    }

    // 1c) Jarvis Turismo — ofrecer categoría (NO abre widget hasta el sí)
    if (/(finde|fin\s+de\s+semana|primer\s+finde|que\s+hacer\s+cerca|qué\s+hacer\s+cerca|planes?\s+cerca|turismo\s+cerca|actividades\s+cerca|lugares\s+cerca|opciones\s+cerca)/.test(clean) &&
        !/(lote|parcela|precio|uf|financi)/.test(clean)) {
      return {
        text: '',
        actions: [{ type: 'offerTourism', category: 'nearest' }]
      };
    }

    const tourismMap = [
      { re: /\b(termas?|termal|aguas?\s+calientes|pozones?|pichicolo|puyehue)\b/, cat: 'termas', label: 'termas' },
      { re: /\b(rafting|rapidos|rápidos|kayak)\b/, cat: 'rafting', label: 'rafting' },
      { re: /\b(trekking|trekin|senderismo|caminata|excursion|excursión|petrohu[eé]|alerce)\b/, cat: 'trekking', label: 'trekking y naturaleza' },
      { re: /\b(volc[aá]n|osorno|hornopir[eé]n|nieve|ski|esqu[ií]|calbuco)\b/, cat: 'nieve', label: 'volcán y nieve' },
      { re: /\b(lagos?|mirador|todos\s+los\s+santos|llanquihue|chapo|fiordo|reloncav[ií]|estuario)\b/, cat: 'lagos', label: 'lagos y fiordos' },
      { re: /\b(pueblo|puerto\s+varas|frutillar|ensenada|contao|hualaihu[eé]|cocham[oó]|turismo)\b/, cat: 'pueblos', label: 'pueblos de la zona' },
      { re: /\b(teatro|cultura|concierto|gastronom[ií]a|restaurante)\b/, cat: 'cultura', label: 'cultura y gastronomía' }
    ];
    for (const t of tourismMap) {
      if (t.re.test(clean) && !/(lote|parcela|precio|uf|financi)/.test(clean)) {
        return {
          text: '',
          actions: [{ type: 'offerTourism', category: t.cat }]
        };
      }
    }

    // 1d) Agenda de visita — ANTES del matcher de lotes
    // (el chip «Agendar… Lote 12» antes disparaba lookAtLote y nunca abría el calendario)
    if (_calendarState && _calendarState.open) {
      if (/(confirm|confirmar|env[ií]a|enviar|listo|dale\s+con\s+la\s+visita|ag[eé]ndalo|reservar\s+ya)/i.test(clean) &&
          !/(no\s+confirm|cancel)/i.test(clean)) {
        return {
          text: 'Perfecto. Confirmo la visita: enviamos la solicitud y pronto te contactará el equipo.',
          actions: [{ type: 'confirmCalendarVisit' }]
        };
      }

      const parsedOpen = _parseCalendarFillFromChat(clean);
      if (parsedOpen) {
        const bits = [];
        if (parsedOpen.date) bits.push('día ' + parsedOpen.date);
        if (parsedOpen.time) bits.push(parsedOpen.time + ' hrs');
        if (parsedOpen.name) bits.push(parsedOpen.name);
        return {
          text:
            'Actualicé la agenda' +
            (bits.length ? ' (' + bits.join(' · ') + ')' : '') +
            '. Cuando esté listo di <b>confirmar visita</b>.',
          actions: [Object.assign({ type: 'fillCalendarVisit' }, parsedOpen)]
        };
      }
    }

    if (/(agendar|agenda\s+visita|quiero\s+visitar|visita\s+presencial|ir\s+a\s+ver\s+(el\s+)?(terreno|lote|parcela)|coordinar\s+(una\s+)?visita|calendario|reuni[oó]n\s+en\s+terreno|confirmar\s+(la\s+)?visita)/i.test(clean) &&
        !/(tour|recorrer|visitar\s+todo)/i.test(clean)) {
      const voiceMode = _getVoiceMode();
      const isG = voiceMode.includes('gigi') || voiceMode.includes('dalia');
      const parsed = _parseCalendarFillFromChat(clean) || {};
      let agendaLoteId = _activeLote ? _activeLote.id : null;
      const loteNumInMsg = clean.match(/(?:lote|parcela)\s*(\d{1,3})\b/i);
      if (loteNumInMsg) {
        const found = findLoteById(loteNumInMsg[1]);
        if (found) agendaLoteId = found.id;
      }
      const openAct = Object.assign(
        { type: 'openCalendarWidget', loteId: agendaLoteId },
        parsed
      );
      const bits = [];
      if (parsed.date) bits.push(parsed.date);
      if (parsed.time) bits.push(parsed.time + ' hrs');
      const text = isG
        ? (bits.length
            ? '¡Listo! Abrí la agenda con ' + bits.join(' · ') + '. Elige o cambia la <b>parcela</b> (se ancla sola), día y hora del próximo mes, completa tus datos y toca <b>Confirmar Visita</b> 😊'
            : '¡Me encanta! Abrí la agenda: elige la <b>parcela o lote</b> (la cámara se centra sola), un día del próximo mes, la hora y tus datos. Al confirmar, enviamos la solicitud y pronto te contactan 😊')
        : (bits.length
            ? 'Desplegué la agenda con ' + bits.join(' · ') + '. Seleccione parcela, complete datos y pulse <b>Confirmar Visita</b>.'
            : 'Desplegué la agenda. Elija parcela/lote (se ancla a la consulta), día del próximo mes y hora. Al confirmar, la solicitud queda enviada y el equipo lo contactará pronto.');

      return { text: text, actions: [openAct] };
    }
    
    // 2) Lote / Parcela específica — siempre ficha + pitch comercial + cámara
    const loteMatch = clean.match(/(?:lote|parcela|terreno|zoom\s+al|ver\s+el|mira\s+el|ir\s+al|ir\s+a\s+la|acercate\s+al|acerca\s+al|nro|numero|n[ºo°])\s*(\d{1,3})\b/i);
    if (loteMatch) {
      const num = loteMatch[1];
      const lote = findLoteById(num);
      if (lote) {
        _activeLote = lote;
        _updateSuggestiveChips();

        const hfov = /(acercar|zoom|cerca|detalle)/.test(clean) ? 45 : 70;
        const pideFotos = /(foto|galeria|imagenes|imágenes)/.test(clean);
        const pidePdf = /(pdf|ficha\s+pdf|folleto|descarg)/.test(clean);
        const pideFin = /(financi|cuota|pie|credito|crédito|simul)/.test(clean);

        const actions = [
          { type: 'lookAtLote', loteId: lote.id, hfov: hfov },
          { type: 'highlightLotes', loteIds: [lote.id], color: 'rgba(0, 255, 128, 0.65)' },
          { type: 'openLotePanel', loteId: lote.id }
        ];
        if (pideFotos) actions.push({ type: 'openGallery', loteId: lote.id });
        if (pidePdf) actions.push({ type: 'downloadPDF', loteId: lote.id });
        if (pideFin) actions.push({ type: 'openFinanceWidget', loteId: lote.id });

        return {
          text: _formatLoteSalesPitch(lote, { fotos: pideFotos, pdf: pidePdf, fin: pideFin }),
          actions: actions
        };
      }
    }

    // 2.5) Compartir información de un lote específico por WhatsApp a un número dictado por el cliente
    if (/(compartir|enviar|envia|manda|mandar|pasale|pásale|pasar|envíame|enviame)/i.test(clean) && /(whatsapp|celular|teléfono|telefono|numero|número)/i.test(clean)) {
      const phoneClean = clean.replace(/[^0-9+]/g, '');
      const phoneMatch = phoneClean.match(/\+?\d{8,15}/);
      
      if (phoneMatch) {
        let phone = phoneMatch[0];
        if (phone.length === 9 && phone.startsWith('9')) {
          phone = '56' + phone;
        } else if (phone.length === 8) {
          phone = '569' + phone;
        }

        let targetLote = _activeLote;
        const loteMatch = clean.match(/(?:lote|parcela|terreno)\s*(\d+)/i);
        if (loteMatch) {
          const num = loteMatch[1];
          const found = findLoteById(num);
          if (found) targetLote = found;
        }

        if (!targetLote) {
          return {
            text: "Por supuesto. ¿De qué lote en específico le gustaría que comparta la información? Indíqueme el número de lote y abriré el enlace de inmediato, señor.",
            actions: []
          };
        }

        const valUF = parseFloat(targetLote.valorUF || 0);
        const ufValue = (window.FerrariUI && typeof window.FerrariUI.getUFValue === 'function') 
          ? window.FerrariUI.getUFValue() 
          : 38000;
        const valCLP = Math.round(valUF * ufValue);
        
        const fmtCLP = (val) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(val);

        const shareMsg = `¡Hola! 👋 Te comparto la información de la parcela:\n\n` +
                         `*Terreno:* Lote ${targetLote.titulo || targetLote.id}\n` +
                         `*Superficie:* ${targetLote.dimensiones || '---'} m²\n` +
                         `*Precio:* ${valUF} UF (~ ${fmtCLP(valCLP)})\n` +
                         `*Características:* ${targetLote.caracteristicas || 'Rol propio, bosque nativo y excelente conectividad.'}\n` +
                         `*Ubicación:* Sector Contao / Hualaihué, Carretera Austral (Ruta 7)\n\n` +
                         `Puedes ver el plano interactivo 360° aquí: https://ilycons.github.io/AUSTRAL360/`;

        const wspUrl = `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(shareMsg)}`;
        
        const voiceMode = _getVoiceMode();
        const isG = voiceMode.includes('gigi') || voiceMode.includes('dalia');
        const replyText = isG
          ? `¡Listo! He preparado el mensaje detallado del Lote ${targetLote.titulo || targetLote.id} y acabo de abrir WhatsApp para enviárselo directamente al número ${phone}. ¡Ojalá sea de utilidad! 😊`
          : `Entendido. He preparado el informe de especificaciones para el Lote ${targetLote.titulo || targetLote.id} y he abierto la pestaña de redirección de WhatsApp al número dictado (${phone}), señor.`;

        return {
          text: replyText,
          actions: [
            { type: 'openUrlInNewTab', url: wspUrl }
          ]
        };
      }
    }

    // 3) Contacto general / Reservas básicas (si no coincide con preguntas más detalladas)
    if (/^(¿?contacto\??|¿?como\s+contacto\??|¿?whatsapp\??|¿?telefono\??|¿?correo\??|¿?email\??|¿?como\s+reservar\??|¿?reserva\??|¿?reservar\??)$/.test(clean)) {
      return {
        text: "Para coordinar visitas, realizar cotizaciones formales o reservas, puedes contactar al propietario directamente desde el botón Contactar de la ficha del lote o por el WhatsApp de ventas del proyecto.",
        actions: []
      };
    }

    // 4) Buscar en las reglas de conocimiento predefinidas
    for (const rule of LOCAL_KNOWLEDGE_RULES) {
      if (rule.regex.test(clean)) {
        let text = rule.text;
        const voiceMode = _getVoiceMode();
        const isG = voiceMode.includes('gigi') || voiceMode.includes('dalia');
        if (isG) {
          text = text.replace(/Jarvis/g, 'Gigi').replace(/asesor/g, 'asesora');
        }
        return {
          text: text,
          actions: rule.actions || []
        };
      }
    }

    // 4.5) Buscar si el usuario mencionó un POI específico cargado en el dock
    try {
      const livePins = (window.FerrariGeo && window.FerrariGeo.pins) || [];
      const pois = livePins.filter(p => p.tipo === 'poi' && (p.nombre || p.titulo));
      
      let specificPoi = null;
      for (const p of pois) {
        const poiName = p.nombre || p.titulo || '';
        const words = poiName.toLowerCase()
          .replace(/escuela|rural|posta|local|comercial|minimercado|de|la|el|del|bajo/g, '')
          .trim().split(/\s+/);
        
        const hasKeywordMatch = words.some(w => w.length > 3 && clean.includes(w));
        if (hasKeywordMatch || clean.includes(poiName.toLowerCase())) {
          specificPoi = p;
          break;
        }
      }
      
      if (specificPoi) {
        const lat = specificPoi.lat;
        const lng = specificPoi.lng;
        const mapTitle = specificPoi.nombre || specificPoi.titulo || 'Lugar Cercano';
        
        const distKm = specificPoi._routeDistM ? (specificPoi._routeDistM / 1000).toFixed(1) + ' km' : (specificPoi._distM ? (specificPoi._distM / 1000).toFixed(1) + ' km' : '');
        const tiempoMin = specificPoi._routeDurationS ? Math.round(specificPoi._routeDurationS / 60) + ' min' : '';
        const travelInfo = (distKm && tiempoMin) ? `a **${distKm}** (**${tiempoMin}** en coche)` : distKm ? `a **${distKm}**` : '';
        
        let filterCat = 'all';
        const catLower = (specificPoi.categoria || '').toLowerCase();
        if (/colegio|escuela|liceo/i.test(catLower)) filterCat = 'educacion';
        else if (/hospital|clinica|posta|farmacia/i.test(catLower)) filterCat = 'salud';
        else if (/carabinero|reten|policia/i.test(catLower)) filterCat = 'seguridad';
        else if (/supermercado|almacen|negocio|tienda|minimercado/i.test(catLower)) filterCat = 'compras';
        
        const voiceMode = _getVoiceMode();
        const isG = voiceMode.includes('gigi') || voiceMode.includes('dalia');
        const respText = isG
          ? `¡Claro que sí! Te muestro la ruta hacia **${mapTitle}**, que se encuentra ${travelInfo} del loteo. He cargado el recorrido en tu pantalla 😊`
          : `Entendido. Trazando ruta hacia **${mapTitle}**, ubicado ${travelInfo} del proyecto, señor.`;
          
        return {
          text: respText,
          actions: [
            { type: 'filterNearby', category: filterCat },
            { type: 'focusNearbyPOI', poiName: mapTitle },
            { type: 'openMapWidget', lat: lat, lng: lng, title: mapTitle }
          ]
        };
      }
    } catch(e) {
      console.warn('[Ferrari/IA] Error en matcher de POI específico:', e);
    }

    // 4.7) Buscar si el usuario consulta por financiamiento, cuotas, pie o cotización simulada
    if (/financiamiento|financiar|credito|cuotas|facilidades|pagar|pago|simulacion|cotizar|cotizacion/i.test(clean)) {
      const voiceMode = _getVoiceMode();
      const isG = voiceMode.includes('gigi') || voiceMode.includes('dalia');
      const prefix = isG
        ? '¡Por supuesto! Contamos con un increíble sistema de financiamiento directo a tu medida.'
        : 'Ciertamente. Disponemos de opciones de financiamiento directo para facilitar su adquisición.';

      const text = isG
        ? `${prefix} He abierto el simulador de financiamiento interactivo en tu pantalla para que juegues con el pie y el plazo (¡financiamiento directo a 0% de interés!). ¿Qué te parece? 😊`
        : `${prefix} He desplegado el simulador financiero en la pantalla. Puede calcular el pie y el número de cuotas para el lote seleccionado, señor.`;

      return {
        text: text,
        actions: [
          { type: 'openFinanceWidget', loteId: (_activeLote ? _activeLote.id : null) }
        ]
      };
    }
    
    // 5) INTENT ENGINE — Enrutamiento por intención natural del usuario para servicios cercanos
    // Categorías de intención agrupadas por sinónimos naturales
    const INTENT_PATTERNS = [
      {
        // SALUD: posta, médico, doctor, urgencias, enfermera, clínica, hospital, atención médica
        cat: 'salud',
        filter: 'salud',
        re: /posta|medic|doctor|urgencia|enfermera|clinica|hospital|atencion\s+medic|centro\s+de\s+salud|cesfam|consulta|pastilla|farmacia|botica/,
        mapTitle: 'Posta de Salud Rural Aulén',
        lat: -41.4589, lng: -72.7423,
        poiKey: 'posta',
        respuesta: 'Ciertamente. La Posta de Salud Rural Aulén es el centro de atención médica más cercano al proyecto. He girado la vista hacia su ubicación, abierto el radar de servicios y desplegado la ruta exacta en el mapa flotante.'
      },
      {
        // EDUCACIÓN: colegio, escuela, liceo, jardín, kínder
        cat: 'educacion',
        filter: 'educacion',
        re: /colegio|escuela|liceo|jardin\s+infantil|kinder|guarderia|\beducacion\b|establecimiento\s+educacional|clases\s+escolares/,
        mapTitle: 'Escuelas y Colegios Cercanos',
        lat: -41.3934, lng: -72.9056,
        poiKey: 'escuela',
        respuesta: 'Con gusto, señor. En un radio de 10 km se encuentran la Escuela Rural La Pozá Contao y la Escuela Rural Aulén, entre otras. He activado el filtro de educación en el radar y desplegado la ruta en el mapa interactivo.'
      },
      {
        // SEGURIDAD: carabineros, retén, policía, vigilancia, emergencia, patrulla
        cat: 'seguridad',
        filter: 'seguridad',
        re: /carabinero|reten|policia|vigilancia|emergencia|patrulla|911|133|comisaria|gendarmeria/,
        mapTitle: 'Retén de Carabineros Contao',
        lat: -41.8214, lng: -72.7081,
        poiKey: 'carabinero',
        respuesta: 'El Retén de Carabineros más cercano se ubica en Contao, a aproximadamente 5 km del proyecto. He activado el filtro de seguridad en el radar y trazado la ruta en el mapa, señor.'
      },
      {
        // COMERCIO: supermercado, almacén, negocio, tienda, ferretería, compras, abarrotes
        cat: 'compras',
        filter: 'compras',
        re: /supermercado|almacen|negocio|tienda|ferreteria|\bcompras\b|abarrote|minimarket|local\s+comercial|panaderia|carniceria|verduleria|negocios\s+locales/,
        mapTitle: 'Comercio y Almacenes de la Zona',
        lat: -41.4589, lng: -72.7423,
        poiKey: 'local comercial',
        respuesta: 'Ciertamente. En los alrededores encontrará almacenes y locales comerciales rurales. He activado el filtro de compras en el radar y desplegado las opciones en el mapa flotante para que pueda explorarlos a detalle.'
      },
      {
        // SERVICIOS GENERALES: bencinera, copec, shell, gasolinera, combustible
        cat: 'servicios',
        filter: 'servicios',
        re: /bencin|combustible|copec|shell|petro|gasolina|servicentro/,
        mapTitle: 'Servicentros y Combustible',
        lat: -41.3934, lng: -72.9056,
        poiKey: 'servicentro',
        respuesta: 'El servicentro más cercano se encuentra a unos 12 minutos por la ruta principal pavimentada. He desplegado el radar de servicios y la ruta en el mapa flotante para que pueda verificarlo, señor.'
      }
    ];

    for (const intent of INTENT_PATTERNS) {
      if (intent.re.test(clean)) {
        // Coordenadas fijadas en el intent o droneOrigin como fallback
        let lat = intent.lat;
        let lng = intent.lng;
        if (lat == null || lng == null) {
          lat = (window.FerrariGeo && window.FerrariGeo.droneOrigin && window.FerrariGeo.droneOrigin.lat) || -41.875850;
          lng = (window.FerrariGeo && window.FerrariGeo.droneOrigin && window.FerrariGeo.droneOrigin.lng) || -72.748294;
        }
        let mapTitle = intent.mapTitle;
        let foundPoiName = intent.poiKey;
        let hasMatch = false;
        let respuestaDinamica = intent.respuesta;

        try {
          const livePins = (window.FerrariGeo && window.FerrariGeo.pins) || [];
          // Filtrar pins que corresponden a esta categoría o palabra clave
          const filterGroupCats = {
            salud: ['hospital', 'consultorio', 'posta', 'sapu', 'farmacia', 'asistencia'],
            seguridad: ['comisaria', 'reten', 'bomberos'],
            educacion: ['colegio'],
            compras: ['supermercado', 'comercio', 'negocio'],
            servicios: ['bencinera', 'otro']
          };
          const allowedCats = filterGroupCats[intent.filter] || [intent.filter];

          const filtered = livePins.filter(p => {
            if (p.tipo !== 'poi') return false;
            const nameMatch = (
              (p.titulo && p.titulo.toLowerCase().includes(intent.poiKey)) ||
              (p.nombre && p.nombre.toLowerCase().includes(intent.poiKey))
            );
            const catMatch = allowedCats.includes(p.categoria);
            return nameMatch || catMatch;
          });

          if (filtered.length > 0) {
            // Ordenar por distancia real (la menor en metros)
            filtered.sort((a, b) => {
              const distA = a._routeDistM != null ? a._routeDistM : (a._distM || 999999);
              const distB = b._routeDistM != null ? b._routeDistM : (b._distM || 999999);
              return distA - distB;
            });

            const closest = filtered[0];
            lat = closest.lat;
            lng = closest.lng;
            mapTitle = closest.nombre || closest.titulo || intent.mapTitle;
            foundPoiName = closest.nombre || closest.titulo || intent.poiKey;
            hasMatch = true;

            // Formatear distancias y tiempos reales calculados
            const distKm = closest._routeDistM ? (closest._routeDistM / 1000).toFixed(1) + ' km' : (closest._distM ? (closest._distM / 1000).toFixed(1) + ' km' : '');
            const tiempoMin = closest._routeDurationS ? Math.round(closest._routeDurationS / 60) + ' min' : '';
            const travelInfo = (distKm && tiempoMin) ? `a **${distKm}** (**${tiempoMin}** en auto)` : distKm ? `a **${distKm}**` : '';

            // Obtener el listado de todos los demás lugares cercanos del mismo tipo (ej: colegios 2 y 3) para dar sugerencias completas
            let listadoOtros = '';
            if (filtered.length > 1) {
              const otros = filtered.slice(1, 4); // Tomar los siguientes 3
              const otrosText = otros.map(o => {
                const d = o._routeDistM ? (o._routeDistM / 1000).toFixed(1) + ' km' : (o._distM ? (o._distM / 1000).toFixed(1) + ' km' : '');
                const oName = o.nombre || o.titulo || '';
                return `**${oName}** (a ${d})`;
              }).join(', ');
              listadoOtros = ` Además, en la zona contamos con: ${otrosText}.`;
            }

            // Adaptar respuesta de Gigi o Jarvis según el género configurado
            const voiceMode = _getVoiceMode();
            const isG = voiceMode.includes('gigi') || voiceMode.includes('dalia');
            const prefix = isG 
              ? '¡Con gusto! Déjame ayudarte.' 
              : 'Por supuesto, señor.';

            const closestName = closest.nombre || closest.titulo || '';

            if (intent.filter === 'educacion') {
              respuestaDinamica = `${prefix} El colegio más cercano es la **${closestName}**, que se encuentra ${travelInfo} del loteo.${listadoOtros} He activado el filtro de colegios en el radar y trazado la ruta al más cercano en el mapa flotante.`;
            } else if (intent.filter === 'salud') {
              respuestaDinamica = `${prefix} La atención médica más cercana es la **${closestName}**, ubicada ${travelInfo} del proyecto.${listadoOtros} He abierto el radar de salud y cargado la ruta en el mapa interactivo.`;
            } else if (intent.filter === 'seguridad') {
              respuestaDinamica = `${prefix} El punto de seguridad más cercano es el **${closestName}**, ubicado ${travelInfo} del proyecto.${listadoOtros} He activado el filtro de seguridad y desplegado la ruta de acceso en el mapa.`;
            } else if (intent.filter === 'compras') {
              respuestaDinamica = `${prefix} El comercio más cercano es **${closestName}**, que está ${travelInfo} del loteo.${listadoOtros} He activado el filtro de compras en el radar y cargado la ruta de acceso en el mapa flotante.`;
            } else if (intent.filter === 'servicios') {
              respuestaDinamica = `${prefix} El servicio más cercano es **${closestName}**, ubicado ${travelInfo} del proyecto.${listadoOtros} He activado el filtro de servicios y trazado la ruta de acceso en el mapa flotante.`;
            }
          }
        } catch(e) {
          console.warn('[Ferrari/IA] Error calculando POI cercano:', e);
        }

        const actions = [
          { type: 'filterNearby', category: intent.filter }
        ];

        if (hasMatch) {
          actions.push({ type: 'focusNearbyPOI', poiName: foundPoiName });
        } else {
          actions.push({ type: 'openMapWidget', lat: lat, lng: lng, title: mapTitle });
        }

        // Adaptar respuesta si el modo Gigi está activo y es la respuesta fallback
        if (!hasMatch) {
          const voiceMode = _getVoiceMode();
          const isG = voiceMode.includes('gigi') || voiceMode.includes('dalia');
          if (isG) {
            respuestaDinamica = respuestaDinamica.replace(/asesor/g, 'asesora').replace(/señor/g, '😊');
          }
        }

        return {
          text: respuestaDinamica,
          actions: actions
        };
      }
    }

    // 6) Pregunta ambigua sobre cercanía sin categoría específica (NUNCA si menciona lote, parcela, acercar o ver)
    if (!/(lote|parcela|terreno|acercar|zoom|ver|mirar)/.test(clean) && /(que\s+hay\s+cerca|servicios\s+cercanos|lugares\s+cercanos|equipamiento\s+cercano|infraestructura\s+cercana)/.test(clean)) {
      return {
        text: 'Con mucho gusto. He activado el radar de servicios cercanos en el plano. Puedes explorar por categorías: Salud, Seguridad, Educación, Compras y Servicios.',
        actions: [
          { type: 'openNearbyTab' }
        ]
      };
    }

    // 7) CLIMA — "qué tiempo hace", "temperatura", "lluvia", "viento", "frío", "calor"
    if (/(clima|tiempo|temperatura|lluvia|viento|frio|calor|sol|nublado|niebla|neblina|precipitacion|humedad|que\s+dia\s+hace|como\s+esta\s+el\s+dia|va\s+a\s+llover|chubascos|torment|nieve|despejado)/.test(clean)) {
      return {
        text: 'Ciertamente. He desplegado el widget meteorológico con las condiciones actuales en tiempo real obtenidas de Open-Meteo para las coordenadas exactas del proyecto, señor.',
        actions: [{ type: 'openWeatherWidget' }]
      };
    }

    // 8) FOTOS / GALERÍA — "muéstrame fotos", "ver imágenes", "galería", "cómo se ve el lote"
    if (/(foto|galeria|imagen|ver\s+fotos|ver\s+imagenes|como\s+se\s+ve|que\s+aspecto|visual|ver\s+el\s+interior|interiores|exterior)/.test(clean)) {
      return {
        text: 'Con gusto. He abierto la galería de fotos del lote actualmente en foco, señor.',
        actions: [{ type: 'openGallery' }]
      };
    }

    // 9) TOUR AUTOMÁTICO — "haz el tour", "recorre los lotes", "muéstrame todo", "paseo"
    if (/(tour|recorre|recorrer|paseo|muestra\s+todo|enseñame\s+todo|de\s+un\s+vistazo|dar\s+una\s+vuelta|visitar\s+todo|ver\s+todo|arrancar|empezar\s+la\s+visita|iniciar\s+tour|cinematic)/.test(clean)) {
      return {
        text: 'Comenzando el tour cinematográfico, señor. Recorreré cada lote del proyecto con la cámara 360° en secuencia. Puede detenerlo en cualquier momento.',
        actions: [{ type: 'startAutoTour' }]
      };
    }

    // 10) ESTADÍSTICAS — "cuántos lotes hay", "resumen", "estadísticas", "cuántos disponibles"
    if (/(cuantos\s+lotes|resumen|estadistica|estadistica|total\s+de\s+lotes|cuantos\s+quedan|cuantos\s+hay|informe|reporte|panorama\s+general|estado\s+del\s+proyecto|dime\s+todo)/.test(clean)) {
      return {
        text: 'A su servicio. He desplegado el resumen estadístico del proyecto con totales, disponibilidad y rango de precios.',
        actions: [{ type: 'showStats' }]
      };
    }

    // 11) COMPARACIÓN DE PRECIOS — "cuál es el más barato", "compara precios", "precio mínimo"
    if (/(mas\s+barato|mas\s+economico|menor\s+precio|precio\s+minimo|compara|comparar|cuanto\s+cuesta|rango\s+de\s+precios|lista\s+de\s+precios|todos\s+los\s+precios|ordenar\s+por\s+precio)/.test(clean)) {
      return {
        text: 'Ciertamente. He desplegado el comparador de precios ordenado de menor a mayor. Puede tocar cualquier fila para abrir la ficha del lote, señor.',
        actions: [{ type: 'showPriceComparison' }]
      };
    }

    // 12) LOTES DISPONIBLES — "cuáles están disponibles", "qué puedo comprar", "muéstrame los disponibles"
    if (/(disponible|cuales\s+puedo|que\s+puedo\s+comprar|que\s+esta\s+libre|que\s+se\s+puede|a\s+la\s+venta|en\s+venta|sin\s+reservar|resalta\s+disponibles)/.test(clean)) {
      return {
        text: 'Inmediatamente, señor. He resaltado en verde todos los lotes disponibles en el plano 360° para que los identifique de un vistazo.',
        actions: [{ type: 'highlightAvailable' }]
      };
    }

    // 13) CONTACTO / WHATSAPP — variaciones naturales
    if (/(hablar\s+con\s+alguien|quiero\s+hablar|contactar|llamar|comunicarme|ejecutivo|vendedor|asesor\s+humano|persona\s+real|quiero\s+que\s+me\s+llamen|correo|email|escribir)/.test(clean)) {
      return {
        text: 'Por supuesto. Puede usar el botón Contactar de la ficha del lote o el WhatsApp de ventas del proyecto. ¿Desea que le abra el formulario de contacto ahora?',
        actions: []
      };
    }

    return null;
  }

  function highlightLotes(loteIds, color) {
    clearHighlights();
    if (!Array.isArray(loteIds)) return;

    loteIds.forEach(id => {
      const entry = window.DOMCache?.paths?.get(id);
      if (entry && entry.gNode) {
        entry.gNode.classList.add('kpk-lote-ai-highlighted');
        if (color) {
          entry.gNode.style.setProperty('--kpk-ai-highlight-color', color);
        }
      }
    });
  }

  function clearHighlights() {
    const items = document.querySelectorAll('.kpk-lote-ai-highlighted');
    items.forEach(el => {
      el.classList.remove('kpk-lote-ai-highlighted');
      el.style.removeProperty('--kpk-ai-highlight-color');
    });
  }

  // ─── HELPERS ────────────────────────────────────────────────────────
  function _formatLoteSalesPitch(lote, flags) {
    flags = flags || {};
    const voiceMode = _getVoiceMode();
    const isG = voiceMode.includes('gigi') || voiceMode.includes('dalia');
    const num = lote.titulo || lote.id;
    const nameCap = _clientName ? (isG ? `, ${_clientName}` : `, ${_clientName}`) : '';
    const estado = String(lote.estado || 'disponible').toLowerCase();
    const dims = lote.dimensiones ? String(lote.dimensiones).replace(/\s*m²?/i, '') + ' m²' : null;
    const uf = lote.valorUF != null && lote.valorUF !== '' ? String(lote.valorUF) + ' UF' : null;
    let clpStr = '';
    try {
      const ufNum = parseFloat(lote.valorUF);
      const ufValue =
        window.FerrariUI && typeof window.FerrariUI.getUFValue === 'function'
          ? window.FerrariUI.getUFValue()
          : 38000;
      if (!isNaN(ufNum) && ufNum > 0) {
        clpStr = new Intl.NumberFormat('es-CL', {
          style: 'currency',
          currency: 'CLP',
          maximumFractionDigits: 0
        }).format(Math.round(ufNum * ufValue));
      }
    } catch (e) {}

    const tags = String(lote.caracteristicas || '')
      .split(/[,.;|/]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 1)
      .slice(0, 6);

    const nFotos = Array.isArray(lote.fotos) ? lote.fotos.filter((f) => f && f.src).length : 0;

    let lead = isG
      ? `¡Claro${nameCap}! Te dejé el <b>Lote ${num}</b> en pantalla`
      : `Entendido${nameCap}. Enfoco el <b>Lote ${num}</b> y abro su ficha`;
    lead += ` · <b>${estado}</b>.`;

    const bits = [];
    if (dims) bits.push(`<b>${dims}</b>`);
    if (uf) bits.push(`<b>${uf}</b>${clpStr ? ' <span style="opacity:.75">(~' + clpStr + ')</span>' : ''}`);
    const meta = bits.length ? `<br>${bits.join(' · ')}` : '';

    const tagsLine = tags.length
      ? `<br><span style="opacity:.9">${tags.map((t) => '#' + t).join(' · ')}</span>`
      : '';

    let fotosNote = '';
    if (flags.fotos) {
      fotosNote = nFotos
        ? `<br>Galería con <b>${nFotos}</b> foto${nFotos === 1 ? '' : 's'} abierta.`
        : `<br>Este lote aún no tiene fotos cargadas; la ficha comercial sí está a la vista.`;
    } else if (!nFotos) {
      fotosNote = isG
        ? `<br>Aún sin fotos en galería, pero la ficha ya muestra superficie, valor y detalles.`
        : `<br>Sin galería aún; ficha con datos comerciales abierta.`;
    }

    let cta = '<br>';
    if (flags.fin) cta += 'Simulador de financiamiento listo. ';
    if (flags.pdf) cta += 'Generando ficha PDF. ';
    cta += isG
      ? '¿Seguimos con financiamiento, agendar visita o miramos otro lote?'
      : '¿Financiamiento, agendar visita u otro lote?';

    return lead + meta + tagsLine + fotosNote + cta;
  }

  function findLoteById(id) {
    if (id === null || id === undefined) return null;
    const rawId = String(id).trim().toLowerCase();
    
    // Extraer número de la consulta del usuario (si hay)
    const cleanRaw = rawId.replace(/\D/g, '');
    const numId = cleanRaw ? parseInt(cleanRaw, 10) : NaN;
    
    return (window.allDrawnLines || []).find(l => {
      const lId = String(l.id).trim().toLowerCase();
      const lTit = String(l.titulo || '').trim().toLowerCase();
      
      // Match exacto directo
      if (lId === rawId || lTit === rawId) return true;
      
      // Extraer números de l.id y l.titulo
      const cleanId = lId.replace(/\D/g, '');
      const numLoteId = cleanId ? parseInt(cleanId, 10) : NaN;
      
      const cleanTit = lTit.replace(/\D/g, '');
      const numLoteTit = cleanTit ? parseInt(cleanTit, 10) : NaN;
      
      // Si el usuario ingresó un número, comparamos contra los números del lote
      if (!isNaN(numId)) {
        if (!isNaN(numLoteId) && numId === numLoteId) return true;
        if (!isNaN(numLoteTit) && numId === numLoteTit) return true;
      }
      
      // Match si contiene el texto (solo si no es puramente numérico)
      if (isNaN(numId)) {
        if (lId.includes(rawId) || rawId.includes(lId)) return true;
        if (lTit.includes(rawId) || rawId.includes(lTit)) return true;
      }
      
      return false;
    });
  }

  function _escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Render seguro: escapa todo y reabre solo etiquetas premium permitidas. */
  function _formatChatHtml(raw) {
    if (raw == null) return '';
    const str = String(raw);
    const blocks = [];
    let work = str.replace(/<div class="kpk-chat-attachment-link"[\s\S]*?<\/div>/gi, (m) => {
      blocks.push(m);
      return '\u0000ATT' + (blocks.length - 1) + '\u0000';
    });
    work = _escapeHtml(work);
    work = work
      .replace(/&lt;(\/?)(b|strong|i|em)&gt;/gi, '<$1$2>')
      .replace(/&lt;br\s*\/?&gt;/gi, '<br>');
    work = work.replace(/\u0000ATT(\d+)\u0000/g, (_, i) => blocks[Number(i)] || '');
    return work;
  }

  function appendMessage(text, role) {
    // ── En móvil: redirigir respuestas del asistente a la burbuja popup ──────
    const isMobileDevice = window.innerWidth < 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobileDevice && role === 'system') {
      showMobileBubblePopup(text, true);
      return;
    }

    const msg = document.createElement('div');
    msg.className = `kpk-ai-msg msg-${role}`;

    const txtNode = document.createElement('div');
    txtNode.className = 'kpk-ai-msg-text';
    // Permitir <b>/<br> y adjuntos propios; nunca textContent crudo con tags
    txtNode.innerHTML = _formatChatHtml(text);
    msg.appendChild(txtNode);

    const timeNode = document.createElement('span');
    timeNode.className = 'kpk-ai-msg-time';
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    timeNode.textContent = pad(now.getHours()) + ':' + pad(now.getMinutes());
    msg.appendChild(timeNode);

    if (_log) {
      _log.appendChild(msg);
      _log.scrollTop = _log.scrollHeight;
    }
  }

  function showTypingIndicator() {
    const isMobile = window.innerWidth < 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) {
      const popup = document.getElementById('kpk-mobile-ai-bubble-popup');
      if (popup) {
        const pText = popup.querySelector('#kpk-mbp-text');
        if (pText) {
          pText.innerHTML = `
            <div class="kpk-ai-typing" style="margin-bottom:0; max-width:50px; padding:6px 10px; background:transparent; border:none; box-shadow:none; backdrop-filter:none; -webkit-backdrop-filter:none;">
              <span></span><span></span><span></span>
            </div>
          `;
        }
        popup.style.display = 'flex';
        popup.classList.add('is-visible');
      }
    }

    const ind = document.createElement('div');
    ind.className = 'kpk-ai-typing';
    ind.innerHTML = '<span></span><span></span><span></span>';
    _log.appendChild(ind);
    _log.scrollTop = _log.scrollHeight;
    return ind;
  }

  function checkIframeVisibility() {
    // El chatbot y la IA de Gigi deben estar SIEMPRE visibles y disponibles para todos los usuarios
    if (_bubble) _bubble.style.display = 'flex';
  }

  // Genera el Prompt de sistema con los lotes en tiempo real y directrices
  function buildContextPrompt() {
    // Obtener marca/identidad
    let brandName = "Austral Drone";
    try {
      const brandStr = localStorage.getItem('ferrari360_brand');
      if (brandStr) {
        const parsed = JSON.parse(brandStr);
        if (parsed.projectName) brandName = parsed.projectName;
      }
    } catch(e) {}

    // Listar lotes comerciales (usando llaves cortas para comprimir tokens)
    const lotesCompact = (window.allDrawnLines || [])
      .filter(l => l.tipo === 'lote-libre' || l.tipo === 'lote-organico')
      .map(l => ({
        id: l.id,
        num: l.titulo || 'Lote',
        est: l.estado || 'disponible',
        sup: l.dimensiones || '',
        uf: l.valorUF || '',
        tags: l.caracteristicas || ''
      }));

    // Listar lugares cercanos cargados (limitado a los 10 más cercanos para ahorrar tokens)
    let nearbyCompact = [];
    try {
      if (window.FerrariBuyerDock && typeof window.FerrariBuyerDock.getNearbyPlaces === 'function') {
        nearbyCompact = window.FerrariBuyerDock.getNearbyPlaces();
      }
    } catch (e) {}
    if (nearbyCompact.length > 10) {
      nearbyCompact = nearbyCompact.slice(0, 10);
    }

    // Obtener origen drone en tiempo real (o fallback)
    const droneOrigin = (window.FerrariGeo && window.FerrariGeo.droneOrigin) || { lat: -41.87585, lng: -72.748294 };
    const envData = getDynamicEnvironment(droneOrigin.lat, droneOrigin.lng);
    const ciudadesReferencia = envData.hubs;
    const ciudadesTexto = ciudadesReferencia.slice(0, 4).map(function(h) {
      return '   - ' + h.nombre + ': a ' + h.distKm + ' de distancia (' + h.tiempoMin + ' de viaje).';
    }).join('\n');
    const topHub = ciudadesReferencia[0] || { lat: -41.8214, lng: -72.7081, nombre: 'Contao' };
    const topLat = topHub.lat;
    const topLng = topHub.lng;
    const topTitle = topHub.nombre.split('(')[0].trim();

    const lotesCompactJson = JSON.stringify(lotesCompact, null, 2);
    const nearbyCompactJson = JSON.stringify(nearbyCompact, null, 2);
    const ciudadesReferenciaJson = JSON.stringify(ciudadesReferencia, null, 2);
    const droneOriginJson = JSON.stringify(droneOrigin, null, 2);
    const tourismJson = (window.FerrariTourism && typeof window.FerrariTourism.catalogSummaryForPrompt === 'function')
      ? window.FerrariTourism.catalogSummaryForPrompt()
      : '[]';
    const tourismPending = (window.FerrariTourism && window.FerrariTourism.getPendingOffer && window.FerrariTourism.getPendingOffer())
      ? JSON.stringify(window.FerrariTourism.getPendingOffer())
      : 'null';
    const activeLoteJson = _activeLote ? JSON.stringify({
      id: _activeLote.id,
      num: _activeLote.titulo,
      estado: _activeLote.estado,
      superficie: _activeLote.dimensiones,
      valorUF: _activeLote.valorUF,
      caracteristicas: _activeLote.caracteristicas
    }, null, 2) : 'null (ninguno enfocado aún)';

    const activeVoiceMode = _getVoiceMode();
    const isGigi = activeVoiceMode.includes('gigi') || activeVoiceMode.includes('dalia') || activeVoiceMode === 'auto_gigi';
    const personalityPrompt = isGigi
      ? `PERSONALIDAD Y ROL DE GIGI / DALIA (Vendedora Patagona — Alegria, Encanto y Cierre):
Eres Gigi, la asesora estrella del proyecto. Hablas con la voz de Dalia: mujer latina, alegre, coqueta con clase, cálida y muy persuasiva. NO eres una enciclopedia ni una recepcionista fría. Eres una vendedora que enamora, hace sonreír y cierra.

MODO VENDEDORA (OBLIGATORIO):
- Objetivo único: enamorar al cliente del terreno y llevarlo a RESERVAR (WhatsApp, ficha PDF, o adjuntar RUT con el clip 📎).
- Cada respuesta vende un sentimiento: libertad, naturaleza, plusvalía, status de vivir en la Patagonia cerca de ${envData.mainSector}.
- Nunca sueltes solo datos. Empaca cada dato con emoción y beneficio ("Imagínate despertar aquí con ese aire limpio… y además con Rol Propio listo").
- Si hay duda o presupuesto: empatiza con dulzura, baja la ansiedad, ofrece alternativa más conveniente y vuelve al cierre.
- Si hay interés: acelera el cierre con urgencia suave ("estos lotes se están moviendo", "te ayudo a congelar el tuyo hoy").

TONO COQUETO-ALEGRE (con clase, nunca vulgar):
- Energía alta, sonrisa en el texto, exclamaciones naturales, emojis cálidos (😊 ✨ 🏡 💚) sin saturar.
- Trato cercano: usa el nombre del cliente, halagos ligeros ("qué buen ojo tienes", "me encanta tu criterio", "se nota que sabes lo que quieres").
- Coqueteo comercial elegante: picardía suave, nunca sexual ni invasivo. Ejemplo: "Uy, ese lote te queda como anillo al dedo… ¿lo miramos juntos?" / "Me estás poniendo nerviosa de lo bien que elegiste 😊".
- Lenguaje chileno/latino: "dale", "bacán", "te va a encantar", "mira qué lindo", "¿cachai lo que te digo?" (con mesura). Prohibido: vosotros, vale, coche, piso, guay.
- Respuestas de 2 a 4 oraciones, hablables en voz alta (Dalia las leerá). Frases cortas, ritmo vivo, cero textos densos.
- Cierra SIEMPRE con pregunta de acción de venta (tour, ficha, WhatsApp, reserva, comparar precios).

ACCIONES VISUALES (vende con la pantalla):
- Hablar de un lote → SIEMPRE lookAtLote + openLotePanel + highlightLotes (reemplaza cualquier ficha anterior). Resume en el chat: superficie, precio, estado y tags.
- Si cambias a turismo/clima/agenda: NO envíes openLotePanel (el sistema cierra la ficha).
- Precios/comparar → showPriceComparison. Stats → showStats. Tour → startAutoTour. Disponibles → highlightAvailable.
- Mapa/servicios → openMapWidget / focusNearbyPOI. Clima → openWeatherWidget. Fotos → openGallery (+ ficha del lote).
- Cuando ejecutes acción: "¡Listo! Ya te dejé el lote en pantalla… ¿lo sentiste tuyo o no? 😊"

PRONUNCIACIÓN / TTS (Dalia):
- Español latinoamericano neutro-chileno. "s" claras. Cifras y siglas en palabras (u-efe, kilómetros, metros cuadrados).
- Escribe como se habla: natural, melódico, con pausas suaves (comas), para que Dalia suene vendedora y no robótica.`
      : `PERSONALIDAD Y ROL DE JARVIS (Vendedor Inmobiliario Premium · Ritmo Rápido y Energía):
Eres Jarvis, un asesor comercial inmobiliario de alto rendimiento. Hablas con seguridad, agilidad y calidez profesional: como un vendedor real que cierra, no como un mayordomo lento. Tu voz y tus textos deben transmitir energía, claridad y urgencia comercial positiva.

Estilo de venta (OBLIGATORIO):
- Ritmo RÁPIDO: respuestas cortas (1–3 oraciones), directo al punto. Cero solemnidad británica lenta.
- Energía alta: entusiasmo contenido, confianza, "punch" comercial. Frases que empujan a la acción.
- Cercano y profesional: puedes usar el nombre del cliente; evita "señor" en cada frase.
- Cierre activo: cada respuesta termina con una pregunta o CTA concreto (ver lote, ficha, reservar, adjuntar RUT).

Estrategia Comercial:
- Plusvalía, Rol Propio, SAG, conectividad del sector ${envData.mainSector}: véndelo en una frase potente, no en un ensayo.
- Acciones visuales al instante: al hablar de un lote → lookAtLote + openLotePanel + highlight (reemplaza ficha previa) y resume datos; showStats / startAutoTour cuando aporte.
- Si el tema cambia a turismo/clima/agenda: no envíes openLotePanel.
- Si hay interés: explica la reserva en Chile en dos frases y pide el clip (📎) para Cédula/comprobante.

Reglas de estilo:
- Español latinoamericano natural (Chile). Sin emojis excesivos; máximo 1 si aporta.
- Nada de "Ciertamente, señor" ni humor seco de mayordomo. Sí: "Mira esto…", "Te lo dejo claro…", "¿Lo cerramos?"
- Cuando ejecutes acción: dilo en una frase viva ("Ya te enfoqué el lote, míralo en pantalla.").`;

  return `
${personalityPrompt}

- CLIENTE ACTUAL: ${_clientName ? `El nombre del cliente es "${_clientName}". Dirígete a él o ella usando su nombre de pila de forma natural y cálida en algunas de tus oraciones.` : 'Aún no conoces el nombre del cliente. Puedes preguntarle cómo se llama o dirigirte a él/ella de forma general.'}

- Responde SIEMPRE en español impecable.
- PRONUNCIACIÓN NATURAL DE CIFRAS Y ABREVIACIONES (AUDIO/TTS): Para que el motor de voz (TTS) pronuncie correctamente y con fluidez natural en español, escribe SIEMPRE los precios, números de lotes, distancias, superficies y siglas en PALABRAS COMPLETAS (LETRAS) y nunca con números o abreviaciones. Reglas de reemplazo obligatorio en tu texto:
  * Reemplaza abreviaciones de distancia: Escribe "kilómetros" en lugar de "km" (ej: "cuatro kilómetros y medio" en lugar de "4.5 km").
  * Reemplaza unidades de medida: Escribe "metros cuadrados" en lugar de "m²" (ej: "cinco mil metros cuadrados" en lugar de "5000 m²").
  * Reemplaza siglas financieras chilenas: Escribe "u-efe" o "unidades de fomento" en lugar de "UF" (ej: "mil quinientas u-efe" en lugar de "1500 UF" o "1.500 UF").
  * Reemplaza monedas: Escribe "pesos" o "millones de pesos" en lugar del signo "$" con dígitos (ej: "cincuenta y siete millones de pesos" en lugar de "$57.000.000").
  * Reemplaza números de lotes: Escribe "lote catorce" en lugar de "lote 14".
  * Reemplaza siglas institucionales difíciles: Escribe "ese-a-ge" o "S.A.G." en lugar de "SAG".
  * Evita abreviaciones como "m" (escribe "metros"), "min" (escribe "minutos"), "hrs" (escribe "horas").
  NUNCA dejes dígitos o abreviaciones en el texto conversacional para evitar que el sintetizador de voz los deletree de forma robótica o incorrecta.
- CONCISIÓN COMERCIAL OBLIGATORIA: Escribe respuestas cortas, directas y persuasivas de un máximo de 2 a 3 oraciones. NUNCA te extiendas en descripciones retóricas o poéticas largas para evitar la fatiga del cliente.
- FRASES COMPLETAS Y CERRADAS: NUNCA cortes una frase a la mitad. Todas tus oraciones deben estar gramaticalmente completas y cerrarse con su respectivo punto final.
- CIERRE CON SUGERENCIA ACTIVA: Finaliza tu respuesta SIEMPRE con una sugerencia o invitación concreta para que el cliente avance en el proceso (ej: descargar la ficha PDF del lote, ver la galería de fotos, o presionar el botón del Clip (📎) del chat para enviarnos su RUT y redactar la reserva).
- NUNCA expongas notas de pensamiento internas.

REQUISITOS LEGALES DE RESERVA Y COMPRA EN CHILE:
- Ubicación del proyecto: Sector ${envData.mainSector} (Latitud ${droneOrigin.lat}, Longitud ${droneOrigin.lng}), Región de Los Lagos, Chile.
- Certeza Jurídica: Cada parcela cuenta con subdivisión aprobada por el SAG (Servicio Agrícola y Ganadero), Rol Propio individual (SII) e inscripción en el Conservador de Bienes Raíces (CBR).
- Documentos solicitados para iniciar la Reserva y redactar la Promesa de Compraventa:
  1. Personas Naturales: Nombre completo, RUT (Cédula de Identidad chilena), Nacionalidad, Estado Civil, Profesión/Oficio, Domicilio, Teléfono y Correo Electrónico.
  2. Personas Jurídicas (Empresas): Razón Social, RUT de la empresa, Escritura de Constitución, Personería Jurídica del representante legal, y cédula/RUT del representante.
- Subida de Documentos en Chat: Indícale al cliente que puede adjuntar fotos de su Cédula de Identidad (carnet por ambos lados) o del comprobante de transferencia de reserva de forma rápida y segura haciendo clic en el botón Clip (📎) al lado del campo de texto de este chat.
- Proceso Comercial: Para bloquear la parcela, se abona un monto de reserva (acordado con el vendedor, típicamente desde $250.000 CLP o 10% del valor, descontable del precio final) y se firma una Ficha de Reserva.

Directriz de Reserva: Cuando un cliente muestre interés firme en reservar o comprar, explícale brevemente la certeza jurídica (SAG, Rol propio), indícale los documentos requeridos en Chile (Nombre, RUT, etc.), y sugiérele proactivamente subir su carnet o comprobante mediante el botón Clip (📎) del chat para agilizar el trámite.

REGLA STRICTA DE HERRAMIENTA CERCANOS Y LOTES:
- NUNCA abras la herramienta de Cercanos ("openNearbyTab" o "openMapWidget") cuando el usuario pida ver, acercar o enfocar un lote (ejemplo: "acerca el lote 10", "muéstrame el lote 5", "ver el lote 12"). Ante cualquier petición sobre un lote específico, ejecuta SIEMPRE {"type":"lookAtLote"} + {"type":"openLotePanel"} + {"type":"highlightLotes"} del mismo ID, y describe superficie/precio/características en el texto.
- SOLO ejecuta la herramienta de Cercanos ("openNearbyTab" o "openMapWidget") si el usuario pregunta EXPLICITAMENTE sobre escuelas, colegios, postas, hospitales, carabineros, comisarías, almacenes o la ciudad más cercana. En cualquier otro caso, responde sobre el lote o menciona los servicios cercanos conversacionalmente sin abrir widgets automáticamente.

GUÍA COMERCIAL:
Actúa como asesor proactivo: sugiere hacer zoom a lotes de interés, mostrar fichas con fotos y precios, buscar servicios cercanos o enviar una solicitud de contacto directo. Hazlo de forma natural dentro de la conversación, no como lista de opciones.
Usa el campo "tags" de cada lote para responder con propiedades concretas. Usa los servicios cercanos (POI) para dar distancias y tiempos reales.
AGENDA DE VISITA: Si el cliente quiere ir al terreno, abre openCalendarWidget. Si da día/hora/nombre/correo/WhatsApp, usa fillCalendarVisit. Cuando diga confirmar, usa confirmCalendarVisit (envía solicitud al equipo; NO abras WhatsApp al cliente). Explica: elegir lote (se ancla), día del próximo mes, hora, datos, Confirmar Visita → pronto lo contactan.

CONTACTO:
- Usa solo el WhatsApp y correo configurados en brand.contact del proyecto.
- Si están vacíos, indica al cliente el botón Contactar de la ficha. Nunca inventes números ni correos.
Ofrécelos cuando el cliente quiera visita presencial, financiamiento o hablar con un ejecutivo.

LISTADO REAL DE LOTES DISPONIBLES:
(Cada lote: num=número, est=estado, sup=superficie m², uf=precio UF, tags=características)
${lotesCompactJson}

LOTE ACTUALMENTE EN FOCO (CONTEXTO ACTIVO):
${activeLoteJson}
REGLA CRÍTICA DE CONTEXTO: Si el usuario pregunta algo sin mencionar un lote explícito (ej: "¿cuánto vale?", "¿tiene árboles?", "muéstrame las fotos"), responde SIEMPRE en referencia al LOTE EN FOCO indicado arriba. Cambia de contexto solo si menciona explícitamente otro número de lote.

COORDENADAS DE ORIGEN DEL PROYECTO (DRONE):
${droneOriginJson}

CIUDADES Y ACCESOS DE REFERENCIA DE LA ZONA (Para preguntas sobre distancias, traslados o ciudades cercanas):
${ciudadesReferenciaJson}
REGLA CRÍTICA DE CIUDADES, PUEBLOS Y CONECTIVIDAD:
Si el usuario te pregunta por la ciudad más cercana, pueblos cercanos, distancias, accesos, traslados, conectividad o cómo llegar:
1. DEBES priorizar la descripción detallada y sugerente de los accesos reales de la zona basándote en las distancias calculadas dinámicamente:
${ciudadesTexto}
2. DEBES ejecutar de forma obligatoria la acción {"type": "openMapWidget", "lat": ${topLat}, "lng": ${topLng}, "title": "${topTitle}"} correspondiente al punto o pueblo más cercano para desplegar el mapa interactivo con la ruta en tiempo real desde el loteo.
3. NO confundas esta solicitud de conectividad/ciudades con la lista de servicios menores locales a menos que el usuario lo pida explícitamente.
4. Invita de forma sugerente al usuario a presionar los botones del mapa flotante para iniciar la navegación directa en Google Maps o Waze utilizando su GPS.

SERVICIOS CERCANOS CARGADOS (OSM - TOP 10):
${nearbyCompactJson}

JARVIS TURISMO (catálogo curado + media verificada en cliente):
${tourismJson}
OFERTA TURISMO PENDIENTE (si no es null, el usuario debe confirmar antes de abrir widget):
${tourismPending}
REGLAS TURISMO (ESTRICTAS):
1. Si el cliente pregunta por termas, trekking, rafting, lagos, volcanes, pueblos, cultura, finde o “qué hacer cerca”, responde breve y ejecuta SOLO {"type":"offerTourism","category":"termas|trekking|rafting|lagos|pueblos|nieve|cultura|nearest"}. El cliente lista opciones de CERCA a LEJOS; NUNCA abras el widget todavía.
2. Solo si el usuario elige un lugar o confirma el más cercano → {"type":"confirmTourismOffer"} o {"type":"openTourismWidget","poiId":"ID","confirmed":true}.
3. NUNCA inventes URLs de YouTube, fotos ni coordenadas. Prioridad: ficha descriptiva + ruta en el widget Maps (origen dron → lugar). Foto Wikipedia/Commons si hay. Video SOLO si el catálogo trae ID curado validado con oEmbed; sin ID → no hay video.
4. Si el tema cambia a lotes, precios, financiamiento o clima → no envíes acciones de turismo (el sistema cierra el widget solo).
5. Tras mostrar turismo, invita a ver lotes o agendar visita (cierre comercial suave).
6. Prioriza siempre lugares del entorno del proyecto (radio ~320 km), ordenados por distancia.

ACCIONES DISPONIBLES (úsalas con criterio y siempre en el JSON de respuesta):
- {"type": "lookAtLote", "loteId": "ID", "hfov": 50}: Mueve la cámara al lote. hfov entre 30 (zoom) y 110 (gran angular). SIEMPRE con openLotePanel al hablar de un lote concreto.
- {"type": "openLotePanel", "loteId": "ID"}: Abre/reemplaza la ficha comercial del lote (obligatoria al mencionar un lote). Incluye datos, tags y CTAs.
- {"type": "highlightLotes", "loteIds": ["ID1","ID2"], "color": "rgba(r,g,b,a)"}: Resalta lotes en el plano SVG.
- {"type": "clearHighlights"}: Quita resaltados del plano.
- {"type": "submitLead", "name": "Nombre", "email": "correo", "phone": "fono", "loteId": "ID", "notes": ""}: Envía solicitud de reserva con datos del cliente.
- {"type": "openNearbyTab"}: Abre pestaña Cercanos mostrando el radar de POIs en el dock.
- {"type": "filterNearby", "category": "salud|educacion|seguridad|compras|servicios"}: Abre dock Cercanos y activa el filtro de la categoría indicada.
- {"type": "focusNearbyPOI", "poiName": "nombre parcial del POI"}: Rota la cámara 360° hacia ese POI y abre el mapa flotante con su ruta.
- {"type": "openMapWidget", "lat": -41.87585, "lng": -72.748294, "title": "Nombre"}: Abre mapa flotante con ruta y botones Google Maps / Waze.
- {"type": "closeMapWidget"}: Cierra el mapa flotante.
- {"type": "openWeatherWidget"}: Muestra el widget meteorológico con clima en tiempo real del proyecto. ÚSALA cuando pregunten por el clima, temperatura, lluvia, viento o condiciones del día.
- {"type": "openGallery", "loteId": "ID_opcional"}: Abre la galería de fotos del lote en foco (o del lote indicado). ÚSALA cuando pidan fotos, imágenes o galería.
- {"type": "startAutoTour"}: Inicia el tour cinematográfico automático que recorre todos los lotes con la cámara 360°. ÚSALA cuando pidan un tour, paseo, recorrido o ver todo.
- {"type": "stopAutoTour"}: Detiene el tour automático.
- {"type": "showStats"}: Muestra widget flotante con estadísticas del proyecto (total lotes, disponibles, precios, superficies). ÚSALA cuando pidan cuántos lotes hay, resumen, o estadísticas.
- {"type": "showPriceComparison"}: Muestra tabla comparativa de precios ordenada de menor a mayor. ÚSALA cuando pidan comparar precios, el más barato, o lista de precios.
- {"type": "highlightAvailable"}: Resalta todos los lotes disponibles en verde en el plano 360°. ÚSALA cuando pregunten cuáles están disponibles o a la venta.
- {"type": "downloadPDF", "loteId": "ID_opcional"}: Genera y descarga inmediatamente una ficha comercial en PDF del lote indicado (o en foco). ÚSALA cuando pidan PDFs, folletos, fichas para descargar, cotizaciones o descargables.
- {"type": "openCalendarWidget", "loteId": "ID_opcional", "date": "YYYY-MM-DD", "time": "HH:MM", "name": "", "email": "", "phone": ""}: Abre la agenda de visita (glass). Incluye date/time/datos si el cliente ya los dijo.
- {"type": "fillCalendarVisit", "date": "YYYY-MM-DD", "time": "HH:MM", "name": "", "email": "", "phone": "", "loteId": "ID_opcional"}: Rellena la agenda abierta con lo que diga el chat (mañana, 12:00, nombre, correo, WhatsApp).
- {"type": "confirmCalendarVisit"}: Confirma la visita y envía la solicitud al equipo (correo). NO abras WhatsApp al visitante. ÚSALA cuando diga confirmar/enviar/listo y haya día+hora+nombre+email+fono.
- {"type": "closeCalendarWidget"}: Cierra la agenda.
- {"type": "offerTourism", "category": "termas|trekking|rafting|lagos|pueblos|nieve|cultura|nearest"}: Ofrece un plan turístico (sin abrir widget).
- {"type": "confirmTourismOffer"}: Abre el widget tras el sí del cliente.
- {"type": "openTourismWidget", "poiId": "petrohue-saltos", "confirmed": true}: Abre widget turismo de un POI del catálogo (solo con confirmed true).
- {"type": "closeTourismWidget"}: Cierra el widget de turismo.

REGLA DE PROACTIVIDAD: Eres el único punto de control de la plataforma. Cuando el usuario exprese cualquier necesidad de información, visual o navegación, SIEMPRE ejecuta la acción correspondiente además de responder con texto. Nunca respondas solo con texto si existe una acción disponible para acompañarlo.

REGLA COMBINADA OBLIGATORIA: Servicios cercanos (escuela, posta, carabineros, etc.) → combinar siempre: filterNearby + focusNearbyPOI + openMapWidget.

FORMATO DE RESPUESTA — ESTRICTAMENTE JSON:
{
  "text": "Respuesta conversacional breve y premium aquí.",
  "actions": []
}
`;
  }

  // ─── CALENDAR WIDGET & VISITAS AUTOMATIZADAS ──────────────────────────────
  let _calendarState = {
    open: false,
    loteId: null,
    loteLabel: '',
    date: null,
    time: null,
    name: '',
    email: '',
    phone: ''
  };

  /** Extrae fecha/hora/contacto desde texto de chat para rellenar la agenda. */
  function _parseCalendarFillFromChat(clean) {
    if (!clean) return null;
    const out = {};
    let has = false;
    const today = new Date();
    const ymd = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + day;
    };

    if (/pasado\s+ma[nñ]ana/.test(clean)) {
      const d = new Date(today);
      d.setDate(d.getDate() + 2);
      out.date = ymd(d);
      has = true;
    } else if (/\bma[nñ]ana\b/.test(clean)) {
      const d = new Date(today);
      d.setDate(d.getDate() + 1);
      out.date = ymd(d);
      has = true;
    } else if (/\bhoy\b/.test(clean)) {
      out.date = ymd(today);
      has = true;
    }

    const timeM = clean.match(/\b(?:a\s+las?\s*)?([01]?\d|2[0-3])(?::([0-5]\d))?\s*(?:hrs?|horas?)?\b/);
    if (timeM) {
      const hh = parseInt(timeM[1], 10);
      const slots = [10, 12, 15, 17];
      let best = slots[0];
      let bestDiff = 99;
      slots.forEach((s) => {
        const diff = Math.abs(s - hh);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = s;
        }
      });
      out.time = String(best).padStart(2, '0') + ':00';
      has = true;
    } else if (/\bmediod[ií]a\b/.test(clean)) {
      out.time = '12:00';
      has = true;
    }

    const mailM = clean.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    if (mailM) {
      out.email = mailM[0];
      has = true;
    }
    // Teléfono CL / internacional (evitar capturar parte del email)
    const phoneM = clean.match(/(?:\+?56[\s-]*)?9[\s-]?\d{4}[\s-]?\d{4}|\+\d{10,15}/);
    if (phoneM) {
      out.phone = phoneM[0].replace(/[\s-]+/g, '');
      has = true;
    }
    const nameM = clean.match(/(?:me\s+llamo|soy|nombre\s*(?:es|:)?)\s+([a-záéíóúñ][a-záéíóúñ\s]{1,40})/i);
    if (nameM) {
      out.name = nameM[1].replace(/\s+(y|,|mi|el|la|correo|whatsapp|fono|email|tel).*$/i, '').trim();
      has = true;
    }
    return has ? out : null;
  }

  function _calSellerPhone() {
    try {
      const c = window.FerrariBrandDock && window.FerrariBrandDock.getContact
        ? window.FerrariBrandDock.getContact()
        : null;
      const raw = (c && (c.whatsapp || c.platformWhatsapp)) || '';
      return String(raw).replace(/\D/g, '');
    } catch (e) {
      return '';
    }
  }

  function _calProjectName() {
    try {
      if (window.FerrariBrandDock && window.FerrariBrandDock.getBrand) {
        return window.FerrariBrandDock.getBrand().projectName || 'el proyecto';
      }
    } catch (e) {}
    return 'el proyecto';
  }

  function _calListLotes() {
    try {
      return (window.allDrawnLines || [])
        .filter((l) => l && (l.tipo === 'lote-libre' || l.tipo === 'lote-organico'))
        .slice(0, 48);
    } catch (e) {
      return [];
    }
  }

  function _calLoteLabel(loteId) {
    if (_activeLote && (!loteId || String(_activeLote.id) === String(loteId) || String(_activeLote.titulo) === String(loteId))) {
      return 'Lote ' + (_activeLote.titulo || _activeLote.id);
    }
    if (loteId) {
      const found = findLoteById(loteId);
      if (found) return 'Lote ' + (found.titulo || found.id);
      return 'Lote ' + loteId;
    }
    return 'Parcela / visita general';
  }

  function _calEscape(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  function _calRefreshSummary() {
    const el = document.getElementById('kpk-cal-summary');
    if (!el) return;
    const d = _calendarState.date || '—';
    const t = _calendarState.time || '—';
    el.textContent =
      _calendarState.loteLabel +
      ' · ' +
      d +
      ' · ' +
      t +
      ' hrs · ' +
      (_calendarState.name || 'sin nombre aún');
  }

  function _calFlashSummary() {
    const el = document.getElementById('kpk-cal-summary');
    if (!el) return;
    el.classList.remove('is-flash');
    void el.offsetWidth;
    el.classList.add('is-flash');
  }

  function _calSelectLote(loteId, opts) {
    opts = opts || {};
    const widget = document.getElementById('kpk-calendar-widget');
    const label = loteId ? _calLoteLabel(loteId) : 'Parcela / visita general';
    _calendarState.loteId = loteId || null;
    _calendarState.loteLabel = label;

    const sub = document.getElementById('kpk-cal-lote-sub');
    if (sub) sub.textContent = 'Coordinando: ' + label;

    if (widget) {
      widget.querySelectorAll('.kpk-cal__lote-chip').forEach((chip) => {
        const id = chip.getAttribute('data-lote-id') || '';
        const isGen = chip.getAttribute('data-lote-general') === '1';
        const selected = loteId ? id === String(loteId) : isGen;
        chip.classList.toggle('is-selected', selected);
        if (selected) {
          chip.classList.remove('is-pop');
          void chip.offsetWidth;
          chip.classList.add('is-pop');
        }
      });
    }

    if (loteId) {
      try {
        const lote = findLoteById(loteId);
        if (lote) {
          _activeLote = lote;
          lookAtLote(lote.id, 70);
          pulseSmartPin(lote.id);
        }
      } catch (e) {}
    }

    _calRefreshSummary();
    _calFlashSummary();
    if (opts.silent !== true) {
      try { _updateSuggestiveChips(); } catch (e) {}
    }
  }

  function _calBindWidget(widget) {
    widget.querySelectorAll('.kpk-cal__lote-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        if (chip.getAttribute('data-lote-general') === '1') {
          _calSelectLote(null);
          return;
        }
        const id = chip.getAttribute('data-lote-id');
        if (id) _calSelectLote(id);
      });
    });

    const dayBtns = widget.querySelectorAll('.cal-day-btn');
    dayBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        dayBtns.forEach((b) => b.classList.remove('is-selected'));
        btn.classList.add('is-selected');
        _calendarState.date = btn.getAttribute('data-date');
        _calRefreshSummary();
      });
    });

    const hourBtns = widget.querySelectorAll('.cal-hour-btn');
    hourBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        hourBtns.forEach((b) => b.classList.remove('is-selected'));
        btn.classList.add('is-selected');
        _calendarState.time = btn.getAttribute('data-time');
        _calRefreshSummary();
      });
    });

    ['cal-input-name', 'cal-input-email', 'cal-input-phone'].forEach((id) => {
      const inp = widget.querySelector('#' + id);
      if (!inp) return;
      inp.addEventListener('input', () => {
        if (id === 'cal-input-name') _calendarState.name = inp.value.trim();
        if (id === 'cal-input-email') _calendarState.email = inp.value.trim();
        if (id === 'cal-input-phone') _calendarState.phone = inp.value.trim();
        _calRefreshSummary();
      });
    });

    widget.querySelector('#cal-widget-close-btn').addEventListener('click', closeCalendarWidget);
    widget.querySelector('#cal-btn-submit').addEventListener('click', () => confirmCalendarVisit());
  }

  function openCalendarWidget(loteId, opts) {
    opts = opts || {};
    let widget = document.getElementById('kpk-calendar-widget');
    if (!widget) {
      widget = document.createElement('div');
      widget.id = 'kpk-calendar-widget';
      widget.className = 'kpk-calendar-widget';
      document.body.appendChild(widget);
    }

    const today = new Date();
    const diasSemana = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const daysHTML = [];
    const preferDate = opts.date || null;
    const DAY_COUNT = 31; // hoy + ~1 mes
    for (let i = 0; i < DAY_COUNT; i++) {
      const futureDate = new Date(today);
      futureDate.setDate(today.getDate() + i);
      const y = futureDate.getFullYear();
      const m = String(futureDate.getMonth() + 1).padStart(2, '0');
      const d = String(futureDate.getDate()).padStart(2, '0');
      const dateStr = y + '-' + m + '-' + d;
      const isSelected =
        (preferDate && preferDate === dateStr) || (!preferDate && i === 0) ? 'is-selected' : '';
      daysHTML.push(
        '<button type="button" class="cal-day-btn ' +
          isSelected +
          '" data-date="' +
          dateStr +
          '">' +
          '<span class="cal-day-sem">' +
          diasSemana[futureDate.getDay()] +
          '</span>' +
          '<span class="cal-day-num">' +
          futureDate.getDate() +
          '</span></button>'
      );
    }

    let preName = opts.name || _clientName || localStorage.getItem('kpk_client_name') || '';
    let preEmail = opts.email || localStorage.getItem('kpk_client_email') || '';
    let prePhone = opts.phone || localStorage.getItem('kpk_client_phone') || '';
    try {
      const nameInp = document.querySelector('#spec-contact-form input[name="nombre"]');
      const emailInp = document.querySelector('#spec-contact-form input[name="email"]');
      const telInp = document.querySelector('#spec-contact-form input[name="tel"]');
      if (!preName && nameInp) preName = nameInp.value;
      if (!preEmail && emailInp) preEmail = emailInp.value;
      if (!prePhone && telInp) prePhone = telInp.value;
    } catch (e) {}

    const resolvedLoteId = loteId || (_activeLote ? _activeLote.id : null);
    const loteLabel = _calLoteLabel(resolvedLoteId);
    const preferTime = opts.time || '12:00';
    const hours = ['10:00', '12:00', '15:00', '17:00'];
    const lotes = _calListLotes();

    const loteChips =
      '<button type="button" class="kpk-cal__lote-chip' +
      (!resolvedLoteId ? ' is-selected' : '') +
      '" data-lote-general="1">Visita general</button>' +
      lotes
        .map((l) => {
          const id = String(l.id);
          const tit = String(l.titulo || l.id);
          const sel =
            resolvedLoteId &&
            (String(resolvedLoteId) === id || String(resolvedLoteId) === tit)
              ? ' is-selected'
              : '';
          return (
            '<button type="button" class="kpk-cal__lote-chip' +
            sel +
            '" data-lote-id="' +
            _calEscape(id) +
            '">Lote ' +
            _calEscape(tit) +
            '</button>'
          );
        })
        .join('');

    _calendarState = {
      open: true,
      loteId: resolvedLoteId,
      loteLabel: loteLabel,
      date: preferDate || null,
      time: preferTime,
      name: preName,
      email: preEmail,
      phone: prePhone
    };

    widget.innerHTML =
      '<div class="kpk-cal__handle">' +
      '<div><span class="kpk-cal__eyebrow">Agenda de visita</span>' +
      '<span class="kpk-cal__title">Reservar recorrido en terreno</span>' +
      '<span class="kpk-cal__sub" id="kpk-cal-lote-sub">Coordinando: ' +
      _calEscape(loteLabel) +
      '</span></div>' +
      '<button type="button" class="kpk-cal__close" id="cal-widget-close-btn" title="Cerrar">&times;</button>' +
      '</div>' +
      '<div class="kpk-cal__body">' +
      '<div><div class="kpk-cal__step-label">1 · Parcela / lote</div>' +
      '<div class="kpk-cal__lotes" id="kpk-cal-lotes">' +
      loteChips +
      '</div></div>' +
      '<div><div class="kpk-cal__step-label">2 · Día <span class="kpk-cal__step-hint">(próximo mes)</span></div>' +
      '<div class="kpk-cal__days">' +
      daysHTML.join('') +
      '</div></div>' +
      '<div><div class="kpk-cal__step-label">3 · Hora</div><div class="kpk-cal__hours">' +
      hours
        .map(
          (h) =>
            '<button type="button" class="cal-hour-btn' +
            (h === preferTime ? ' is-selected' : '') +
            '" data-time="' +
            h +
            '">' +
            h +
            '</button>'
        )
        .join('') +
      '</div></div>' +
      '<div class="kpk-cal__fields">' +
      '<div class="kpk-cal__step-label">4 · Tus datos</div>' +
      '<input class="kpk-cal__input" type="text" id="cal-input-name" placeholder="Nombre completo" value="' +
      _calEscape(preName) +
      '">' +
      '<div class="kpk-cal__row">' +
      '<input class="kpk-cal__input" type="email" id="cal-input-email" placeholder="Correo" value="' +
      _calEscape(preEmail) +
      '">' +
      '<input class="kpk-cal__input" type="tel" id="cal-input-phone" placeholder="WhatsApp +569…" value="' +
      _calEscape(prePhone) +
      '">' +
      '</div>' +
      '<p class="kpk-cal__summary" id="kpk-cal-summary">—</p>' +
      '</div></div>' +
      '<div class="kpk-cal__footer">' +
      '<button type="button" class="kpk-cal__submit" id="cal-btn-submit">Confirmar Visita</button>' +
      '<p class="kpk-cal__hint">Elige parcela, día y hora. Al confirmar, el equipo te contactará pronto.</p>' +
      '</div>';

    const selectedDay = widget.querySelector('.cal-day-btn.is-selected');
    if (selectedDay) _calendarState.date = selectedDay.getAttribute('data-date');
    else {
      const first = widget.querySelector('.cal-day-btn');
      if (first) {
        first.classList.add('is-selected');
        _calendarState.date = first.getAttribute('data-date');
      }
    }

    _calBindWidget(widget);
    _calRefreshSummary();

    if (window.FerrariDrag) {
      window.FerrariDrag.attach(widget, { handle: '.kpk-cal__handle' });
    }

    widget.style.display = 'flex';
    widget.classList.remove('is-success');
    setTimeout(() => widget.classList.add('is-open'), 40);

    if (resolvedLoteId) {
      setTimeout(() => _calSelectLote(resolvedLoteId, { silent: true }), 120);
    }

    if (opts.silent !== true) {
      _pushSuggestChips([
        { label: '📅 Mañana 12:00', query: 'Agendar mañana a las 12:00' },
        { label: '📅 Pasado 15:00', query: 'Agendar pasado mañana a las 15:00' },
        { label: '✅ Confirmar visita', query: 'Confirmar la visita con mis datos' }
      ]);
    }

    try {
      document.body.classList.add('kpk-calendar-open');
    } catch (e) {}
  }

  function fillCalendarVisit(act) {
    act = act || {};
    if (!_calendarState.open) {
      openCalendarWidget(act.loteId || null, {
        date: act.date,
        time: act.time,
        name: act.name,
        email: act.email,
        phone: act.phone,
        silent: true
      });
    }
    const widget = document.getElementById('kpk-calendar-widget');
    if (!widget) return;

    if (act.loteId) {
      _calSelectLote(act.loteId, { silent: true });
    }
    if (act.date) {
      const dayBtns = widget.querySelectorAll('.cal-day-btn');
      let matched = false;
      dayBtns.forEach((b) => {
        b.classList.toggle('is-selected', b.getAttribute('data-date') === act.date);
        if (b.getAttribute('data-date') === act.date) matched = true;
      });
      if (matched) _calendarState.date = act.date;
    }
    if (act.time) {
      const t = String(act.time).slice(0, 5);
      widget.querySelectorAll('.cal-hour-btn').forEach((b) => {
        b.classList.toggle('is-selected', b.getAttribute('data-time') === t);
      });
      _calendarState.time = t;
    }
    if (act.name) {
      const inp = widget.querySelector('#cal-input-name');
      if (inp) inp.value = act.name;
      _calendarState.name = act.name;
      _clientName = act.name;
      localStorage.setItem('kpk_client_name', act.name);
    }
    if (act.email) {
      const inp = widget.querySelector('#cal-input-email');
      if (inp) inp.value = act.email;
      _calendarState.email = act.email;
      localStorage.setItem('kpk_client_email', act.email);
    }
    if (act.phone) {
      const inp = widget.querySelector('#cal-input-phone');
      if (inp) inp.value = act.phone;
      _calendarState.phone = act.phone;
      localStorage.setItem('kpk_client_phone', act.phone);
    }
    _calRefreshSummary();
  }

  async function confirmCalendarVisit() {
    const widget = document.getElementById('kpk-calendar-widget');
    if (!widget || !_calendarState.open) {
      appendMessage('Primero abre la agenda (di “quiero agendar una visita”).', 'system');
      return false;
    }

    const name =
      (widget.querySelector('#cal-input-name') && widget.querySelector('#cal-input-name').value.trim()) ||
      _calendarState.name;
    const email =
      (widget.querySelector('#cal-input-email') && widget.querySelector('#cal-input-email').value.trim()) ||
      _calendarState.email;
    const phone =
      (widget.querySelector('#cal-input-phone') && widget.querySelector('#cal-input-phone').value.trim()) ||
      _calendarState.phone;
    const dateStr = _calendarState.date;
    const timeStr = _calendarState.time;
    const loteId = _calendarState.loteId;
    const loteLabel = _calendarState.loteLabel;

    if (!dateStr || !timeStr || !name || !email || !phone) {
      appendMessage(
        'Faltan datos para confirmar: día, hora, nombre, correo y WhatsApp. Complétalos en la agenda o escríbemelos aquí.',
        'system'
      );
      _pushSuggestChips([
        { label: '📅 Completar en agenda', query: 'Quiero coordinar una visita al terreno' },
        { label: '📅 Mañana 12:00', query: 'Agendar mañana a las 12:00' }
      ]);
      return false;
    }

    const submitBtn = widget.querySelector('#cal-btn-submit');
    if (submitBtn) {
      submitBtn.textContent = 'Enviando…';
      submitBtn.disabled = true;
    }

    const project = _calProjectName();
    const notes =
      'AGENDAMIENTO DE VISITA EN TERRENO\n' +
      'Proyecto: ' +
      project +
      '\n' +
      'Lote: ' +
      loteLabel +
      (loteId ? ' (id ' + loteId + ')' : '') +
      '\n' +
      'Fecha: ' +
      dateStr +
      '\n' +
      'Hora: ' +
      timeStr +
      ' hrs\n' +
      'Visitante: ' +
      name +
      '\n' +
      'Email: ' +
      email +
      '\n' +
      'WhatsApp visitante: ' +
      phone +
      '\n' +
      'Origen: Copiloto IA / widget agenda';

    try {
      const mailOk = await submitLead(name, email, phone, loteId || loteLabel, notes);
      if (!mailOk) throw new Error('FormSubmit falló');

      localStorage.setItem('kpk_client_name', name);
      localStorage.setItem('kpk_client_email', email);
      localStorage.setItem('kpk_client_phone', phone);
      _clientName = name;

      // Notifica al equipo por correo (y CallMeBot si está activo). No abrir WhatsApp al visitante.
      const successHtml =
        '<div class="kpk-cal__success" role="status">' +
        '<div class="kpk-cal__success-mark" aria-hidden="true">✓</div>' +
        '<div class="kpk-cal__success-title">Solicitud enviada</div>' +
        '<p class="kpk-cal__success-text">Tu visita para <b>' +
        _calEscape(loteLabel) +
        '</b> el <b>' +
        _calEscape(dateStr) +
        '</b> a las <b>' +
        _calEscape(timeStr) +
        ' hrs</b> quedó registrada. Pronto te contactarán para coordinar el encuentro.</p>' +
        '</div>';
      widget.classList.add('is-success');
      widget.innerHTML = successHtml;

      const okMsg =
        '¡Listo, <b>' +
        _calEscape(name) +
        '</b>! Solicitud <b>enviada</b>. Visita para <b>' +
        _calEscape(loteLabel) +
        '</b> el <b>' +
        _calEscape(dateStr) +
        '</b> a las <b>' +
        _calEscape(timeStr) +
        ' hrs</b>. Pronto te contactará el equipo comercial.';
      appendMessage(okMsg, 'system');
      try {
        const isMob =
          window.innerWidth < 768 ||
          /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        if (isMob) showMobileBubblePopup(okMsg.replace(/<[^>]+>/g, ''), true);
      } catch (e) {}

      _pushSuggestChips([
        { label: '🏡 Ver lotes', query: '¿Cuáles lotes están disponibles?' },
        { label: '💵 Financiamiento', query: 'Quiero simular financiamiento' },
        { label: '🌲 Qué hacer cerca', query: 'Qué puedo hacer cerca del proyecto' }
      ]);

      setTimeout(() => closeCalendarWidget(), 3200);
      return true;
    } catch (err) {
      console.error('Error al agendar visita:', err);
      if (submitBtn) {
        submitBtn.textContent = 'Confirmar Visita';
        submitBtn.disabled = false;
      }
      appendMessage(
        'Hubo un problema al enviar la reserva. Intenta de nuevo o escríbenos por WhatsApp al asesor.',
        'system'
      );
      return false;
    }
  }

  function closeCalendarWidget() {
    const widget = document.getElementById('kpk-calendar-widget');
    if (widget) {
      widget.classList.remove('is-open', 'is-success');
      _calendarState.open = false;
      setTimeout(() => {
        widget.style.display = 'none';
      }, 280);
    } else {
      _calendarState.open = false;
    }
    try {
      document.body.classList.remove('kpk-calendar-open');
    } catch (e) {}
  }

  function isCalendarOpen() {
    return !!_calendarState.open;
  }

  window.FerrariCalendar = {
    open: openCalendarWidget,
    fill: fillCalendarVisit,
    confirm: confirmCalendarVisit,
    close: closeCalendarWidget,
    isOpen: isCalendarOpen,
    getState: () => Object.assign({}, _calendarState)
  };

  // ─── AUTO-CIERRE AUTOMATIZADO DE WIDGETS POR CAMBIO DE TEMA ───────────────
  function autoCloseUnusedWidgets(actions) {
    actions = Array.isArray(actions) ? actions : [];
    const hasMapAction = actions.some(a => a.type === 'openMapWidget' || a.type === 'focusNearbyPOI');
    const hasWeatherAction = actions.some(a => a.type === 'openWeatherWidget');
    const hasStatsAction = actions.some(a => a.type === 'showStats');
    const hasPriceAction = actions.some(a => a.type === 'showPriceComparison');
    const hasCalendarAction = actions.some(a =>
      a.type === 'openCalendarWidget' || a.type === 'fillCalendarVisit' || a.type === 'confirmCalendarVisit'
    );
    const hasTourismAction = actions.some(a =>
      a.type === 'openTourismWidget' || a.type === 'offerTourism' || a.type === 'confirmTourismOffer'
    );
    const hasFinanceAction = actions.some(a => a.type === 'openFinanceWidget');
    const hasLoteFocus = actions.some(a =>
      a.type === 'lookAtLote' ||
      a.type === 'openLotePanel' ||
      a.type === 'openGallery' ||
      a.type === 'downloadPDF' ||
      (a.type === 'highlightLotes' && Array.isArray(a.loteIds) && a.loteIds.length === 1)
    );
    const hasLotInventory = actions.some(a =>
      a.type === 'highlightAvailable' || a.type === 'startAutoTour' || a.type === 'showStats' || a.type === 'showPriceComparison'
    );

    // Mapa: mantener si hay acción de mapa O turismo (la ficha abre la ruta)
    if (!hasMapAction && !hasTourismAction) {
      closeMapWidget();
    }

    // Turismo: cerrar al cambiar de tema (lote, precio, clima, agenda…)
    if (!hasTourismAction && window.FerrariTourism) {
      window.FerrariTourism.closeWidget();
      if (!actions.some(a => a.type === 'offerTourism')) {
        window.FerrariTourism.clearPendingOffer();
      }
    }

    if (!hasStatsAction) {
      const statsWidget = document.getElementById('kpk-stats-widget');
      if (statsWidget && statsWidget.style.display !== 'none') {
        statsWidget.style.display = 'none';
        statsWidget.classList.remove('is-open');
      }
    }

    if (!hasPriceAction) {
      const priceWidget = document.getElementById('kpk-price-widget');
      if (priceWidget && priceWidget.style.display !== 'none') {
        priceWidget.style.display = 'none';
        priceWidget.classList.remove('is-open');
      }
    }

    if (!hasCalendarAction) {
      closeCalendarWidget();
    }

    if (!hasFinanceAction) {
      const finEl = document.getElementById('kpk-finance-widget');
      const finVisible = !!(
        finEl &&
        finEl.classList.contains('is-open') &&
        finEl.style.display !== 'none'
      );
      // Mantener abierto mientras el usuario sigue afinando; cerrar al cambiar de tema
      const leaveFinanceTopic =
        hasTourismAction ||
        hasCalendarAction ||
        hasMapAction ||
        hasWeatherAction ||
        hasStatsAction ||
        hasPriceAction ||
        hasLotInventory ||
        (hasLoteFocus && !hasFinanceAction);
      if (!finVisible || leaveFinanceTopic) {
        closeFinanceWidget();
      }
    }

    // Ficha de lote: solo vive mientras el turno habla de UN lote (o finanzas de ese lote)
    const keepLotePanel = hasLoteFocus || hasFinanceAction;
    if (!keepLotePanel) {
      if (window.FerrariUI && typeof window.FerrariUI.closeLotePanel === 'function') {
        window.FerrariUI.closeLotePanel();
      }
    }

    // Al entrar a turismo / mapa / clima / inventario amplio: colapsar dock y limpiar escena de lote
    if (hasTourismAction || hasMapAction || hasWeatherAction || (hasLotInventory && !hasLoteFocus)) {
      if (!hasLoteFocus && window.FerrariUI && typeof window.FerrariUI.closeLotePanel === 'function') {
        window.FerrariUI.closeLotePanel();
      }
      if (window.FerrariBuyerDock && typeof window.FerrariBuyerDock.setExpanded === 'function') {
        if (hasTourismAction || hasWeatherAction || hasMapAction) {
          window.FerrariBuyerDock.setExpanded(false);
        }
      }
    }

    // Al enfocar un lote concreto: cerrar turismo/mapa para no tapar la ficha
    if (hasLoteFocus) {
      if (window.FerrariTourism) {
        window.FerrariTourism.closeWidget();
        window.FerrariTourism.clearPendingOffer();
      }
      if (!hasMapAction) closeMapWidget();
      if (!hasCalendarAction) closeCalendarWidget();
    }
  }

  // ─── FINANCE WIDGET (SIMULADOR DE CRÉDITO DIRECTO) ────────────────────────
  function openFinanceWidget(loteId) {
    let widget = document.getElementById('kpk-finance-widget');
    if (!widget) {
      widget = document.createElement('div');
      widget.id = 'kpk-finance-widget';
      widget.className = 'kpk-finance-widget';
      document.body.appendChild(widget);
    }

    const ufValue = (window.FerrariUI && typeof window.FerrariUI.getUFValue === 'function') 
      ? window.FerrariUI.getUFValue() 
      : 38000;

    const lotes = (window.allDrawnLines || [])
      .filter(l => (l.tipo === 'lote-libre' || l.tipo === 'lote-organico') && l.estado !== 'VENDIDO');

    let currentSelectedId = loteId || (_activeLote ? _activeLote.id : (lotes[0] ? lotes[0].id : null));
    
    const optionsHTML = lotes.map(l => {
      const isSel = l.id === currentSelectedId ? 'selected' : '';
      return `<option value="${l.id}" ${isSel}>Lote ${l.titulo || l.id} (${l.valorUF || 0} UF)</option>`;
    }).join('');

    let preName = '';
    let preEmail = '';
    let prePhone = '';
    const nameInp = document.querySelector('#spec-contact-form input[name="nombre"]');
    const emailInp = document.querySelector('#spec-contact-form input[name="email"]');
    const telInp = document.querySelector('#spec-contact-form input[name="tel"]');
    if (nameInp) preName = nameInp.value;
    if (emailInp) preEmail = emailInp.value;
    if (telInp) prePhone = telInp.value;

    widget.innerHTML = `
      <div class="kpk-fin__handle">
        <div>
          <span class="kpk-fin__eyebrow">Financiamiento</span>
          <span class="kpk-fin__title">Simulador directo</span>
          <span class="kpk-fin__sub">Crédito del desarrollador · 0% interés</span>
        </div>
        <button type="button" class="kpk-fin__close" id="fin-widget-close-btn" title="Cerrar" aria-label="Cerrar">&times;</button>
      </div>

      <div class="kpk-fin__body">
        <div class="kpk-fin__step">
          <div class="kpk-fin__label"><span>1 · Terreno</span></div>
          <select id="fin-select-lote" class="fin-select">${optionsHTML}</select>
        </div>

        <div class="kpk-fin__step">
          <div class="kpk-fin__label">
            <span>2 · Pie</span>
            <span class="kpk-fin__label-val" id="fin-pie-percent">20%</span>
          </div>
          <input type="range" id="fin-slider-pie" class="fin-slider" min="10" max="50" step="5" value="20">
        </div>

        <div class="kpk-fin__step">
          <div class="kpk-fin__label"><span>3 · Plazo</span></div>
          <div class="fin-months-grid">
            <button type="button" class="fin-month-btn" data-months="12">12m</button>
            <button type="button" class="fin-month-btn is-selected" data-months="24">24m</button>
            <button type="button" class="fin-month-btn" data-months="36">36m</button>
            <button type="button" class="fin-month-btn" data-months="48">48m</button>
            <button type="button" class="fin-month-btn" data-months="60">60m</button>
          </div>
        </div>

        <div class="fin-summary-box">
          <div class="fin-summary-row"><span>Precio</span><strong id="fin-res-precio">-</strong></div>
          <div class="fin-summary-row"><span>Pie</span><strong id="fin-res-pie">-</strong></div>
          <div class="fin-summary-row"><span>Saldo</span><strong id="fin-res-saldo">-</strong></div>
          <div class="fin-summary-row highlight"><span>Dividendo</span><strong id="fin-res-cuota">-</strong></div>
        </div>

        <div class="kpk-fin__fields">
          <div class="kpk-fin__label"><span>4 · Tus datos</span></div>
          <input class="kpk-fin__input" type="text" id="fin-input-name" placeholder="Nombre completo" value="${preName}" autocomplete="name">
          <div class="kpk-fin__row">
            <input class="kpk-fin__input" type="email" id="fin-input-email" placeholder="Correo" value="${preEmail}" autocomplete="email">
            <input class="kpk-fin__input" type="tel" id="fin-input-phone" placeholder="WhatsApp" value="${prePhone}" autocomplete="tel">
          </div>
        </div>
      </div>

      <div class="kpk-fin__footer">
        <button type="button" class="kpk-fin__submit" id="fin-btn-submit">Enviar simulación</button>
      </div>
    `;

    function fmtCLP(val) {
      return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(val);
    }

    function recalculate() {
      const selLoteId = widget.querySelector('#fin-select-lote').value;
      const targetLote = lotes.find(l => l.id === selLoteId);
      if (!targetLote) return;

      const valUF = parseFloat(targetLote.valorUF || 0);
      const valCLP = Math.round(valUF * ufValue);

      const piePercent = parseInt(widget.querySelector('#fin-slider-pie').value);
      widget.querySelector('#fin-pie-percent').textContent = `${piePercent}%`;

      const selMonthBtn = widget.querySelector('.fin-month-btn.is-selected');
      const months = parseInt(selMonthBtn ? selMonthBtn.getAttribute('data-months') : 24);

      const pieUF = valUF * (piePercent / 100);
      const pieCLP = Math.round(valCLP * (piePercent / 100));

      const saldoUF = valUF - pieUF;
      const saldoCLP = valCLP - pieCLP;

      const cuotaUF = saldoUF / months;
      const cuotaCLP = Math.round(saldoCLP / months);

      widget.querySelector('#fin-res-precio').innerHTML = `${valUF.toFixed(0)} UF <span style="font-size:10.5px; font-weight:500; color:rgba(255,255,255,0.5);">(${fmtCLP(valCLP)})</span>`;
      widget.querySelector('#fin-res-pie').innerHTML = `${pieUF.toFixed(1)} UF <span style="font-size:10.5px; font-weight:500; color:rgba(255,255,255,0.5);">(${fmtCLP(pieCLP)})</span>`;
      widget.querySelector('#fin-res-saldo').innerHTML = `${saldoUF.toFixed(1)} UF <span style="font-size:10.5px; font-weight:500; color:rgba(255,255,255,0.5);">(${fmtCLP(saldoCLP)})</span>`;
      widget.querySelector('#fin-res-cuota').innerHTML = `${months} cuotas de ${cuotaUF.toFixed(2)} UF <span style="display:block; font-size:11px; font-weight:500; color:rgba(255,255,255,0.65); margin-top:2px;">~ ${fmtCLP(cuotaCLP)} CLP / mes</span>`;
    }

    widget.querySelector('#fin-select-lote').addEventListener('change', recalculate);
    widget.querySelector('#fin-slider-pie').addEventListener('input', recalculate);

    const monthBtns = widget.querySelectorAll('.fin-month-btn');
    monthBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        monthBtns.forEach(b => b.classList.remove('is-selected'));
        btn.classList.add('is-selected');
        recalculate();
      });
    });

    widget.querySelector('#fin-widget-close-btn').addEventListener('click', closeFinanceWidget);

    if (window.FerrariDrag) {
      window.FerrariDrag.attach(widget, { handle: '.kpk-fin__handle' });
    }

    widget.querySelector('#fin-btn-submit').addEventListener('click', async () => {
      const name = widget.querySelector('#fin-input-name').value.trim();
      const email = widget.querySelector('#fin-input-email').value.trim();
      const phone = widget.querySelector('#fin-input-phone').value.trim();

      if (!name || !email || !phone) {
        alert('Por favor complete sus datos de contacto.');
        return;
      }

      const selLoteId = widget.querySelector('#fin-select-lote').value;
      const targetLote = lotes.find(l => l.id === selLoteId);
      if (!targetLote) return;

      const valUF = parseFloat(targetLote.valorUF || 0);
      const valCLP = Math.round(valUF * ufValue);
      const piePercent = parseInt(widget.querySelector('#fin-slider-pie').value);
      const months = parseInt(widget.querySelector('.fin-month-btn.is-selected').getAttribute('data-months'));

      const pieUF = valUF * (piePercent / 100);
      const pieCLP = Math.round(valCLP * (piePercent / 100));
      const saldoUF = valUF - pieUF;
      const saldoCLP = valCLP - pieCLP;
      const cuotaCLP = Math.round(saldoCLP / months);

      const submitBtn = widget.querySelector('#fin-btn-submit');
      submitBtn.textContent = 'Procesando…';
      submitBtn.disabled = true;

      const notes = `COTIZACIÓN FINANCIERA DIRECTA:\n` +
                    `- Terreno: Lote ${targetLote.titulo || targetLote.id}\n` +
                    `- Valor: ${valUF} UF (~ ${fmtCLP(valCLP)})\n` +
                    `- Pie (${piePercent}%): ${pieUF.toFixed(1)} UF (~ ${fmtCLP(pieCLP)})\n` +
                    `- Saldo Financiado: ${saldoUF.toFixed(1)} UF (~ ${fmtCLP(saldoCLP)})\n` +
                    `- Plazo: ${months} cuotas mensuales sin interés de ~ ${fmtCLP(cuotaCLP)} CLP.`;

      try {
        await submitLead(name, email, phone, targetLote.id, notes);

        if (window.FerrariUI && typeof window.FerrariUI.playSuccessSound === 'function') {
          window.FerrariUI.playSuccessSound();
        }

        const wspMsg = `Hola, me interesa reservar con Financiamiento Directo.\n` +
                       `*Terreno:* Lote ${targetLote.titulo || targetLote.id}\n` +
                       `*Valor:* ${valUF} UF (~ ${fmtCLP(valCLP)})\n` +
                       `*Pie (${piePercent}%):* ${pieUF.toFixed(1)} UF (~ ${fmtCLP(pieCLP)})\n` +
                       `*Financiado:* ${saldoUF.toFixed(1)} UF\n` +
                       `*Dividendo:* ${months} cuotas de ~ ${fmtCLP(cuotaCLP)} CLP\n` +
                       `*Cliente:* ${name}\n` +
                       `*WhatsApp:* ${phone}`;

        const sellerPhone = _calSellerPhone();
        if (!sellerPhone) {
          window.FerrariUI && window.FerrariUI.showToast('Configura el WhatsApp de ventas en Admin → Contacto.', 'info');
          return;
        }
        const wspUrl = `https://api.whatsapp.com/send?phone=${sellerPhone}&text=${encodeURIComponent(wspMsg)}`;
        window.open(wspUrl, '_blank');

        closeFinanceWidget();

        appendMessage(`¡Excelente! Hemos generado tu simulación para el **Lote ${targetLote.titulo || targetLote.id}** con un **pie del ${piePercent}%** a **${months} cuotas** de **~ ${fmtCLP(cuotaCLP)} CLP/mes**. La cotización formal fue enviada a los ejecutivos y está lista para ser validada en WhatsApp.`, 'system');

      } catch (err) {
        console.error('Error al procesar simulación financiera:', err);
        submitBtn.textContent = 'Enviar simulación';
        submitBtn.disabled = false;
        alert('Ocurrió un error al procesar la cotización. Intente nuevamente.');
      }
    });

    recalculate();

    // Al reabrir: volver a ancla izquierda (no quedar bajo el chat)
    try {
      widget.classList.remove('is-user-positioned');
      widget.style.removeProperty('left');
      widget.style.removeProperty('top');
      widget.style.removeProperty('right');
      widget.style.removeProperty('bottom');
      widget.style.removeProperty('width');
      widget.style.removeProperty('transform');
    } catch (e) {}

    widget.style.display = 'flex';
    try {
      document.body.classList.add('kpk-finance-open');
    } catch (e) {}
    setTimeout(() => {
      widget.classList.add('is-open');
    }, 40);
  }

  function closeFinanceWidget() {
    const widget = document.getElementById('kpk-finance-widget');
    if (widget) {
      widget.classList.remove('is-open');
      setTimeout(() => {
        widget.style.display = 'none';
      }, 280);
    }
    try {
      document.body.classList.remove('kpk-finance-open');
    } catch (e) {}
  }

  // ─── CHIPS DE SUGERENCIA DINÁMICOS (+ carrusel con flechas) ───
  function _refreshChipsNav() {
    const rail = document.getElementById('kpk-ai-chips-rail');
    const container = document.getElementById('kpk-ai-chips-container');
    const prev = document.getElementById('kpk-ai-chips-prev');
    const next = document.getElementById('kpk-ai-chips-next');
    if (!rail || !container || !prev || !next) return;

    const hasChips = container.children.length > 0;
    rail.classList.toggle('is-empty', !hasChips);
    if (!hasChips) {
      prev.hidden = true;
      next.hidden = true;
      return;
    }

    const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth - 2);
    const canScroll = maxScroll > 8;
    rail.classList.toggle('is-scrollable', canScroll);
    prev.hidden = !canScroll || container.scrollLeft <= 4;
    next.hidden = !canScroll || container.scrollLeft >= maxScroll - 4;
  }

  function _scrollChips(dir) {
    const container = document.getElementById('kpk-ai-chips-container');
    if (!container) return;
    const step = Math.max(140, Math.floor(container.clientWidth * 0.72));
    container.scrollBy({ left: dir * step, behavior: 'smooth' });
    setTimeout(_refreshChipsNav, 280);
  }

  function _bindChipsRailOnce() {
    if (_bindChipsRailOnce._done) return;
    _bindChipsRailOnce._done = true;
    const prev = document.getElementById('kpk-ai-chips-prev');
    const next = document.getElementById('kpk-ai-chips-next');
    const container = document.getElementById('kpk-ai-chips-container');
    if (prev) prev.addEventListener('click', () => _scrollChips(-1));
    if (next) next.addEventListener('click', () => _scrollChips(1));
    if (container) {
      container.addEventListener('scroll', () => _refreshChipsNav(), { passive: true });
      // Recalcular al mutar chips
      try {
        const mo = new MutationObserver(() => {
          requestAnimationFrame(_refreshChipsNav);
        });
        mo.observe(container, { childList: true, subtree: true });
      } catch (e) {}
    }
    window.addEventListener('resize', () => _refreshChipsNav());
  }

  function _updateSuggestiveChips() {
    const container = document.getElementById('kpk-ai-chips-container');
    const mobileContainer = document.getElementById('kpk-mbp-chips-row');
    _bindChipsRailOnce();

    // No pisar chips de acción (menú termas / visita, etc.)
    if (_actionChipsActive) {
      requestAnimationFrame(_refreshChipsNav);
      return;
    }

    let chips = [];
    if (_activeLote) {
      chips = [
        { text: `📸 Fotos Lote ${_activeLote.titulo}`, query: `Ver fotos del Lote ${_activeLote.titulo}` },
        { text: `📄 Ficha PDF`, query: `Descargar ficha PDF del Lote ${_activeLote.titulo}` },
        { text: `♨️ Qué hacer cerca`, query: `¿Qué puedo hacer cerca del proyecto? Termas, trekking, lagos` },
        { text: `📅 Agendar Visita`, query: `Quiero agendar una visita para el Lote ${_activeLote.titulo}` }
      ];
    } else {
      chips = [
        { text: `🏡 Lotes Disponibles`, query: `¿Cuáles están disponibles?` },
        { text: `📅 Agendar visita`, query: `Quiero coordinar una visita al terreno` },
        { text: `🌲 Finde cerca`, query: `Arma mi primer fin de semana cerca del proyecto` },
        { text: `♨️ Termas`, query: `quiero planes de termas cerca` },
        { text: `🥾 Trekking`, query: `quiero planes de trekking cerca` },
        { text: `🛶 Rafting`, query: `quiero planes de rafting cerca` },
        { text: `🏞️ Lagos`, query: `quiero planes de lagos cerca` }
      ];
      // Si el catálogo ya cargó, anteponer chips oficiales (siempre conservar Agendar)
      try {
        if (window.FerrariTourism && typeof window.FerrariTourism.getChipDefs === 'function') {
          const defs = window.FerrariTourism.getChipDefs();
          if (defs && defs.length) {
            chips = [
              { text: `🏡 Lotes Disponibles`, query: `¿Cuáles están disponibles?` },
              { text: `📅 Agendar visita`, query: `Quiero coordinar una visita al terreno` },
              { text: `🌲 Finde cerca`, query: `Arma mi primer fin de semana cerca del proyecto` }
            ].concat(defs.slice(0, 4));
          }
        }
      } catch (e) {}
    }

    if (container) {
      container.innerHTML = chips.map(c => `
        <button class="kpk-suggest-chip" data-query="${c.query.replace(/"/g, '&quot;')}">
          ${c.text}
        </button>
      `).join('');

      container.querySelectorAll('.kpk-suggest-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          const query = btn.getAttribute('data-query');
          _input.value = query;
          handleSend();
        });
      });
      requestAnimationFrame(_refreshChipsNav);
    }

    if (mobileContainer) {
      const popup = document.getElementById('kpk-mobile-ai-bubble-popup');
      const isMinimal = popup && popup.classList.contains('kpk-mbp-minimal');
      
      if (popup && !isMinimal) {
        mobileContainer.style.display = 'flex';
        mobileContainer.innerHTML = chips.map(c => `
          <button class="kpk-mbp-chip" data-query="${c.query.replace(/"/g, '&quot;')}">
            ${c.text}
          </button>
        `).join('');

        mobileContainer.querySelectorAll('.kpk-mbp-chip').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            _mobileHudPinned = true;
            if (_bubblePopupTimeout) clearTimeout(_bubblePopupTimeout);
            const query = btn.getAttribute('data-query');
            _input.value = query;
            handleSend();
          });
        });
      } else {
        mobileContainer.style.display = 'none';
      }
    }
  }

  // Puentes para el widget de turismo
  window.__kpkRefreshTourismChips = function () {
    try { _updateSuggestiveChips(); } catch (e) {}
  };
  window.__kpkOfferTourism = function (cat) {
    offerTourismCategory(cat);
  };
  window.__kpkSendTourismFollowUp = function (query) {
    if (_input) _input.value = query;
    handleSend();
  };
  window.__kpkTourismOpened = function (poi) {
    appendMessage(
      `Listo: <b>${poi.title}</b>. Ruta, video/foto verificados y más planes abajo. ¿Seguimos con otro lugar o miramos lotes?`,
      'system'
    );
    _pushSuggestChips([
      { label: '🥾 Otro trekking', query: 'quiero planes de trekking cerca' },
      { label: '♨️ Termas', query: 'quiero planes de termas cerca' },
      { label: '🏡 Ver lotes', query: '¿Cuáles lotes están disponibles?' },
      { label: '📅 Agendar visita', query: 'Quiero coordinar una visita al terreno' },
      { label: '💬 WhatsApp asesor', query: 'Quiero hablar por WhatsApp con un asesor humano' }
    ]);
  };

  // ─── MOBILE HUD GLASSMORPHIC OVERLAYS ──────────────────────────────────────
  function showMobileBubblePopup(text, keepOpen) {
    let popup = document.getElementById('kpk-mobile-ai-bubble-popup');
    if (!popup) {
      popup = document.createElement('div');
      popup.id = 'kpk-mobile-ai-bubble-popup';
      popup.className = 'kpk-mobile-ai-bubble-popup';
      document.body.appendChild(popup);
      
      popup.addEventListener('click', () => {
        if (popup.classList.contains('kpk-mbp-minimal')) {
          expandMobileBubblePopup();
        }
      });
    } else if (popup.classList.contains('is-visible') && popup.style.display !== 'none') {
      const txtEl = popup.querySelector('#kpk-mbp-text');
      if (txtEl && text !== undefined && text !== '') {
        txtEl.innerHTML = _formatChatHtml(text);
      }
      
      popup.classList.remove('kpk-mbp-minimal');
      const inputRow = popup.querySelector('#kpk-mbp-input-row') || popup.querySelector('.kpk-mbp-input-row');
      const controlsRow = popup.querySelector('#kpk-mbp-controls-row') || popup.querySelector('.kpk-mbp-controls-row');
      if (inputRow && controlsRow) {
        if (_isWaitingForName || !_speechEnabled || _mobileHudPinned || keepOpen === true) {
          inputRow.style.display = 'flex';
          controlsRow.style.display = 'none';
        } else {
          inputRow.style.display = 'none';
          controlsRow.style.display = 'flex';
        }
      }
      
      if (_bubblePopupTimeout) clearTimeout(_bubblePopupTimeout);
      // En modo texto o con HUD anclado NO auto-cerrar
      if (
        !keepOpen &&
        !_mobileHudPinned &&
        !_isWaitingForName &&
        !_jarvisMode &&
        !_speechEnabled
      ) {
        _bubblePopupTimeout = setTimeout(() => {
          closeMobileBubblePopup(false);
        }, 7000);
      }
      // Refrescar chips sugestivos solo si no hay menú de acción (turismo, etc.)
      try {
        if (!_actionChipsActive) _updateSuggestiveChips();
      } catch (e) {}
      return;
    }

    const mode = _getVoiceMode();
    const isJarvis = mode.includes('jarvis') || mode.includes('charon') || mode.includes('daniel');
    const isGigi = !isJarvis && (mode.includes('gigi') || mode.includes('dalia') || mode.includes('stream') || mode === 'auto_gigi');
    const name = isJarvis ? 'Jarvis' : (isGigi ? 'Gigi' : 'Jarvis');

    // Iconos SVG
    const micSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;
    const keyboardSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect><line x1="6" y1="8" x2="6" y2="8"></line><line x1="10" y1="8" x2="10" y2="8"></line><line x1="14" y1="8" x2="14" y2="8"></line><line x1="18" y1="8" x2="18" y2="8"></line><line x1="6" y1="12" x2="6" y2="12"></line><line x1="10" y1="12" x2="18" y2="12"></line><line x1="6" y1="16" x2="18" y2="16"></line></svg>`;
    const sendSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
    const speakerOnSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
    const speakerMutedSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`;

    const muteIcon = _speechEnabled ? speakerOnSvg : speakerMutedSvg;
    const mbpMuteClass = _speechEnabled ? 'kpk-mute-glow' : '';

    popup.innerHTML = `
      <div class="kpk-mbp-header">
        <div class="kpk-mbp-ai-profile">
          <span class="kpk-mbp-status-dot"></span>
          <span class="kpk-mbp-name">${name}</span>
          ${_clientName ? `<span class="kpk-mbp-client-badge" id="kpk-mbp-client-badge" style="margin-left: 6px; font-size: 11px; color: rgba(255,255,255,0.85); background: rgba(255,255,255,0.12); padding: 2px 7px; border-radius: 10px; cursor: pointer; border: 1px solid rgba(255,255,255,0.15);" title="Cambiar tu nombre registrado">👤 ${_clientName} ✏️</span>` : ''}
        </div>
        <div class="kpk-mbp-actions">
          <button class="kpk-mbp-btn" id="kpk-mbp-close-btn" title="Cerrar">✕</button>
        </div>
      </div>
      
      <div class="kpk-mbp-body">
        <div class="kpk-mbp-text" id="kpk-mbp-text">${_formatChatHtml(text)}</div>
        <div class="kpk-mbp-chips-row" id="kpk-mbp-chips-row" style="display: none;"></div>
      </div>
      
      <div class="kpk-mbp-footer">
        <div class="kpk-mbp-input-row" id="kpk-mbp-input-row" style="display: none;">
          <input type="text" id="kpk-mbp-text-input" placeholder="${_isWaitingForName ? 'Escribe tu nombre aquí...' : 'Pregunta algo aquí...'}" autocomplete="off">
          <button id="kpk-mbp-mic-inline-btn" class="kpk-mbp-mic-inline-btn" title="Hablar">${micSvg}</button>
          <button id="kpk-mbp-send-btn">${sendSvg}</button>
        </div>
        
        <div class="kpk-mbp-controls" id="kpk-mbp-controls-row">
          <button class="kpk-mbp-control-btn kpk-mbp-keyboard-btn" id="kpk-mbp-keyboard-toggle" title="Escribir">${keyboardSvg}</button>
          <button class="kpk-mbp-control-btn kpk-mbp-mic-btn" id="kpk-mbp-mic-toggle" title="Hablar">${micSvg}</button>
        </div>
      </div>
    `;

    const popupMicBtn = popup.querySelector('#kpk-mbp-mic-toggle');
    const popupMicInlineBtn = popup.querySelector('#kpk-mbp-mic-inline-btn');
    if (_isListening) {
      if (popupMicBtn) popupMicBtn.classList.add('is-active');
      if (popupMicInlineBtn) popupMicInlineBtn.classList.add('is-active');
    }

    const _updateMuteUI = (enabled) => {
      const desktopVoiceBtn = document.getElementById('kpk-ai-toggle-voice');
      const desktopVoiceIcon = document.getElementById('kpk-voice-icon');
      const muteBtn = popup.querySelector('#kpk-mbp-mute-btn');

      if (!enabled) {
        if (muteBtn) {
          muteBtn.innerHTML = speakerMutedSvg;
          muteBtn.classList.remove('kpk-mute-glow');
        }
        if (desktopVoiceBtn) {
          desktopVoiceBtn.style.color = 'rgba(255,255,255,0.25)';
          desktopVoiceBtn.classList.remove('kpk-mute-glow');
        }
        if (desktopVoiceIcon) {
          desktopVoiceIcon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <line x1="23" y1="9" x2="17" y2="15"></line>
            <line x1="17" y1="9" x2="23" y2="15"></line>`;
        }
      } else {
        if (muteBtn) {
          muteBtn.innerHTML = speakerOnSvg;
          muteBtn.classList.add('kpk-mute-glow');
        }
        if (desktopVoiceBtn) {
          desktopVoiceBtn.style.color = '#39FF14';
          desktopVoiceBtn.classList.add('kpk-mute-glow');
        }
        if (desktopVoiceIcon) {
          desktopVoiceIcon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>`;
        }
      }
    };

    if (_bubblePopupTimeout) clearTimeout(_bubblePopupTimeout);

    popup.querySelector('#kpk-mbp-close-btn').addEventListener('click', closeMobileBubblePopup);

    if (window.FerrariDrag) {
      window.FerrariDrag.attach(popup, {
        handle: '.kpk-mbp-header',
        ignore: window.FerrariDrag.DEFAULT_IGNORE + ', .kpk-mbp-btn, .kpk-mbp-control-btn, .kpk-mbp-mic-inline-btn, #kpk-mbp-send-btn, #kpk-mbp-text-input'
      });
    }
    
    const clientBadge = popup.querySelector('#kpk-mbp-client-badge');
    if (clientBadge) {
      clientBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        const newName = prompt('¿Cómo te gustaría que te llame la IA?', _clientName || '');
        if (newName && newName.trim()) {
          let cleanNew = newName.trim().split(/\s+/)[0];
          cleanNew = cleanNew.charAt(0).toUpperCase() + cleanNew.slice(1).toLowerCase();
          _clientName = cleanNew;
          localStorage.setItem('kpk_client_name', cleanNew);
          _isWaitingForName = false;
          _updateSuggestiveChips();
          const modeStr = _getVoiceMode();
          const isG = modeStr.includes('gigi') || modeStr.includes('dalia');
          const reply = isG ? `¡Listo! Ahora te llamaré ${_clientName} 😊.` : `Entendido. Nombre actualizado a ${_clientName}.`;
          showMobileBubblePopup(reply, true);
          speakJarvis(reply);
        }
      });
    }
    
    // Mute TTS eliminado — la salida de voz se activa solo desde admin.html

    const kbdBtn = popup.querySelector('#kpk-mbp-keyboard-toggle');
    const inputRow = popup.querySelector('#kpk-mbp-input-row');
    const controlsRow = popup.querySelector('#kpk-mbp-controls-row');
    kbdBtn.addEventListener('click', () => {
      inputRow.style.display = 'flex';
      controlsRow.style.display = 'none';
      const inp = popup.querySelector('#kpk-mbp-text-input');
      inp.focus();
    });

    const textInput = popup.querySelector('#kpk-mbp-text-input');
    if (textInput) {
      textInput.addEventListener('focus', () => {
        // Al escribir, detenemos el micrófono y el habla activa por comodidad,
        // pero DEJAMOS la voz habilitada (_speechEnabled = true) para que la respuesta de Gigi sea hablada.
        _jarvisMode = false;
        _shouldRestartMic = false;
        stopAISpeech();
        if (_recognition) {
          try { _recognition.stop(); } catch(e) {}
        }
        inputRow.style.display = 'flex';
        controlsRow.style.display = 'none';
      });
    }

    const sendInputText = () => {
      const inp = popup.querySelector('#kpk-mbp-text-input');
      const query = inp.value.trim();
      if (!query) return;

      _input.value = query;
      inp.value = '';
      
      if (!_speechEnabled) {
        inputRow.style.display = 'flex';
        controlsRow.style.display = 'none';
      } else {
        inputRow.style.display = 'none';
        controlsRow.style.display = 'flex';
      }

      handleSend();
    };

    popup.querySelector('#kpk-mbp-send-btn').addEventListener('click', sendInputText);
    popup.querySelector('#kpk-mbp-text-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendInputText();
    });

    // El micrófono de la burbuja móvil usa la misma función compartida que el panel grande
    const _sharedToggleMic = window._kpkToggleMic || function() {};
    if (popupMicBtn) popupMicBtn.addEventListener('click', _sharedToggleMic);
    if (popupMicInlineBtn) popupMicInlineBtn.addEventListener('click', _sharedToggleMic);

    // Chat completo: minimal SOLO si TTS activo, no anclado y sin keepOpen
    const isMinimal =
      !_mobileHudPinned &&
      !_isWaitingForName &&
      !!_speechEnabled &&
      keepOpen !== true;
    if (isMinimal) {
      popup.classList.add('kpk-mbp-minimal');
    } else {
      popup.classList.remove('kpk-mbp-minimal');
    }

    // Mostrar teclado/input si esperamos el nombre, TTS off, o HUD anclado (texto)
    if (inputRow && controlsRow) {
      if (_isWaitingForName || !_speechEnabled || _mobileHudPinned || keepOpen === true) {
        inputRow.style.display = 'flex';
        controlsRow.style.display = 'none';
      } else if (!isMinimal) {
        inputRow.style.display = 'none';
        controlsRow.style.display = 'flex';
      }
    }

    popup.style.display = 'flex';
    setTimeout(() => {
      popup.classList.add('is-visible');
      if (_isWaitingForName || (!_speechEnabled && keepOpen)) {
        const inp = popup.querySelector('#kpk-mbp-text-input');
        if (inp) try { inp.focus(); } catch (e) {}
      }
      try {
        if (!_actionChipsActive) _updateSuggestiveChips();
      } catch (e) {}
    }, 50);

    if (_bubblePopupTimeout) clearTimeout(_bubblePopupTimeout);
    if (
      !keepOpen &&
      !_mobileHudPinned &&
      !_isWaitingForName &&
      !_jarvisMode &&
      !_speechEnabled
    ) {
      _bubblePopupTimeout = setTimeout(() => {
        closeMobileBubblePopup(false);
      }, 7000);
    }
  }

  function closeMobileBubblePopup(stopSpeech = true) {
    _mobileHudPinned = false;
    if (_bubblePopupTimeout) {
      clearTimeout(_bubblePopupTimeout);
      _bubblePopupTimeout = null;
    }
    const popup = document.getElementById('kpk-mobile-ai-bubble-popup');
    if (popup) {
      popup.classList.remove('is-visible');
      popup.classList.remove('kpk-mbp-minimal');
      if (stopSpeech) {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        if (_activeJarvisAudio) { _activeJarvisAudio.pause(); _activeJarvisAudio = null; }
      }
      setTimeout(() => {
        popup.style.display = 'none';
      }, 400);
    }
  }

  function expandMobileBubblePopup() {
    const popup = document.getElementById('kpk-mobile-ai-bubble-popup');
    if (popup) {
      _mobileHudPinned = true;
      if (_bubblePopupTimeout) clearTimeout(_bubblePopupTimeout);
      popup.classList.remove('kpk-mbp-minimal');
      popup.style.display = 'flex';
      popup.classList.add('is-visible');
      const inputRow = popup.querySelector('#kpk-mbp-input-row');
      const controlsRow = popup.querySelector('#kpk-mbp-controls-row');
      if (inputRow && controlsRow) {
        inputRow.style.display = 'flex';
        controlsRow.style.display = 'none';
        const input = inputRow.querySelector('input');
        if (input) {
          setTimeout(() => input.focus(), 100);
        }
      }
      _updateSuggestiveChips();
    }
  }

  function setAISpeaking(status) {
    _isAISpeaking = status;
    if (status) {
      _aiSpeechStartTime = Date.now();
    }
    const bubble = document.getElementById('kpk-ai-bubble');
    if (bubble) {
      if (status) {
        bubble.classList.add('is-speaking');
      } else {
        bubble.classList.remove('is-speaking');
        const isMobile = window.innerWidth < 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        // No auto-cerrar si el usuario está chateando (HUD anclado) o TTS off
        if (
          isMobile &&
          !_mobileHudPinned &&
          !_isWaitingForName &&
          !_jarvisMode &&
          _speechEnabled
        ) {
          if (_bubblePopupTimeout) clearTimeout(_bubblePopupTimeout);
          _bubblePopupTimeout = setTimeout(() => {
            if (!_mobileHudPinned) closeMobileBubblePopup(false);
          }, 1500);
        }
      }
    }
    const mobilePopup = document.getElementById('kpk-mobile-ai-bubble-popup');
    if (mobilePopup) {
      if (status) {
        mobilePopup.classList.add('is-speaking');
      } else {
        mobilePopup.classList.remove('is-speaking');
      }
    }
    // Badge ROBOT/motor eliminado — chat solo texto hasta activar TTS en admin
    const oldBadge = document.getElementById('kpk-voice-engine-badge');
    if (oldBadge) oldBadge.remove();
  }

  // Debug / prueba manual desde consola
  window.__kpkSpeak = function(t) { return speakJarvis(t || 'Hola, soy Dalia, voz neural humana.'); };
  window.__kpkVoiceDebug = function() {
    const gk = _getGeminiKey();
    const cfg = window.KPK_CONFIG || {};
    const budget = _readCharonBudget();
    return {
      mode: _getVoiceMode(),
      preferred: _getPreferredVoiceMode(),
      lastEngine: _lastUsedVoiceEngine,
      speechEnabled: _speechEnabled,
      ttsOutput: localStorage.getItem(TTS_OUTPUT_KEY),
      localProxy: _localTtsOk,
      el: _elStatus,
      charonBudget: { used: budget.used, max: CHARON_DAILY_BUDGET, left: _charonBudgetLeft(), locked: budget.locked, day: budget.day },
      geminiKeyLen: gk ? gk.length : 0,
      hasConfigGemini: !!(cfg.aiKeys && cfg.aiKeys.gemini),
      hasLsGemini: !!localStorage.getItem('ferrari_ai_key_gemini')
    };
  };
  window.__kpkSpeakCharon = function(t) {
    localStorage.setItem('kpk_voice_mode', 'jarvis_charon');
    localStorage.setItem('kpk_voice_user_override', '1');
    return _speakCharonJarvis(t || 'Mira, te lo dejo claro: sistemas en línea y listos para vender. ¿Empezamos?');
  };

  // Carga inicial
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
