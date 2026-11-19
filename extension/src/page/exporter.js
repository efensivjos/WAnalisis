/*
 * WAnalisis - exportador masivo de chats de WhatsApp Web.
 *
 * Corre en el "MAIN world" de web.whatsapp.com (mismo contexto JavaScript que
 * la app) para usar los módulos internos de WhatsApp Web. Recorre los chats,
 * carga el historial completo y genera un ZIP con JSON, CSV y/o TXT.
 *
 * Nada sale del navegador: todo se procesa y descarga localmente.
 *
 * Los nombres de módulos internos estan centralizados en MODULES para poder
 * actualizarlos rápido si WhatsApp los cambia.
 */
(() => {
  'use strict';

  if (window.__WAExport) return;

  const SRC_EXT = 'wa-export-ext';
  const SRC_PAGE = 'wa-export-page';
  // Clave usada por versiones anteriores en el almacenamiento de WhatsApp Web.
  // Ya no se escribe: el registro vive en chrome.storage.local de la extension.
  const LEGACY_LAST_RUN_KEY = 'wa-export:last-run';

  const MODULES = {
    collections: 'WAWebCollections',
    loadMessages: 'WAWebChatLoadMessages',
    contactGetters: 'WAWebContactGetters',
    widFactory: 'WAWebWidFactory',
    meUser: 'WAWebUserPrefsMeUser',
  };

  const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'ptt', 'document', 'sticker', 'gif', 'ptv']);

  const SYSTEM_TYPES = new Set([
    'e2e_notification', 'notification', 'notification_template', 'gp2',
    'broadcast_notification', 'call_log', 'protocol', 'ciphertext', 'revoked',
    'debug', 'unknown', 'pinned_message', 'keep_in_chat',
  ]);

  const DEFAULT_OPTIONS = {
    formats: ['json', 'csv', 'txt'],
    chatIds: null, // null = todos los que pasen los filtros
    loadFullHistory: true,
    since: null, // 'YYYY-MM-DD'
    onlyNew: false,
    maxPerChat: 0, // 0 = sin límite
    includeIndividuals: true,
    includeGroups: true,
    activityDays: 0, // 0 = cualquier fecha; N = solo chats con ultimo mensaje en los ultimos N dias
    includeArchived: true,
    includeSystem: false,
    nameFilter: '',
    meName: 'Yo',
    concurrency: 2,
    delayMs: 150,
    loadTimeoutMs: 45000,
    maxStalls: 3,
  };

  // ------------------------------------------------------------------
  // Utilidades
  // ------------------------------------------------------------------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const encoder = new TextEncoder();

  function withTimeout(promise, ms, label) {
    let t;
    return Promise.race([
      promise,
      new Promise((_, rej) => {
        t = setTimeout(() => rej(new Error(`Tiempo de espera agotado: ${label}`)), ms);
      }),
    ]).finally(() => clearTimeout(t));
  }

  /** Convierte un Wid / MsgKey de WhatsApp (o string) a texto. */
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
  const pad = (n) => String(n).padStart(2, '0');

  /** ISO 8601 en hora local con desfase, p. ej. 2024-05-01T13:04:05-06:00 */
  function isoLocal(unixSeconds) {
    if (!unixSeconds) return '';
    const d = new Date(unixSeconds * 1000);
    const off = -d.getTimezoneOffset();
    const abs = Math.abs(off);
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
      `${off >= 0 ? '+' : '-'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
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
  // ZIP sin dependencias (deflate nativo via CompressionStream)
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

  const HAS_DEFLATE = typeof CompressionStream !== 'undefined';

  /** Compresor incremental: se le escriben trozos y al cerrar entrega la entrada lista. */
  class DeflateSink {
    constructor() {
      this.crc = 0;
      this.size = 0;
      this.out = [];
      if (HAS_DEFLATE) {
        const cs = new CompressionStream('deflate-raw');
        this.writer = cs.writable.getWriter();
        this.reading = (async () => {
          const reader = cs.readable.getReader();
          let n = 0;
          for (;;) {
            const { value, done } = await reader.read();
            if (done) return n;
            this.out.push(value);
            n += value.length;
          }
        })();
      }
    }

    async write(bytes) {
      if (!bytes.length) return;
      this.crc = crc32Update(this.crc, bytes);
      this.size += bytes.length;
      if (this.writer) await this.writer.write(bytes);
      else this.out.push(bytes);
    }

    async close() {
      if (!this.writer) return { crc: this.crc, size: this.size, csize: this.size, method: 0, data: new Blob(this.out) };
      await this.writer.close();
      const csize = await this.reading;
      return { crc: this.crc, size: this.size, csize, method: 8, data: new Blob(this.out) };
    }
  }

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

    /** data: string o arreglo de Uint8Array. */
    async add(path, data) {
      const chunks = typeof data === 'string' ? [encoder.encode(data)] : data;
      const sink = new DeflateSink();
      for (const c of chunks) await sink.write(c);
      this.addPrepared(path, await sink.close());
    }

    /** Agrega una entrada ya comprimida. Sincrono: seguro con tareas en paralelo. */
    addPrepared(path, { crc, size, csize, method, data }) {
      if (this.offset + csize > 0xfffffff0 || this.count >= 0xfffe) {
        throw new Error('El ZIP supera 4 GB o 65 534 archivos. Exporta por partes (filtra por fecha o por chats).');
      }
      const name = encoder.encode(path);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // nombres UTF-8
      local.setUint16(8, method, true);
      local.setUint16(10, this.dosTime, true);
      local.setUint16(12, this.dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, csize, true);
      local.setUint32(22, size, true);
      local.setUint16(26, name.length, true);

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

      this.parts.push(local.buffer, name, data);
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

  function isReady() {
    const wa = getWA();
    return !!(wa && wa.Chat.getModelsArray().length > 0);
  }

  async function waitForWA(timeoutMs = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (isReady()) return getWA();
      await sleep(1000);
    }
    throw new Error(
      'No se pudo acceder a los datos de WhatsApp Web. Verifica que la sesión esté iniciada y la ' +
        'lista de chats cargada. Si ya lo esta, WhatsApp pudo cambiar sus módulos internos (MODULES en exporter.js).'
    );
  }

  function getMeJid(wa) {
    try {
      const u = wa.meUser;
      return wid((u && (u.getMaybeMePnUser?.() || u.getMaybeMeUser?.() || u.getMeUser?.())) || null);
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
              (G.getName && G.getName(c)) || c.name || c.verifiedName ||
              (G.getPushname && G.getPushname(c)) || c.pushname || c.notifyName || '';
          } catch {
            name = c.name || c.pushname || '';
          }
          if (!name && c.phoneNumber) name = `+${jidUser(wid(c.phoneNumber))}`;
        }
        cache.set(jid, name);
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

  function chatName(chat, nameOf) {
    let name = '';
    try {
      name = chat.formattedTitle || chat.name || '';
    } catch {
      name = chat.name || '';
    }
    return name || nameOf(wid(chat.id));
  }

  function chatInfo(chat, nameOf) {
    const id = wid(chat.id);
    const info = {
      id,
      name: chatName(chat, nameOf),
      kind: chatKind(id),
      archived: !!chat.archive,
      pinned: !!chat.pin,
      last_activity: isoLocal(chat.t),
    };
    if (info.kind === 'group') {
      try {
        const meta = chat.groupMetadata;
        if (meta?.desc) info.description = meta.desc;
        const parts = meta?.participants?.getModelsArray?.() || [];
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

  /** Normaliza un mensaje al formato de exportación. Devuelve null si se omite. */
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
    const out = {
      id: wid(id),
      timestamp: s.t || 0,
      datetime: isoLocal(s.t),
      from_me: fromMe,
      sender_id: senderId,
      sender_name: fromMe ? ctx.options.meName : ctx.nameOf(senderId, s.notifyName || s.pushname),
      type,
      text,
    };

    if (s.quotedStanzaID) {
      out.quoted_id = s.quotedStanzaID;
      const qp = wid(s.quotedParticipant);
      if (qp) out.quoted_sender = qp === ctx.meJid ? ctx.options.meName : ctx.nameOf(qp);
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

  // ------------------------------------------------------------------
  // Formatos de salida
  // ------------------------------------------------------------------

  const CSV_HEADER = [
    'chat_id', 'chat_name', 'chat_type', 'message_id', 'datetime', 'timestamp',
    'sender_name', 'sender_id', 'from_me', 'type', 'text', 'quoted_sender',
    'quoted_text', 'forwarded', 'starred', 'media_mimetype', 'media_filename',
    'latitude', 'longitude',
  ];
  const CSV_HEADER_BYTES = encoder.encode('﻿' + csvRow(CSV_HEADER));

  function messageCsvRow(chat, m) {
    return csvRow([
      chat.id, chat.name, chat.kind, m.id, m.datetime, m.timestamp, m.sender_name,
      m.sender_id, m.from_me ? 1 : 0, m.type, m.text, m.quoted_sender || '',
      m.quoted_text || '', m.forwarded ? 1 : 0, m.starred ? 1 : 0,
      m.media?.mimetype || '', m.media?.filename || '', m.location?.lat ?? '',
      m.location?.lng ?? '',
    ]);
  }

  const KIND_LABEL = { individual: 'chat individual', group: 'grupo', channel: 'canal', broadcast: 'difusión' };
  const MEDIA_LABEL = {
    image: 'imagen', video: 'video', gif: 'gif', ptv: 'video', audio: 'audio',
    ptt: 'nota de voz', sticker: 'sticker', document: 'documento',
  };

  const trunc = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  function transcriptBody(m) {
    const parts = [];
    if (m.forwarded) parts.push('[reenviado]');
    if (m.quoted_id) {
      const who = m.quoted_sender || 'mensaje';
      parts.push(m.quoted_text ? `[responde a ${who}: "${trunc(m.quoted_text.replace(/\s+/g, ' '), 80)}"]` : `[responde a ${who}]`);
    }
    if (m.media) {
      let label = MEDIA_LABEL[m.type] || 'archivo';
      if (m.media.filename) label += `: ${m.media.filename}`;
      else if (m.media.duration && (m.type === 'ptt' || m.type === 'audio' || m.type === 'video')) label += ` ${m.media.duration}s`;
      parts.push(`[${label}]`);
    } else if (m.type === 'location') {
      parts.push(m.location ? `[ubicación ${m.location.lat},${m.location.lng}]` : '[ubicación]');
    } else if (m.type === 'vcard' || m.type === 'multi_vcard') {
      parts.push('[contacto]');
    } else if (m.type === 'poll_creation') {
      parts.push(`[encuesta${m.poll_options ? `: ${m.poll_options.join(' / ')}` : ''}]`);
    } else if (m.type !== 'chat' && !m.text) {
      parts.push(`[${m.type}]`);
    }
    if (m.text) parts.push(m.text.replace(/\r?\n/g, '\n    '));
    return parts.join(' ');
  }

  /** Transcripción compacta: la forma con menos tokens para que Claude la lea. */
  function transcript(info, msgs, exportedAt) {
    const head = [`Chat: ${info.name} (${KIND_LABEL[info.kind] || info.kind})`];
    if (info.participants?.length) {
      head.push(`Participantes (${info.participants.length}): ${info.participants.map((p) => p.name).join(', ')}`);
    }
    if (msgs.length) {
      head.push(`Mensajes: ${msgs.length}, del ${msgs[0].datetime.slice(0, 10)} al ${msgs[msgs.length - 1].datetime.slice(0, 10)}`);
    } else {
      head.push('Mensajes: 0');
    }
    head.push(`Exportado: ${exportedAt}`);
    const out = [head.join('\n')];
    let day = '';
    for (const m of msgs) {
      const d = m.datetime.slice(0, 10);
      if (d !== day) {
        out.push(`\n--- ${d} ---`);
        day = d;
      }
      out.push(`[${m.datetime.slice(11, 16)}] ${m.sender_name}: ${transcriptBody(m)}`);
    }
    return out.join('\n') + '\n';
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
      return await withTimeout(Promise.resolve(fn(chat)), timeoutMs, 'cargar historial'); // firma antigua
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
   * Devuelve { list, warning }: modelos con t > cutoff en orden cronologico,
   * cargando historial anterior mientras haga falta. Costo lineal: solo
   * procesa los lotes nuevos en cada vuelta.
   */
  async function collectMessages(wa, chat, opts, cutoff, onProgress) {
    const byId = new Map();
    let oldest = Infinity;
    let warning = '';
    const addAll = (arr) => {
      for (const m of arr) {
        if (!m) continue;
        const k = wid(m.id);
        if (!k || byId.has(k)) continue;
        byId.set(k, m);
        if (m.t && m.t < oldest) oldest = m.t;
      }
    };

    addAll(currentModels(chat));
    onProgress(byId.size);

    if (opts.loadFullHistory) {
      let stalls = 0;
      while (!run.cancelRequested) {
        if (noEarlier(chat)) break;
        if (cutoff && oldest <= cutoff) break;
        if (opts.maxPerChat > 0 && byId.size >= opts.maxPerChat) break;

        const before = byId.size;
        let loaded;
        try {
          loaded = await loadEarlier(wa, chat, opts.loadTimeoutMs);
        } catch (e) {
          warning = `historial incompleto: ${e.message}`;
          break;
        }
        if (Array.isArray(loaded)) {
          if (!loaded.length) break;
          addAll(loaded);
        } else {
          addAll(currentModels(chat));
        }
        onProgress(byId.size);

        if (byId.size === before) {
          if (++stalls >= opts.maxStalls) break;
        } else {
          stalls = 0;
        }
        if (opts.delayMs > 0) await sleep(opts.delayMs);
      }
      addAll(currentModels(chat));
    }

    let list = [...byId.values()];
    if (cutoff) list = list.filter((m) => (m.t || 0) > cutoff);
    list.sort((a, b) => (a.t || 0) - (b.t || 0));
    if (opts.maxPerChat > 0 && list.length > opts.maxPerChat) list = list.slice(-opts.maxPerChat);
    return { list, warning };
  }

  // ------------------------------------------------------------------
  // Estado de la corrida y notificaciones
  // ------------------------------------------------------------------

  const run = {
    status: 'idle', // idle | running | done | error | cancelled
    phase: '',
    total: 0,
    done: 0,
    messagesTotal: 0,
    active: new Map(), // id -> { name, count }
    recent: [],
    errors: [],
    startedAt: 0,
    finishedAt: 0,
    error: '',
    fileName: '',
    fileSize: 0,
    cancelRequested: false,
  };

  function publicState() {
    return {
      status: run.status,
      phase: run.phase,
      total: run.total,
      done: run.done,
      messagesTotal: run.messagesTotal,
      active: [...run.active.values()].map((a) => ({ name: a.name, count: a.count })),
      recent: run.recent.slice(0, 15),
      errors: run.errors.slice(0, 50),
      errorCount: run.errors.length,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      now: Date.now(),
      error: run.error,
      fileName: run.fileName,
      fileSize: run.fileSize,
    };
  }

  let lastPost = 0;
  let pendingPost = null;

  function emit(force = false) {
    const send = () => {
      lastPost = Date.now();
      pendingPost = null;
      const s = publicState();
      window.postMessage({ source: SRC_PAGE, type: 'state', state: s }, location.origin);
      overlay.render(s);
    };
    const wait = 300 - (Date.now() - lastPost);
    if (force || wait <= 0) {
      if (pendingPost) clearTimeout(pendingPost);
      send();
    } else if (!pendingPost) {
      pendingPost = setTimeout(send, wait);
    }
  }

  function requestCancel() {
    if (run.status !== 'running') return;
    run.cancelRequested = true;
    run.phase = 'Cancelando: se descargará lo exportado hasta ahora';
    emit(true);
  }

  // ------------------------------------------------------------------
  // Panel flotante dentro de WhatsApp Web (Shadow DOM, sin innerHTML)
  // ------------------------------------------------------------------

  const OVERLAY_CSS = `
    :host { all: initial; }
    .card, .pill { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      font: 13px/1.38 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "Segoe UI", system-ui, sans-serif;
      letter-spacing: -.006em; -webkit-font-smoothing: antialiased; color: #000;
      background: rgba(255, 255, 255, .78);
      -webkit-backdrop-filter: saturate(180%) blur(30px); backdrop-filter: saturate(180%) blur(30px);
      box-shadow: 0 12px 40px rgba(0, 0, 0, .16), 0 0 0 .5px rgba(0, 0, 0, .12); }
    .card { width: 300px; border-radius: 16px; padding: 14px 16px 14px; }
    .row { display: flex; align-items: center; gap: 8px; }
    .title { font-weight: 600; flex: 1; }
    .icon-btn { width: 22px; height: 22px; border-radius: 50%; border: 0; cursor: pointer; display: grid; place-items: center;
      background: rgba(120, 120, 128, .16); color: rgba(60, 60, 67, .7); font: 600 13px/1 system-ui, sans-serif; padding: 0; }
    .icon-btn:hover { background: rgba(120, 120, 128, .26); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #34c759; flex: none; }
    .running .dot { background: #007aff; animation: pulse 1.4s ease-in-out infinite; }
    .error .dot, .cancelled .dot { background: #ff9500; animation: none; }
    @keyframes pulse { 50% { opacity: .3; } }
    .track { height: 4px; background: rgba(120, 120, 128, .2); border-radius: 2px; overflow: hidden; margin: 12px 0 10px; }
    .fill { height: 100%; width: 0; background: #007aff; border-radius: 2px; transition: width .4s cubic-bezier(.3, .7, .4, 1); }
    .done .fill { background: #34c759; }
    .main { font-variant-numeric: tabular-nums; }
    .sub { color: rgba(60, 60, 67, .6); font-size: 12px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .actions { margin-top: 12px; display: flex; }
    .btn { flex: 1; font: inherit; font-weight: 600; border: 0; border-radius: 10px; padding: 7px 12px; cursor: pointer;
      background: rgba(120, 120, 128, .14); color: #ff3b30; }
    .btn:hover { background: rgba(120, 120, 128, .22); }
    .pill { display: none; align-items: center; gap: 8px; border-radius: 20px; padding: 8px 14px; cursor: pointer;
      font-weight: 600; font-size: 12px; font-variant-numeric: tabular-nums; }
    .min .card { display: none; }
    .min .pill { display: flex; }
    .hidden { display: none !important; }
    @media (prefers-color-scheme: dark) {
      .card, .pill { color: #fff; background: rgba(30, 30, 32, .74); box-shadow: 0 12px 40px rgba(0, 0, 0, .5), 0 0 0 .5px rgba(255, 255, 255, .12); }
      .icon-btn { background: rgba(120, 120, 128, .32); color: rgba(235, 235, 245, .7); }
      .track { background: rgba(120, 120, 128, .36); }
      .running .dot, .fill { background: #0a84ff; }
      .done .fill, .dot { background: #30d158; }
      .sub { color: rgba(235, 235, 245, .6); }
      .btn { background: rgba(120, 120, 128, .28); color: #ff453a; }
    }
    @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }`;

  const overlay = (() => {
    let host = null;
    let wrap = null;
    let els = null;
    let dismissed = false;
    let lastStatus = '';

    function el(tag, cls, text) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text) e.textContent = text;
      return e;
    }

    function build() {
      host = document.createElement('div');
      host.id = 'wanalisis-overlay';
      const shadow = host.attachShadow({ mode: 'open' });
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(OVERLAY_CSS);
        shadow.adoptedStyleSheets = [sheet];
      } catch {
        shadow.append(el('style', '', OVERLAY_CSS));
      }
      wrap = el('div', 'wrap');
      const card = el('div', 'card');
      const head = el('div', 'row');
      const dot = el('span', 'dot');
      const title = el('span', 'title', 'Exportando chats');
      const min = el('button', 'icon-btn', '−');
      min.title = 'Minimizar';
      min.addEventListener('click', () => wrap.classList.add('min'));
      const close = el('button', 'icon-btn', '×');
      close.title = 'Ocultar';
      close.addEventListener('click', () => {
        dismissed = true;
        host.classList.add('hidden');
        wrap.classList.add('hidden');
      });
      head.append(dot, title, min, close);
      const track = el('div', 'track');
      const fill = el('div', 'fill');
      track.append(fill);
      const main = el('div', 'main');
      const sub = el('div', 'sub');
      const actions = el('div', 'actions');
      const cancel = el('button', 'btn', 'Cancelar');
      cancel.addEventListener('click', requestCancel);
      actions.append(cancel);
      card.append(head, track, main, sub, actions);
      const pill = el('div', 'pill');
      const pillDot = el('span', 'dot');
      const pillText = el('span', '', '');
      pill.append(pillDot, pillText);
      pill.addEventListener('click', () => wrap.classList.remove('min'));
      wrap.append(card, pill);
      shadow.append(wrap);
      document.body.append(host);
      els = { title, fill, main, sub, cancel, pillText, close };
    }

    function render(s) {
      if (s.status === 'idle') return;
      if (s.status === 'running' && lastStatus !== 'running') dismissed = false; // nueva corrida
      lastStatus = s.status;
      if (dismissed) return;
      if (!host) build();
      host.classList.remove('hidden');
      wrap.classList.remove('hidden');
      wrap.className = wrap.className.replace(/\b(running|done|error|cancelled)\b/g, '').trim() + ` ${s.status}`;

      const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
      els.fill.style.width = `${s.status === 'done' ? 100 : pct}%`;
      els.cancel.classList.toggle('hidden', s.status !== 'running');
      const msgs = s.messagesTotal.toLocaleString('es');

      if (s.status === 'running') {
        els.title.textContent = 'Exportando chats';
        els.main.textContent = s.total ? `${s.done} de ${s.total} chats, ${msgs} mensajes` : s.phase;
        const act = s.active[0];
        els.sub.textContent = act ? `${act.name}: ${act.count.toLocaleString('es')} mensajes cargados` : s.phase;
        els.pillText.textContent = `${pct}%, ${msgs} mensajes`;
      } else if (s.status === 'done') {
        els.title.textContent = 'Exportación lista';
        els.main.textContent = `${msgs} mensajes de ${s.total} chats`;
        els.sub.textContent = s.fileName;
        els.pillText.textContent = 'Exportación lista';
        wrap.classList.remove('min');
      } else {
        els.title.textContent = s.status === 'cancelled' ? 'Exportación cancelada' : 'Error al exportar';
        els.main.textContent = s.error || '';
        els.sub.textContent = s.fileName ? `Parcial: ${s.fileName}` : '';
        els.pillText.textContent = els.title.textContent;
        wrap.classList.remove('min');
      }
    }

    return { render };
  })();

  // ------------------------------------------------------------------
  // Exportación
  // ------------------------------------------------------------------

  function normalizeLastRun(raw) {
    if (!raw || typeof raw !== 'object') return { at: 0, chats: {} };
    return raw.chats && typeof raw.chats === 'object' ? { at: raw.at || 0, chats: raw.chats } : { at: 0, chats: raw };
  }

  /** Envia el registro de la ultima exportacion al puente, que lo guarda en la extension. */
  function saveLastRun(data) {
    window.postMessage({ source: SRC_PAGE, type: 'lastRun', data }, location.origin);
  }

  /** Migra y borra el registro que versiones anteriores dejaban en el localStorage de WhatsApp Web. */
  function migrateLegacyLastRun() {
    try {
      const raw = localStorage.getItem(LEGACY_LAST_RUN_KEY);
      if (raw === null) return;
      localStorage.removeItem(LEGACY_LAST_RUN_KEY);
      saveLastRun(normalizeLastRun(JSON.parse(raw)));
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

  function selectChats(wa, nameOf, opts) {
    const wanted = Array.isArray(opts.chatIds) ? new Set(opts.chatIds) : null;
    const filter = (opts.nameFilter || '').trim().toLowerCase();
    const days = Math.max(0, Number(opts.activityDays) || 0);
    const activeSince = days ? Math.floor(Date.now() / 1000) - days * 86400 : 0;
    const chats = wa.Chat.getModelsArray().filter((chat) => {
      const id = wid(chat.id);
      const kind = chatKind(id);
      if (kind === 'broadcast' || kind === 'channel') return false;
      // Estos dos filtros aplican siempre, tambien sobre una seleccion explicita.
      if (kind === 'group' && !opts.includeGroups) return false;
      if (activeSince && (chat.t || 0) < activeSince) return false;
      if (wanted) return wanted.has(id);
      if (kind === 'individual' && !opts.includeIndividuals) return false;
      if (chat.archive && !opts.includeArchived) return false;
      if (filter && !chatName(chat, nameOf).toLowerCase().includes(filter)) return false;
      return true;
    });
    return chats.sort((a, b) => (b.t || 0) - (a.t || 0));
  }

  function listChats() {
    const wa = getWA();
    if (!wa || !wa.Chat.getModelsArray().length) return { ready: false };
    const nameOf = makeNameResolver(wa);
    const chats = selectChats(wa, nameOf, { ...DEFAULT_OPTIONS, chatIds: null }).map((chat) => {
      const id = wid(chat.id);
      let unread = 0;
      try {
        unread = chat.unreadCount > 0 ? chat.unreadCount : 0;
      } catch {
        /* opcional */
      }
      return {
        id,
        name: chatName(chat, nameOf),
        kind: chatKind(id),
        archived: !!chat.archive,
        pinned: !!chat.pin,
        t: chat.t || 0,
        unread,
      };
    });
    return { ready: true, account: getMeJid(wa), chats };
  }

  async function runExport(userOptions) {
    if (run.status === 'running') return { ok: false, error: 'Ya hay una exportación en curso.' };
    const opts = { ...DEFAULT_OPTIONS, ...(userOptions || {}) };
    opts.maxPerChat = Math.max(0, parseInt(opts.maxPerChat, 10) || 0);
    opts.delayMs = Math.max(0, parseInt(opts.delayMs, 10) || 0);
    opts.concurrency = Math.min(6, Math.max(1, parseInt(opts.concurrency, 10) || 1));
    const formats = new Set(Array.isArray(opts.formats) && opts.formats.length ? opts.formats : DEFAULT_OPTIONS.formats);

    Object.assign(run, {
      status: 'running',
      phase: 'Conectando con WhatsApp Web',
      total: 0,
      done: 0,
      messagesTotal: 0,
      active: new Map(),
      recent: [],
      errors: [],
      startedAt: Date.now(),
      finishedAt: 0,
      error: '',
      fileName: '',
      fileSize: 0,
      cancelRequested: false,
    });
    emit(true);
    exportLoop(opts, formats).catch(() => {}); // corre en segundo plano
    return { ok: true };
  }

  async function exportLoop(opts, formats) {
    const zip = new ZipWriter();
    const combined = formats.has('csv') ? new DeflateSink() : null;
    const exportedAt = isoLocal(Date.now() / 1000);
    const last = normalizeLastRun(opts.lastRun);
    delete opts.lastRun; // no se copia al index.json
    const newLast = { at: Math.floor(Date.now() / 1000), chats: { ...last.chats } };
    const index = [];
    let meJid = '';

    try {
      if (combined) await combined.write(CSV_HEADER_BYTES);
      const wa = await waitForWA();
      const nameOf = makeNameResolver(wa);
      meJid = getMeJid(wa);
      const ctx = { options: opts, nameOf, meJid };
      const sinceT = parseSince(opts.since);
      const chats = selectChats(wa, nameOf, opts);

      // Nombres de archivo unicos, asignados antes de paralelizar.
      const used = new Set();
      const jobs = chats.map((chat, i) => {
        const id = wid(chat.id);
        let base = `${slug(chatName(chat, nameOf))}__${jidUser(id)}`;
        while (used.has(base)) base += '_';
        used.add(base);
        return { chat, id, base, i };
      });

      run.total = jobs.length;
      run.phase = opts.loadFullHistory ? 'Cargando historial' : 'Leyendo mensajes';
      emit(true);

      const processJob = async ({ chat, id, base, i }) => {
        let info;
        try {
          info = chatInfo(chat, nameOf);
        } catch {
          info = { id, name: id, kind: chatKind(id) };
        }
        const t0 = Date.now();
        const live = { name: info.name, count: 0 };
        run.active.set(id, live);
        emit();

        const cutoff = Math.max(sinceT, opts.onlyNew ? last.chats[id] || 0 : 0);
        const entry = {
          id, name: info.name, kind: info.kind, archived: !!info.archived,
          message_count: 0, first_message: null, last_message: null, files: {},
        };
        index[i] = entry;

        // Atajo: nada nuevo desde el corte, no hace falta cargar historial.
        if (cutoff && (chat.t || 0) <= cutoff) {
          entry.skipped = 'sin mensajes nuevos';
          run.active.delete(id);
          run.done++;
          emit();
          return;
        }

        let normalized = [];
        try {
          const { list: models, warning } = await collectMessages(wa, chat, opts, cutoff, (n) => {
            live.count = n;
            emit();
          });
          if (warning) {
            entry.error = warning;
            run.errors.push({ name: info.name, error: warning });
          }
          for (const m of models) {
            try {
              const n = normalizeMessage(m, ctx);
              if (n) normalized.push(n);
            } catch {
              /* mensaje ilegible: se omite */
            }
          }
        } catch (e) {
          entry.error = e.message || String(e);
          run.errors.push({ name: info.name, error: entry.error });
        }

        const first = normalized[0];
        const lastMsg = normalized[normalized.length - 1];
        entry.message_count = normalized.length;
        entry.first_message = first ? first.datetime : null;
        entry.last_message = lastMsg ? lastMsg.datetime : null;
        if (lastMsg && !entry.error) newLast.chats[id] = Math.max(newLast.chats[id] || 0, lastMsg.timestamp);

        if (normalized.length || !opts.onlyNew) {
          if (formats.has('json')) {
            entry.files.json = `json/${base}.json`;
            await zip.add(
              entry.files.json,
              JSON.stringify({ chat: info, exported_at: exportedAt, message_count: normalized.length, messages: normalized })
            );
          }
          if (formats.has('csv')) {
            entry.files.csv = `csv/${base}.csv`;
            let rows = '';
            for (const m of normalized) rows += messageCsvRow(info, m);
            const bytes = encoder.encode(rows);
            await zip.add(entry.files.csv, [CSV_HEADER_BYTES, bytes]);
            await combined.write(bytes);
          }
          if (formats.has('txt')) {
            entry.files.txt = `txt/${base}.txt`;
            await zip.add(entry.files.txt, transcript(info, normalized, exportedAt));
          }
        }

        run.messagesTotal += normalized.length;
        run.active.delete(id);
        run.done++;
        run.recent.unshift({ name: info.name, count: normalized.length, ms: Date.now() - t0, error: !!entry.error });
        if (run.recent.length > 15) run.recent.length = 15;
        emit();
      };

      let next = 0;
      const worker = async () => {
        while (!run.cancelRequested && next < jobs.length) await processJob(jobs[next++]);
      };
      await Promise.all(Array.from({ length: Math.min(opts.concurrency, jobs.length) }, worker));

      run.phase = 'Generando ZIP';
      emit(true);
      const finalIndex = index.filter(Boolean);
      if (combined) zip.addPrepared('todos_los_mensajes.csv', await combined.close());
      await zip.add(
        'index.json',
        JSON.stringify(
          {
            exported_at: exportedAt,
            tool: 'WAnalisis Chrome extension',
            account: meJid || null,
            options: { ...opts, formats: [...formats] },
            complete: !run.cancelRequested,
            chat_count: finalIndex.length,
            message_count: run.messagesTotal,
            chats: finalIndex,
          },
          null,
          2
        )
      );
      await zip.add('LEEME.txt', readme(formats));

      const fileName = `whatsapp-export-${stamp()}${run.cancelRequested ? '-parcial' : ''}.zip`;
      const blob = zip.finish();
      download(blob, fileName);
      if (!run.cancelRequested) saveLastRun(newLast);
      Object.assign(run, {
        status: run.cancelRequested ? 'cancelled' : 'done',
        error: run.cancelRequested ? 'Cancelada por el usuario.' : '',
        phase: '',
        fileName,
        fileSize: blob.size,
      });
    } catch (e) {
      run.status = 'error';
      run.error = e.message || String(e);
      const partial = index.filter(Boolean);
      if (partial.length) {
        try {
          await zip.add('index.json', JSON.stringify({ complete: false, error: run.error, chats: partial }, null, 2));
          const fileName = `whatsapp-export-${stamp()}-parcial.zip`;
          const blob = zip.finish();
          download(blob, fileName);
          run.fileName = fileName;
          run.fileSize = blob.size;
        } catch {
          /* nada más que hacer */
        }
      }
    } finally {
      run.finishedAt = Date.now();
      run.active.clear();
      run.cancelRequested = false;
      emit(true);
    }
  }

  function readme(formats) {
    const lines = [
      'Exportación de chats de WhatsApp Web (WAnalisis)',
      '',
      'Contenido:',
      '  index.json               Lista de chats con conteo de mensajes, fechas y rutas de archivos.',
    ];
    if (formats.has('txt')) lines.push('  txt/<chat>.txt           Transcripción legible por chat. Es el formato con menos tokens para Claude.');
    if (formats.has('json')) lines.push('  json/<chat>.json         Un archivo por chat: metadatos del chat y lista de mensajes.');
    if (formats.has('csv')) {
      lines.push('  csv/<chat>.csv           Un archivo por chat (UTF-8 con BOM, compatible con Excel).');
      lines.push('  todos_los_mensajes.csv   Todos los mensajes de todos los chats en una sola tabla.');
    }
    lines.push(
      '',
      'Campos de cada mensaje (JSON/CSV):',
      '  datetime     Fecha y hora local (ISO 8601).',
      '  timestamp    Segundos Unix.',
      '  sender_name  Remitente (tu nombre configurado si from_me = true).',
      '  type         chat (texto), image, video, audio, ptt (nota de voz), document, sticker, location, ...',
      '  text         Texto o pie de foto. Los archivos multimedia no se incluyen, solo sus metadatos.',
      '  quoted_*     Mensaje al que se respondió, si aplica.',
      '',
      'Sugerencias para Claude:',
      '  - Para leer conversaciones, sube los .txt de los chats que te interesen.',
      '  - Para análisis cuantitativo (quien escribe más, horarios, tendencias), usa todos_los_mensajes.csv.',
      '  - index.json da el panorama general para decidir que chats revisar.',
      ''
    );
    return lines.join('\r\n');
  }

  // ------------------------------------------------------------------
  // Mensajeria con la extension (RPC via window.postMessage)
  // ------------------------------------------------------------------

  const RPC = {
    status: () => {
      migrateLegacyLastRun();
      return { ready: isReady(), state: publicState() };
    },
    listChats: () => listChats(),
    start: (params) => runExport(params?.options),
    cancel: () => {
      requestCancel();
      return { ok: true };
    },
  };

  window.addEventListener('message', async (e) => {
    if (e.source !== window || !e.data || e.data.source !== SRC_EXT || e.data.type !== 'rpc') return;
    const { id, method, params } = e.data;
    let result;
    try {
      if (!RPC[method]) throw new Error(`Método desconocido: ${method}`);
      result = await RPC[method](params);
    } catch (err) {
      result = { error: err.message || String(err) };
    }
    window.postMessage({ source: SRC_PAGE, type: 'rpc-result', id, result }, location.origin);
  });

  window.__WAExport = {
    start: runExport,
    cancel: requestCancel,
    getState: publicState,
    listChats,
    _internals: { ZipWriter, DeflateSink, crc32Update, csvRow, slug, wid, isoLocal, normalizeMessage, transcript, MODULES },
  };
})();
