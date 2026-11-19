/*
 * Puente entre el panel lateral de la extension y exporter.js (MAIN world).
 * Corre en el "isolated world" de web.whatsapp.com: tiene chrome.runtime pero
 * no los módulos internos de WhatsApp. Reenvia llamadas RPC y el estado.
 */
(() => {
  const SRC_EXT = 'wa-export-ext';
  const SRC_PAGE = 'wa-export-page';
  const LAST_RUN_KEY = 'wa-export-last-run';
  const pending = new Map();

  // Registro de la ultima exportacion (id de chat -> ultimo timestamp exportado).
  // Se guarda solo en chrome.storage.local: privado de la extension, local y sin sincronizar.
  async function saveLastRun(data) {
    if (!data || typeof data !== 'object' || !data.chats) return;
    const stored = (await chrome.storage.local.get(LAST_RUN_KEY))[LAST_RUN_KEY] || { at: 0, chats: {} };
    const chats = { ...stored.chats };
    for (const [id, t] of Object.entries(data.chats)) {
      if (typeof t === 'number') chats[id] = Math.max(chats[id] || 0, t);
    }
    await chrome.storage.local.set({ [LAST_RUN_KEY]: { at: Math.max(stored.at || 0, data.at || 0), chats } });
  }
  let seq = 0;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.target !== 'wa-export') return false;
    const id = ++seq;
    const timer = setTimeout(() => {
      if (pending.delete(id)) sendResponse({ error: 'La página no respondió. Recarga WhatsApp Web.' });
    }, 15000);
    pending.set(id, (result) => {
      clearTimeout(timer);
      sendResponse(result);
    });
    window.postMessage({ source: SRC_EXT, type: 'rpc', id, method: msg.method, params: msg.params || null }, location.origin);
    return true; // respuesta asincrona
  });

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== SRC_PAGE) return;
    if (e.data.type === 'rpc-result') {
      const done = pending.get(e.data.id);
      if (done) {
        pending.delete(e.data.id);
        done(e.data.result);
      }
    } else if (e.data.type === 'state') {
      chrome.runtime.sendMessage({ target: 'wa-export-panel', state: e.data.state }).catch(() => {});
    } else if (e.data.type === 'lastRun') {
      saveLastRun(e.data.data);
    }
  });
})();
