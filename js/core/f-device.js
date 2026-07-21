/**
 * f-device.js — Detección de capacidad del dispositivo para adaptar Ferrari360
 *
 * Determina un tier (high / mid / low) basado en:
 *  - WebGL MAX_TEXTURE_SIZE
 *  - Memoria del dispositivo (navigator.deviceMemory)
 *  - Núcleos de CPU (navigator.hardwareConcurrency)
 *  - Resolución de pantalla
 *  - User-Agent (Samsung Galaxy, mid-range Android)
 *
 * Expone window.FerrariDevice con el tier y el ancho máximo recomendado.
 */

'use strict';

(function() {

  // Tamaño original conocido de loteo360.jpg
  const ORIGINAL_WIDTH  = 12000;
  const ORIGINAL_HEIGHT = 6000;

  // Anchos máximos objetivo por tier (en píxeles de ancho de la equirectangular)
  const LIMITS = {
    high: 8192,
    mid:  4096,
    low:  2048
  };

  let _tier  = 'high';
  let _limit = LIMITS.high;
  let _maxTexSize = 0;
  let _detected   = false;
  let _externalTexSize = 0; // seteado externamente (f-init) para evitar doble contexto WebGL

  function detect() {
    if (_detected) return { tier: _tier, maxWidth: _limit, maxTextureSize: _maxTexSize };
    _detected = true;

    var score = 0;

    // 1. WebGL MAX_TEXTURE_SIZE
    _maxTexSize = _detectMaxTextureSize();

    // 2. Memoria del dispositivo (solo Chrome / Chromium)
    var mem = navigator.deviceMemory;
    if (mem !== undefined) {
      if (mem >= 6)      score += 3;
      else if (mem >= 4) score += 2;
      else               score += 1;
    } else {
      score += 2; // neutral
    }

    // 3. Núcleos de CPU
    var cores = navigator.hardwareConcurrency;
    if (cores !== undefined) {
      if (cores >= 8)      score += 3;
      else if (cores >= 4) score += 2;
      else                 score += 1;
    } else {
      score += 2;
    }

    // 4. Resolución de pantalla (píxeles totales)
    var screenPx = (screen.width || 1920) * (screen.height || 1080);
    if (screenPx > 4000000)       score += 2;  // > 4MP (WQHD, tablets grandes)
    else if (screenPx > 2000000)  score += 1;  // ~2-4MP (FHD+)
    // < 2MP → 0

    // 5. Penalización Samsung / mid-range Android
    var ua = navigator.userAgent.toLowerCase();
    var isSamsung = ua.indexOf('samsung') >= 0 || ua.indexOf('galaxy') >= 0;
    var isMidRange = (cores !== undefined && cores <= 8) || (mem !== undefined && mem <= 6);
    if (isSamsung && isMidRange) score -= 1;

    // 5b. Samsung tablet con pantalla grande y sin deviceMemory o poca RAM
    //     Detecta Galaxy Tab S7 FE y similares (2560×1600, 4GB)
    //     Forzar low tier para evitar texturas de 8192px que saturan la GPU
    var screenW = Math.max(screen.width || 0, screen.height || 0);
    if (isSamsung && screenW >= 2000 && (mem === undefined || mem <= 4)) score -= 4;

    // 6. Ajuste por MAX_TEXTURE_SIZE real
    if (_maxTexSize > 0) {
      if (_maxTexSize >= 8192)      score += 2;
      else if (_maxTexSize >= 4096) score += 0;
      else                          score -= 2;  // < 4096 → low-end
    }

    // Asignar tier
    if (score >= 6) { _tier = 'high'; _limit = LIMITS.high; }
    else if (score >= 3) { _tier = 'mid'; _limit = LIMITS.mid; }
    else { _tier = 'low'; _limit = LIMITS.low; }

    // Si el MAX_TEXTURE_SIZE es menor que el límite elegido, forzar baja
    if (_maxTexSize > 0 && _limit > _maxTexSize) {
      _limit = Math.min(_limit, _maxTexSize);
      if (_limit <= 2048)      _tier = 'low';
      else if (_limit <= 4096) _tier = 'mid';
    }

    console.log('[Ferrari/Device] Tier:', _tier, '| maxWidth:', _limit, '| MAX_TEXTURE_SIZE:', _maxTexSize, '| score:', score);

    return { tier: _tier, maxWidth: _limit, maxTextureSize: _maxTexSize };
  }

  function setMaxTextureSize(size) {
    _externalTexSize = size;
  }

  function _detectMaxTextureSize() {
    // Si f-init ya pasó el valor, no crear otro contexto WebGL
    if (_externalTexSize > 0) return _externalTexSize;
    var c = document.createElement('canvas');
    var names = ['webgl2', 'webgl', 'experimental-webgl'];
    var gl = null;
    for (var i = 0; i < names.length && !gl; i++) {
      try { gl = c.getContext(names[i], { alpha: false, depth: false }); } catch (e) {}
    }
    if (!gl) return 0;
    var size = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    var lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return size;
  }

  function needsDownscale() {
    detect();
    return ORIGINAL_WIDTH > _limit;
  }

  function getMaxWidth() {
    detect();
    return _limit;
  }

  function getTier() {
    detect();
    return _tier;
  }

  function getOriginalWidth() { return ORIGINAL_WIDTH; }
  function getOriginalHeight() { return ORIGINAL_HEIGHT; }

  window.FerrariDevice = {
    detect: detect,
    needsDownscale: needsDownscale,
    getMaxWidth: getMaxWidth,
    getTier: getTier,
    setMaxTextureSize: setMaxTextureSize,
    getOriginalWidth: getOriginalWidth,
    getOriginalHeight: getOriginalHeight
  };

  console.log('[Ferrari/Device] ✓ Módulo cargado');

})();
