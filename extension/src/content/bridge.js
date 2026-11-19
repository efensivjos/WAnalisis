/*
 * Puente entre el popup de la extension y exporter.js (MAIN world).
 * Corre en el "isolated world" de web.whatsapp.com, que tiene acceso a
 * chrome.runtime pero no a los modulos internos de WhatsApp.
 */
(() => {
  const SRC_EXT = 'wa-export-ext';
  const SRC_PAGE = 'wa-export-page';
  let lastState = { status: 'idle' };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.target !== 'wa-export') return false;
    if (msg.type === 'getState') {
      sendResponse(lastState);
      return false;
    }
    if (msg.type === 'start' || msg.type === 'cancel') {
      window.postMessage({ source: SRC_EXT, type: msg.type, options: msg.options || null }, location.origin);
      sendResponse({ ok: true });
    }
    return false;
  });

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== SRC_PAGE) return;
    if (e.data.type === 'state') {
      lastState = e.data.state;
      chrome.runtime.sendMessage({ target: 'wa-export-popup', state: lastState }).catch(() => {});
    }
  });

  window.postMessage({ source: SRC_EXT, type: 'getState' }, location.origin);
})();
