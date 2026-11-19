/*
 * WAnalisis - exportador masivo de chats de WhatsApp Web.
 *
 * Este archivo corre en el "MAIN world" de web.whatsapp.com (mismo contexto
 * JavaScript que la app), para poder usar los modulos internos de WhatsApp Web
 * (window.require('WAWebCollections'), etc.). Recorre todos los chats, carga
 * el historial completo de cada uno y genera un ZIP con JSON y/o CSV.
 *
 * No envia nada a ningun servidor: todo se procesa y descarga localmente.
 *
 * Los nombres de modulos internos estan centralizados en MODULES para que sea
 * facil actualizarlos si WhatsApp los cambia.
 */
(() => {
  'use strict';

  if (window.__WAExport) return;

  const SRC_EXT = 'wa-export-ext';
  const SRC_PAGE = 'wa-export-page';
  const LAST_RUN_KEY = 'wa-export:last-run';

  const MODULES = {
    collections: 'WAWebCollections',
    loadMessages: 'WAWebChatLoadMessages',
    contactGetters: 'WAWebContactGetters',
    widFactory: 'WAWebWidFactory',
    meUser: 'WAWebUserPrefsMeUser',
  };

  const MEDIA_TYPES = new Set([
    'image', 'video', 'audio', 'ptt', 'document', 'sticker', 'gif', 'ptv',
  ]);

  const SYSTEM_TYPES = new Set([
    'e2e_notification', 'notification', 'notification_template', 'gp2',
    'broadcast_notification', 'call_log', 'protocol', 'ciphertext', 'revoked',
    'debug', 'unknown', 'pinned_message', 'keep_in_chat',
  ]);

  const DEFAULT_OPTIONS = {
    formats: ['json', 'csv'],
    loadFullHistory: true,
    since: null, // 'YYYY-MM-DD' o null
    onlyNew: false,
    maxPerChat: 0, // 0 = sin limite
    includeIndividuals: true,
    includeGroups: true,
    includeArchived: true,
    includeSystem: false,
    nameFilter: '',
    meName: 'Yo',
    delayMs: 250,
    loadTimeoutMs: 45000,
    maxStalls: 3,
  };

  // ------------------------------------------------------------------
  // Utilidades generales
  // ------------------------------------------------------------------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function withTimeout(promise, ms, label) {
    let t;
    return Promise.race([
      promise,
      new Promise((_, rej) => {
        t = setTimeout(() => rej(new Error(`Tiempo de espera agotado: ${label}`)), ms);
      }),
    ]).finally(() => clearTimeout(t));
  }

  /** Convierte un Wid (o string) de WhatsApp a texto "numero@servidor". */
  function wid(x) {
    if (!x) return '';
    if (typeof x === 'string') return x;
    if (typeof x._serialized === 'string') return x._serialized;
    if (typeof x.$1 === 'string') return x.$1;
    if (x.user && x.server) return `${x.user}@${x.server}`;
    if (x.remote && x.id) return `${x.fromMe ? 'true' : 'false'}_${wid(x.remote)}_${x.id}`;
    try {
      const s = String(x);
      return s === '[object Object]' ? '' : s;
    } catch {
      return '';
    }
  }

  const jidUser = (jid) => (jid || '').split('@')[0];
  const jidServer = (jid) => (jid || '').split('@')[1] || '';

  function pad(n, w = 2) {
    return String(n).padStart(w, '0');
  }

  /** ISO 8601 en hora local con desfase, p. ej. 2024-05-01T13:04:05-06:00 */
  function isoLocal(unixSeconds) {
    if (!unixSeconds) return '';
    const d = new Date(unixSeconds * 1000);
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const abs = Math.abs(off);
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
      `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
    );
  }

  function slug(name, max = 80) {
    const s = String(name || '')
      .normalize('NFC')
      .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '');
    return (s || 'chat').slice(0, max).trim();
  }

  function csvCell(v) {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'string' ? v : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  const csvRow = (cells) => cells.map(csvCell).join(',') + '\r\n';

  // ------------------------------------------------------------------
  // ZIP (sin dependencias). Usa deflate nativo si existe CompressionStream.
  // ------------------------------------------------------------------

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32Update(crc, bytes) {
    let c = crc ^ 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  const encoder = new TextEncoder();

  class ZipWriter {
    constructor() {
      this.parts = [];
      this.central = [];
      this.offset = 0;
      this.count = 0;
      const d = new Date();
      this.dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
      this.dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    }

    /** data: string o arreglo de Uint8Array (trozos). */
    async add(path, data) {
      const chunks = typeof data === 'string' ? [encoder.encode(data)] : data;
      let crc = 0;
      let size = 0;
      for (const c of chunks) {
        crc = crc32Update(crc, c);
        size += c.length;
      }

      let method = 0;
      let payload = new Blob(chunks);
      let csize = size;
      if (typeof CompressionStream !== 'undefined' && size > 0) {
        try {
          const stream = payload.stream().pipeThrough(new CompressionStream('deflate-raw'));
          const buf = await new Response(stream).arrayBuffer();
          if (buf.byteLength < size) {
            payload = new Blob([buf]);
            csize = buf.byteLength;
            method = 8;
          }
        } catch {
          /* sin compresion */
        }
      }

      if (this.offset + csize > 0xfffffff0 || this.count >= 0xffff) {
        throw new Error('El ZIP supera el limite de 4 GB / 65535 archivos. Usa filtros (fecha o nombre).');
      }

      const name = encoder.encode(path);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // nombres en UTF-8
      local.setUint16(8, method, true);
      local.setUint16(10, this.dosTime, true);
      local.setUint16(12, this.dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, csize, true);
      local.setUint32(22, size, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);

      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint16(8, 0x0800, true);
      cen.setUint16(10, method, true);
      cen.setUint16(12, this.dosTime, true);
      cen.setUint16(14, this.dosDate, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, csize, true);
      cen.setUint32(24, size, true);
      cen.setUint16(28, name.length, true);
      cen.setUint32(42, this.offset, true);

      this.parts.push(local.buffer, name, payload);
      this.central.push(cen.buffer, name);
      this.offset += 30 + name.length + csize;
      this.count++;
    }

    finish() {
      const cdSize = this.central.reduce((s, p) => s + (p.byteLength ?? p.length), 0);
      const end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true);
      end.setUint16(8, this.count, true);
      end.setUint16(10, this.count, true);
      end.setUint32(12, cdSize, true);
      end.setUint32(16, this.offset, true);
      return new Blob([...this.parts, ...this.central, end.buffer], { type: 'application/zip' });
    }
  }

  // ------------------------------------------------------------------
  // Acceso a WhatsApp Web
  // ------------------------------------------------------------------

  function req(name) {
    try {
      return typeof window.require === 'function' ? window.require(name) : null;
    } catch {
      return null;
    }
  }

  function getWA() {
    const C = req(MODULES.collections);
    if (!C || !C.Chat || typeof C.Chat.getModelsArray !== 'function') return null;
    return {
      Chat: C.Chat,
      Contact: C.Contact,
      loadMod: req(MODULES.loadMessages),
      getters: req(MODULES.contactGetters),
      widFactory: req(MODULES.widFactory),
      meUser: req(MODULES.meUser),
    };
  }

  async function waitForWA(timeoutMs = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const wa = getWA();
      if (wa && wa.Chat.getModelsArray().length > 0) return wa;
      await sleep(1000);
    }
    throw new Error(
      'No se pudo acceder a los datos de WhatsApp Web. Verifica que la sesion este iniciada y ' +
        'la lista de chats cargada. Si ya lo esta, es posible que WhatsApp haya cambiado sus ' +
        'modulos internos (ver MODULES en exporter.js).'
    );
  }

  function getMeJid(wa) {
    try {
      const u = wa.meUser;
      const me = (u && (u.getMaybeMePnUser?.() || u.getMaybeMeUser?.() || u.getMeUser?.())) || null;
      return wid(me);
    } catch {
      return '';
    }
  }

  function makeNameResolver(wa) {
    const cache = new Map();
    const lookup = (jid) => {
      if (!wa.Contact) return null;
      try {
        let c = wa.Contact.get(jid);
        if (!c && wa.widFactory?.createWid) c = wa.Contact.get(wa.widFactory.createWid(jid));
        return c || null;
      } catch {
        return null;
      }
    };
    return (jid, fallback) => {
      if (!jid) return fallback || '';
      if (!cache.has(jid)) {
        let name = '';
        const c = lookup(jid);
        if (c) {
          const G = wa.getters || {};
          try {
            name =
              (G.getName && G.getName(c)) ||
              c.name ||
              c.verifiedName ||
              (G.getPushname && G.getPushname(c)) ||
              c.pushname ||
              c.notifyName ||
              '';
          } catch {
            name = c.name || c.pushname || '';
          }
          if (!name && c.phoneNumber) name = `+${jidUser(wid(c.phoneNumber))}`;
        }
        cache.set(jid, name || '');
      }
      const found = cache.get(jid);
      if (found) return found;
      if (fallback) return fallback;
      const srv = jidServer(jid);
      return srv === 'c.us' || srv === 's.whatsapp.net' ? `+${jidUser(jid)}` : jidUser(jid);
    };
  }

  function chatKind(jid) {
    const srv = jidServer(jid);
    if (srv === 'g.us') return 'group';
    if (srv === 'newsletter') return 'channel';
    if (srv === 'broadcast') return 'broadcast';
    return 'individual';
  }

  function chatInfo(chat, nameOf) {
    const id = wid(chat.id);
    const kind = chatKind(id);
    let name = '';
    try {
      name = chat.formattedTitle || chat.name || '';
    } catch {
      name = chat.name || '';
    }
    if (!name) name = nameOf(id);

    const info = {
      id,
      name,
      kind,
      archived: !!chat.archive,
      pinned: !!chat.pin,
      last_activity: isoLocal(chat.t),
    };

    if (kind === 'group') {
      try {
        const meta = chat.groupMetadata;
        const parts = meta?.participants?.getModelsArray?.() || [];
        if (meta?.desc) info.description = meta.desc;
        info.participants = parts.map((p) => {
          const pid = wid(p.id);
          return { id: pid, name: nameOf(pid), admin: !!(p.isAdmin || p.isSuperAdmin) };
        });
      } catch {
        /* metadatos opcionales */
      }
    }
    return info;
  }

  function serializeMsg(m) {
    try {
      return typeof m.serialize === 'function' ? m.serialize() : m;
    } catch {
      return m;
    }
  }

  function msgKey(m) {
    return wid(m.id) || `${m.t}_${Math.random()}`;
  }

  /** Normaliza un mensaje al formato de exportacion. Devuelve null si se omite. */
  function normalizeMessage(m, ctx) {
    const s = serializeMsg(m);
    const type = s.type || 'unknown';
    if (!ctx.options.includeSystem && (s.isNotification || SYSTEM_TYPES.has(type))) return null;

    const id = s.id || {};
    const fromMe = !!id.fromMe;
    const isMedia = MEDIA_TYPES.has(type) || !!s.directPath;

    let text;
    if (isMedia) text = s.caption || '';
    else if (type === 'location') text = s.loc || s.comment || '';
    else if (type === 'vcard' || type === 'multi_vcard') text = s.vcardFormattedName || '';
    else if (type === 'revoked') text = '';
    else text = s.body || s.pollName || s.eventName || '';
    if (typeof text !== 'string') text = '';

    const senderId = fromMe ? ctx.meJid || 'me' : wid(s.author) || wid(s.from) || wid(id.remote);
    const senderName = fromMe ? ctx.options.meName : ctx.nameOf(senderId, s.notifyName || s.pushname);

    const out = {
      id: wid(id) || '',
      timestamp: s.t || 0,
      datetime: isoLocal(s.t),
      from_me: fromMe,
      sender_id: senderId,
      sender_name: senderName,
      type,
      text,
    };

    const quotedId = s.quotedStanzaID || '';
    if (quotedId) {
      out.quoted_id = quotedId;
      const qp = wid(s.quotedParticipant);
      if (qp) out.quoted_sender = ctx.nameOf(qp);
      const q = s.quotedMsg;
      if (q && typeof q === 'object') {
        const qText = MEDIA_TYPES.has(q.type) ? q.caption : q.body;
        if (typeof qText === 'string' && qText) out.quoted_text = qText.slice(0, 500);
      }
    }
    if (s.isForwarded) out.forwarded = true;
    if (s.star) out.starred = true;
    if (isMedia) {
      out.media = {};
      if (s.mimetype) out.media.mimetype = s.mimetype;
      if (s.filename) out.media.filename = s.filename;
      if (s.size) out.media.size = s.size;
      if (s.duration) out.media.duration = Number(s.duration) || s.duration;
    }
    if (type === 'location' && (s.lat || s.lng)) out.location = { lat: s.lat, lng: s.lng };
    if (type === 'poll_creation' && Array.isArray(s.pollOptions)) {
      out.poll_options = s.pollOptions.map((o) => o?.name).filter(Boolean);
    }
    const mentions = (s.mentionedJidList || []).map(wid).filter(Boolean);
    if (mentions.length) out.mentions = mentions.map((j) => ctx.nameOf(j));
    return out;
  }

  const CSV_HEADER = [
    'chat_id', 'chat_name', 'chat_type', 'message_id', 'datetime', 'timestamp',
    'sender_name', 'sender_id', 'from_me', 'type', 'text', 'quoted_sender',
    'quoted_text', 'forwarded', 'starred', 'media_mimetype', 'media_filename',
    'latitude', 'longitude',
  ];

  function messageCsvRow(chat, m) {
    return csvRow([
      chat.id, chat.name, chat.kind, m.id, m.datetime, m.timestamp, m.sender_name,
      m.sender_id, m.from_me ? 1 : 0, m.type, m.text, m.quoted_sender || '',
      m.quoted_text || '', m.forwarded ? 1 : 0, m.starred ? 1 : 0,
      m.media?.mimetype || '', m.media?.filename || '', m.location?.lat ?? '',
      m.location?.lng ?? '',
    ]);
  }

  // ------------------------------------------------------------------
  // Carga de historial
  // ------------------------------------------------------------------

  async function loadEarlier(wa, chat, timeoutMs) {
    const fn = wa.loadMod?.loadEarlierMsgs;
    if (typeof fn !== 'function') throw new Error('loadEarlierMsgs no disponible');
    try {
      return await withTimeout(Promise.resolve(fn({ chat })), timeoutMs, 'cargar historial');
    } catch (e) {
      if (/Tiempo de espera/.test(e.message)) throw e;
      // Firma antigua: loadEarlierMsgs(chat)
      return await withTimeout(Promise.resolve(fn(chat)), timeoutMs, 'cargar historial');
    }
  }

  function noEarlier(chat) {
    try {
      return !!chat.msgs?.msgLoadState?.noEarlierMsgs;
    } catch {
      return false;
    }
  }

  function currentModels(chat) {
    try {
      return chat.msgs?.getModelsArray?.() || [];
    } catch {
      return [];
    }
  }

  /**
   * Devuelve todos los modelos de mensaje del chat con t > minT (o >= sinceT),
   * cargando historial anterior mientras haga falta.
   */
  async function collectMessages(wa, chat, opts, cutoff, onProgress) {
    const byId = new Map();
    const addAll = (arr) => {
      if (!arr) return;
      for (const m of arr) if (m) byId.set(msgKey(m), m);
    };
    const oldestT = () => {
      let min = Infinity;
      for (const m of byId.values()) if (m.t && m.t < min) min = m.t;
      return min;
    };

    addAll(currentModels(chat));

    if (opts.loadFullHistory) {
      let stalls = 0;
      while (!state.cancelRequested) {
        if (noEarlier(chat)) break;
        if (cutoff && oldestT() <= cutoff) break;
        if (opts.maxPerChat > 0 && byId.size >= opts.maxPerChat) break;

        const before = byId.size;
        let loaded;
        try {
          loaded = await loadEarlier(wa, chat, opts.loadTimeoutMs);
        } catch (e) {
          log(`Aviso en "${state.currentChat}": ${e.message}`);
          break;
        }
        addAll(Array.isArray(loaded) ? loaded : null);
        addAll(currentModels(chat));
        onProgress(byId.size);

        if (Array.isArray(loaded) && loaded.length === 0) break;
        if (byId.size === before) {
          stalls++;
          if (stalls >= opts.maxStalls) break;
        } else {
          stalls = 0;
        }
        if (opts.delayMs > 0) await sleep(opts.delayMs);
      }
    }

    let list = [...byId.values()].filter((m) => !cutoff || (m.t || 0) > cutoff);
    list.sort((a, b) => (a.t || 0) - (b.t || 0));
    if (opts.maxPerChat > 0 && list.length > opts.maxPerChat) list = list.slice(-opts.maxPerChat);
    return list;
  }

  // ------------------------------------------------------------------
  // Estado, progreso y overlay
  // ------------------------------------------------------------------

  const state = {
    status: 'idle', // idle | running | done | error | cancelled
    phase: '',
    chatIndex: 0,
    chatTotal: 0,
    currentChat: '',
    currentChatMessages: 0,
    messagesTotal: 0,
    startedAt: 0,
    finishedAt: 0,
    error: '',
    fileName: '',
    log: [],
    cancelRequested: false,
  };

  let lastPost = 0;
  let pendingPost = null;

  function publicState() {
    const { cancelRequested, ...rest } = state;
    return { ...rest, log: state.log.slice(-8) };
  }

  function emit(force = false) {
    const now = Date.now();
    const send = () => {
      lastPost = Date.now();
      pendingPost = null;
      const s = publicState();
      window.postMessage({ source: SRC_PAGE, type: 'state', state: s }, location.origin);
      overlay.render(s);
    };
    if (force || now - lastPost > 250) {
      if (pendingPost) clearTimeout(pendingPost);
      send();
    } else if (!pendingPost) {
      pendingPost = setTimeout(send, 250 - (now - lastPost));
    }
  }

  function log(line) {
    state.log.push(`[${new Date().toLocaleTimeString()}] ${line}`);
    if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
    console.info('[WAnalisis]', line);
    emit();
  }

  const overlay = (() => {
    let root = null;
    let els = null;

    function el(tag, style, text) {
      const e = document.createElement(tag);
      if (style) e.style.cssText = style;
      if (text) e.textContent = text;
      return e;
    }

    function build() {
      root = el(
        'div',
        'position:fixed;right:16px;bottom:16px;z-index:2147483647;width:320px;' +
          'background:#111b21;color:#e9edef;border-radius:12px;padding:14px 16px;' +
          'font:13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
          'box-shadow:0 8px 28px rgba(0,0,0,.35);'
      );
      const head = el('div', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;');
      head.append(el('strong', 'font-size:14px;', 'Exportando chats'));
      const close = el('button', 'background:none;border:0;color:#8696a0;font-size:18px;cursor:pointer;line-height:1;', '×');
      close.title = 'Ocultar';
      close.addEventListener('click', () => (root.style.display = 'none'));
      head.append(close);

      const status = el('div', 'margin-bottom:6px;');
      const barWrap = el('div', 'height:6px;background:#2a3942;border-radius:3px;overflow:hidden;margin-bottom:6px;');
      const bar = el('div', 'height:100%;width:0;background:#00a884;transition:width .2s;');
      barWrap.append(bar);
      const detail = el('div', 'color:#8696a0;font-size:12px;min-height:34px;word-break:break-word;');
      const cancel = el(
        'button',
        'margin-top:8px;background:#2a3942;color:#e9edef;border:0;border-radius:6px;padding:6px 10px;cursor:pointer;',
        'Cancelar'
      );
      cancel.addEventListener('click', () => requestCancel());

      root.append(head, status, barWrap, detail, cancel);
      document.body.append(root);
      els = { status, bar, detail, cancel, title: head.firstChild };
    }

    function render(s) {
      if (s.status === 'idle') return;
      if (!root) build();
      if (s.status === 'running' && root.style.display === 'none' && s.chatIndex <= 1) root.style.display = '';
      const pct = s.chatTotal ? Math.round((s.chatIndex / s.chatTotal) * 100) : 0;
      els.bar.style.width = `${s.status === 'done' ? 100 : pct}%`;
      els.cancel.style.display = s.status === 'running' ? '' : 'none';
      const titles = {
        running: 'Exportando chats',
        done: 'Exportacion terminada',
        error: 'Error en la exportacion',
        cancelled: 'Exportacion cancelada',
      };
      els.title.textContent = titles[s.status] || 'Exportando chats';
      if (s.status === 'running') {
        els.status.textContent = s.chatTotal
          ? `Chat ${s.chatIndex} de ${s.chatTotal} (${pct}%) - ${s.messagesTotal.toLocaleString()} mensajes`
          : s.phase;
        els.detail.textContent = s.currentChat
          ? `${s.phase}: ${s.currentChat} (${s.currentChatMessages.toLocaleString()} mensajes cargados)`
          : s.phase;
      } else if (s.status === 'done') {
        els.status.textContent = `${s.messagesTotal.toLocaleString()} mensajes de ${s.chatTotal} chats.`;
        els.detail.textContent = `Archivo descargado: ${s.fileName}`;
      } else {
        els.status.textContent = s.error || '';
        els.detail.textContent = s.fileName ? `Archivo parcial descargado: ${s.fileName}` : '';
      }
    }

    return { render };
  })();

  function requestCancel() {
    if (state.status !== 'running') return;
    state.cancelRequested = true;
    state.phase = 'Cancelando (se descargara lo exportado hasta ahora)';
    emit(true);
  }

  // ------------------------------------------------------------------
  // Exportacion principal
  // ------------------------------------------------------------------

  function readLastRun() {
    try {
      return JSON.parse(localStorage.getItem(LAST_RUN_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  function writeLastRun(map) {
    try {
      localStorage.setItem(LAST_RUN_KEY, JSON.stringify(map));
    } catch {
      /* ignorar */
    }
  }

  function parseSince(since) {
    if (!since) return 0;
    const d = new Date(`${since}T00:00:00`);
    return Number.isNaN(d.getTime()) ? 0 : Math.floor(d.getTime() / 1000) - 1;
  }

  function download(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  function stamp() {
    const d = new Date();
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  async function runExport(userOptions) {
    if (state.status === 'running') return;
    const opts = { ...DEFAULT_OPTIONS, ...(userOptions || {}) };
    opts.maxPerChat = Math.max(0, parseInt(opts.maxPerChat, 10) || 0);
    opts.delayMs = Math.max(0, parseInt(opts.delayMs, 10) || 0);
    const formats = new Set(Array.isArray(opts.formats) && opts.formats.length ? opts.formats : ['json', 'csv']);

    Object.assign(state, {
      status: 'running',
      phase: 'Esperando a WhatsApp Web',
      chatIndex: 0,
      chatTotal: 0,
      currentChat: '',
      currentChatMessages: 0,
      messagesTotal: 0,
      startedAt: Date.now(),
      finishedAt: 0,
      error: '',
      fileName: '',
      log: [],
      cancelRequested: false,
    });
    emit(true);

    const zip = new ZipWriter();
    const allCsv = formats.has('csv') ? [encoder.encode('﻿' + csvRow(CSV_HEADER))] : null;
    const index = [];
    const lastRun = readLastRun();
    const newLastRun = { ...lastRun };
    const usedNames = new Set();
    let wroteAnything = false;

    try {
      const wa = await waitForWA();
      const nameOf = makeNameResolver(wa);
      const meJid = getMeJid(wa);
      const ctx = { options: opts, nameOf, meJid };
      const sinceT = parseSince(opts.since);
      const filter = (opts.nameFilter || '').trim().toLowerCase();

      let chats = wa.Chat.getModelsArray().slice();
      chats.sort((a, b) => (b.t || 0) - (a.t || 0));
      chats = chats.filter((chat) => {
        const id = wid(chat.id);
        const kind = chatKind(id);
        if (kind === 'broadcast' || kind === 'channel') return false;
        if (kind === 'group' && !opts.includeGroups) return false;
        if (kind === 'individual' && !opts.includeIndividuals) return false;
        if (chat.archive && !opts.includeArchived) return false;
        if (filter) {
          const n = chatInfo(chat, nameOf).name.toLowerCase();
          if (!n.includes(filter)) return false;
        }
        return true;
      });

      state.chatTotal = chats.length;
      log(`Chats a exportar: ${chats.length}`);

      for (let i = 0; i < chats.length && !state.cancelRequested; i++) {
        const chat = chats[i];
        let info;
        try {
          info = chatInfo(chat, nameOf);
        } catch (e) {
          info = { id: wid(chat.id), name: wid(chat.id), kind: chatKind(wid(chat.id)) };
        }
        state.chatIndex = i + 1;
        state.currentChat = info.name;
        state.currentChatMessages = 0;
        state.phase = opts.loadFullHistory ? 'Cargando historial' : 'Leyendo mensajes';
        emit();

        const chatCutoff = Math.max(sinceT, opts.onlyNew ? lastRun[info.id] || 0 : 0);

        let normalized = [];
        let error = '';
        try {
          const models = await collectMessages(wa, chat, opts, chatCutoff, (n) => {
            state.currentChatMessages = n;
            emit();
          });
          for (const m of models) {
            try {
              const n = normalizeMessage(m, ctx);
              if (n) normalized.push(n);
            } catch (e) {
              /* mensaje ilegible: se omite */
            }
          }
        } catch (e) {
          error = e.message || String(e);
          log(`Error en "${info.name}": ${error}`);
        }

        const first = normalized[0];
        const last = normalized[normalized.length - 1];
        if (last) newLastRun[info.id] = Math.max(newLastRun[info.id] || 0, last.timestamp);

        let base = `${slug(info.name)}__${jidUser(info.id)}`;
        while (usedNames.has(base)) base += '_';
        usedNames.add(base);

        const entry = {
          id: info.id,
          name: info.name,
          kind: info.kind,
          archived: info.archived,
          message_count: normalized.length,
          first_message: first ? first.datetime : null,
          last_message: last ? last.datetime : null,
          files: {},
        };
        if (error) entry.error = error;

        if (normalized.length > 0 || !opts.onlyNew) {
          state.phase = 'Escribiendo archivos';
          emit();
          if (formats.has('json')) {
            const path = `json/${base}.json`;
            await zip.add(
              path,
              JSON.stringify({ chat: info, exported_at: isoLocal(Date.now() / 1000), message_count: normalized.length, messages: normalized })
            );
            entry.files.json = path;
          }
          if (formats.has('csv')) {
            const path = `csv/${base}.csv`;
            const rows = normalized.map((m) => messageCsvRow(info, m));
            await zip.add(path, '﻿' + csvRow(CSV_HEADER) + rows.join(''));
            for (const r of rows) allCsv.push(encoder.encode(r));
            entry.files.csv = path;
          }
          wroteAnything = true;
        }

        index.push(entry);
        state.messagesTotal += normalized.length;
        normalized = null;
        emit();
        await sleep(0);
      }

      state.phase = 'Generando ZIP';
      state.currentChat = '';
      emit(true);

      if (allCsv) await zip.add('todos_los_mensajes.csv', allCsv);
      await zip.add(
        'index.json',
        JSON.stringify(
          {
            exported_at: isoLocal(Date.now() / 1000),
            tool: 'WAnalisis Chrome extension',
            account: meJid || null,
            options: { ...opts, formats: [...formats] },
            complete: !state.cancelRequested,
            chat_count: index.length,
            message_count: state.messagesTotal,
            chats: index,
          },
          null,
          2
        )
      );
      await zip.add('LEEME.txt', readme(formats));

      const fileName = `whatsapp-export-${stamp()}${state.cancelRequested ? '-parcial' : ''}.zip`;
      download(zip.finish(), fileName);
      state.fileName = fileName;
      if (!state.cancelRequested) writeLastRun(newLastRun);

      state.status = state.cancelRequested ? 'cancelled' : 'done';
      state.error = state.cancelRequested ? 'Cancelada por el usuario.' : '';
      state.phase = '';
      state.finishedAt = Date.now();
      log(`Listo: ${state.messagesTotal} mensajes en ${index.length} chats -> ${fileName}`);
      if (!wroteAnything) log('No habia mensajes nuevos que exportar.');
    } catch (e) {
      state.status = 'error';
      state.error = e.message || String(e);
      state.finishedAt = Date.now();
      log(`Error: ${state.error}`);
      if (index.length) {
        try {
          await zip.add('index.json', JSON.stringify({ complete: false, error: state.error, chats: index }, null, 2));
          const fileName = `whatsapp-export-${stamp()}-parcial.zip`;
          download(zip.finish(), fileName);
          state.fileName = fileName;
        } catch {
          /* nada mas que hacer */
        }
      }
    } finally {
      state.cancelRequested = false;
      emit(true);
    }
  }

  function readme(formats) {
    const lines = [
      'Exportacion de chats de WhatsApp Web (WAnalisis)',
      '',
      'Contenido:',
      '  index.json               Lista de chats con conteo de mensajes, fechas y rutas de archivos.',
    ];
    if (formats.has('json')) lines.push('  json/<chat>.json         Un archivo por chat: metadatos del chat y lista de mensajes.');
    if (formats.has('csv')) {
      lines.push('  csv/<chat>.csv           Un archivo por chat (UTF-8 con BOM, compatible con Excel).');
      lines.push('  todos_los_mensajes.csv   Todos los mensajes de todos los chats en una sola tabla.');
    }
    lines.push(
      '',
      'Campos de cada mensaje:',
      '  datetime     Fecha y hora local (ISO 8601).',
      '  timestamp    Segundos Unix.',
      '  sender_name  Nombre del remitente (tu nombre configurado si from_me = true).',
      '  type         chat (texto), image, video, audio, ptt (nota de voz), document, sticker, location, ...',
      '  text         Texto del mensaje o pie de foto. Los archivos multimedia no se incluyen, solo sus metadatos.',
      '  quoted_*     Mensaje al que se respondio, si aplica.',
      '',
      'Sugerencia para Claude: sube index.json junto con los archivos de los chats que quieras analizar,',
      'o todos_los_mensajes.csv para un analisis global.',
      ''
    );
    return lines.join('\r\n');
  }

  // ------------------------------------------------------------------
  // Mensajeria con la extension
  // ------------------------------------------------------------------

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== SRC_EXT) return;
    const { type, options } = e.data;
    if (type === 'start') runExport(options);
    else if (type === 'cancel') requestCancel();
    else if (type === 'getState') emit(true);
  });

  window.__WAExport = {
    start: runExport,
    cancel: requestCancel,
    getState: publicState,
    _internals: { ZipWriter, crc32Update, csvRow, slug, wid, isoLocal, normalizeMessage, MODULES },
  };

  window.postMessage({ source: SRC_PAGE, type: 'state', state: publicState() }, location.origin);
})();
