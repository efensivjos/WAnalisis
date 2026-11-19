/* Panel lateral de WAnalisis: seleccion de chats, configuracion, progreso y resultado. */

const WA_URL = 'https://web.whatsapp.com/';
const STORAGE_KEY = 'wa-export-options-v2';
const LAST_RUN_KEY = 'wa-export-last-run';
const PAGE_SIZE = 200;
const SPEEDS = {
  careful: { concurrency: 1, delayMs: 400 },
  normal: { concurrency: 2, delayMs: 150 },
  fast: { concurrency: 4, delayMs: 0 },
};

// ------------------------------------------------------------------
// Textos (ingles por defecto, espanol opcional)
// ------------------------------------------------------------------

const I18N = {
  en: {
    locale: 'en-US',
    me: 'Me',
    chats: 'Chats',
    search: 'Search',
    searchChat: 'Search chats',
    chatType: 'Chat type',
    kindAll: 'All',
    kindPeople: 'People',
    kindGroups: 'Groups',
    kindArchived: 'Archived',
    settings: 'Settings',
    language: 'Language',
    format: 'Format',
    period: 'Period',
    periodAll: 'All history',
    periodSince: 'Since a date',
    periodNew: 'Only new',
    messagesFrom: 'Messages from',
    advancedSettings: 'Advanced settings',
    filters: 'Filters',
    includeGroups: 'Include groups',
    lastMessage: 'Last message',
    actAny: 'Any date',
    actDay: 'Last day',
    actWeek: 'Last week',
    actMonth: 'Last month',
    act3Months: 'Last 3 months',
    actDate: 'Specific date',
    onOrAfter: 'On or after',
    chooseDate: 'Choose date',
    refreshList: 'Refresh chat list',
    privacyNote: 'Everything is processed on your computer. The extension never connects to the internet.',
    exporting: 'Exporting',
    statMessages: 'Messages',
    statRate: 'Messages per second',
    statElapsed: 'Elapsed time',
    statRemaining: 'Time remaining',
    statChats: 'Chats',
    statDuration: 'Duration',
    loadingNow: 'Loading now',
    finished: 'Finished',
    keepOpen: 'You can keep using the browser. Leave the WhatsApp Web tab open until it finishes.',
    nextStep: 'Next step with Claude',
    nextStepText: (f) =>
      `Unzip the file. Upload the ${f.has('txt') ? '.txt' : f.has('json') ? '.json' : '.csv'} files of the chats you want to analyze${f.has('csv') ? ', or all_messages.csv for a global analysis' : ''}. index.json summarizes every chat.`,
    done: 'Done',
    speed: 'Speed',
    speedCareful: 'Careful',
    speedNormal: 'Normal',
    speedFast: 'Fast',
    speedHint: {
      careful: 'One chat at a time with pauses. For very large accounts or slow connections.',
      normal: 'Two chats in parallel. Recommended.',
      fast: 'Four chats in parallel, no pauses. Faster, but more load on your phone.',
    },
    exportSection: 'Export',
    yourName: 'Your name',
    maxPerChat: 'Max per chat',
    noLimit: 'No limit',
    systemMessages: 'System messages',
    onlyLoaded: 'Only loaded messages',
    moreInfo: 'More information',
    tipLanguage: 'Language of this panel and of the readable export files (TXT transcripts and the README).',
    tipFormat: 'JSON: structured data per message. TXT: readable transcript that uses the fewest tokens in Claude. CSV: a table for Excel. You can pick several.',
    tipPeriod: 'Which messages are exported from each chat: the whole history, only messages since a date, or only messages received after your last complete export ("Only new" becomes available after the first one).',
    tipIncludeGroups: 'Turn off to leave every group out of the list and the export.',
    tipLastMessage: 'Date of the last message sent or received in each conversation. Only chats whose last message falls within the selected range are included. It does not trim the messages inside each chat; use Period for that.',
    tipActivityDate: 'Includes only chats whose last message, sent or received, is on this date or later.',
    tipSpeed: 'How many chats are loaded at the same time. Fast finishes sooner but puts more load on the linked phone.',
    tipYourName: 'How you appear as the sender in the exported files.',
    tipMaxPerChat: 'Exports only the N most recent messages of each chat. Leave empty for no limit.',
    tipSystem: 'Encryption notices, group changes, calls and deleted messages.',
    tipOnlyLoaded: 'Does not ask WhatsApp for older history: exports only what is already loaded. Faster, but it may be incomplete.',
    conn: {
      connecting: 'Connecting',
      noTab: 'WhatsApp Web is not open',
      inactive: 'Extension not active in the tab',
      waiting: 'Waiting for WhatsApp Web',
      ok: 'Connected',
      okAs: (a) => `Connected: ${a}`,
      exporting: 'Exporting',
      error: 'Connection error',
      startFailed: (m) => `Could not start: ${m}`,
    },
    openWaTitle: 'Open WhatsApp Web',
    openWaText: 'Sign in to WhatsApp Web in a tab of this browser to export your chats.',
    openWaBtn: 'Open WhatsApp Web',
    reloadTitle: 'Reload WhatsApp Web',
    reloadText: 'The tab was opened before the extension was installed or updated. Reload it to activate the extension.',
    reloadBtn: 'Reload tab',
    waitingTitle: 'Waiting for your chats',
    waitingText: 'Sign in and wait until the chat list appears in WhatsApp Web.',
    listErrorTitle: 'Could not read the chat list',
    retry: 'Retry',
    selected: (n, total) => `${n} of ${total} selected`,
    selectAll: 'Select all',
    deselectAll: 'Deselect all',
    noMatches: 'No chats match.',
    noneInFilters: 'No chats match the last message and group filters.',
    chatLabel: (kind, archived) => (kind === 'group' ? (archived ? 'Archived group' : 'Group') : archived ? 'Archived chat' : 'Chat'),
    yesterday: 'Yesterday',
    newMessages: 'New messages since the last export',
    exportN: (n) => (n === 1 ? 'Export 1 chat' : `Export ${n} chats`),
    problemNoChats: 'No chats match the filters',
    problemSelect: 'Select at least one chat',
    problemFormat: 'Choose at least one format',
    problemSince: 'Choose the start date',
    problemActivity: 'Choose the last message date',
    newExport: 'New export',
    cancelExport: 'Cancel export',
    cancelling: 'Cancelling',
    lastExport: (d) => `Only messages after your last export (${d}).`,
    phase: {
      connecting: 'Connecting to WhatsApp Web',
      loading: 'Loading history',
      reading: 'Reading messages',
      zipping: 'Creating ZIP',
      cancelling: 'Cancelling: what is done so far will be downloaded',
      starting: 'Starting',
    },
    ofChats: (d, total) => `${d} of ${total} chats`,
    calculating: 'Calculating',
    warnings: (n) => (n === 1 ? '1 chat with warnings' : `${n} chats with warnings`),
    doneTitle: 'Export ready',
    cancelledTitle: 'Export cancelled',
    stoppedTitle: 'The export stopped',
    savedTo: 'The file was saved to your Downloads folder.',
    partialSaved: 'What was exported up to that point was downloaded.',
  },
  es: {
    locale: 'es-ES',
    me: 'Yo',
    chats: 'Chats',
    search: 'Buscar',
    searchChat: 'Buscar chat',
    chatType: 'Tipo de chat',
    kindAll: 'Todos',
    kindPeople: 'Personas',
    kindGroups: 'Grupos',
    kindArchived: 'Archivados',
    settings: 'Configuración',
    language: 'Idioma',
    format: 'Formato',
    period: 'Periodo',
    periodAll: 'Todo el historial',
    periodSince: 'Desde una fecha',
    periodNew: 'Solo lo nuevo',
    messagesFrom: 'Mensajes desde',
    advancedSettings: 'Configuración avanzada',
    filters: 'Filtros',
    includeGroups: 'Incluir grupos',
    lastMessage: 'Último mensaje',
    actAny: 'Cualquier fecha',
    actDay: 'Último día',
    actWeek: 'Última semana',
    actMonth: 'Último mes',
    act3Months: 'Últimos 3 meses',
    actDate: 'Fecha específica',
    onOrAfter: 'Desde el',
    chooseDate: 'Elegir fecha',
    refreshList: 'Actualizar lista de chats',
    privacyNote: 'Todo se procesa en tu equipo. La extensión no se conecta a internet.',
    exporting: 'Exportando',
    statMessages: 'Mensajes',
    statRate: 'Mensajes por segundo',
    statElapsed: 'Tiempo transcurrido',
    statRemaining: 'Tiempo restante',
    statChats: 'Chats',
    statDuration: 'Duración',
    loadingNow: 'Cargando ahora',
    finished: 'Terminados',
    keepOpen: 'Puedes seguir usando el navegador. Deja abierta la pestaña de WhatsApp Web hasta que termine.',
    nextStep: 'Siguiente paso con Claude',
    nextStepText: (f) =>
      `Descomprime el ZIP. Sube los archivos ${f.has('txt') ? '.txt' : f.has('json') ? '.json' : '.csv'} de los chats que quieras analizar${f.has('csv') ? ', o todos_los_mensajes.csv para un análisis global' : ''}. index.json resume todos los chats.`,
    done: 'Listo',
    speed: 'Velocidad',
    speedCareful: 'Cuidadosa',
    speedNormal: 'Normal',
    speedFast: 'Rápida',
    speedHint: {
      careful: 'Un chat a la vez con pausas. Para cuentas muy grandes o conexiones lentas.',
      normal: 'Dos chats en paralelo. Recomendado.',
      fast: 'Cuatro chats en paralelo sin pausas. Más rápido, más carga para el teléfono.',
    },
    exportSection: 'Exportación',
    yourName: 'Tu nombre',
    maxPerChat: 'Máximo por chat',
    noLimit: 'Sin límite',
    systemMessages: 'Mensajes de sistema',
    onlyLoaded: 'Solo mensajes ya cargados',
    moreInfo: 'Más información',
    tipLanguage: 'Idioma de este panel y de los archivos legibles de la exportación (transcripciones TXT y archivo de ayuda).',
    tipFormat: 'JSON: datos estructurados por mensaje. TXT: transcripción legible que usa menos tokens en Claude. CSV: tabla para Excel. Puedes elegir varios.',
    tipPeriod: 'Qué mensajes se exportan de cada chat: todo el historial, solo los mensajes desde una fecha, o solo los recibidos después de tu última exportación completa ("Solo lo nuevo" se habilita después de la primera).',
    tipIncludeGroups: 'Apágalo para dejar fuera todos los grupos de la lista y de la exportación.',
    tipLastMessage: 'Fecha del último mensaje enviado o recibido en cada conversación. Solo entran los chats cuyo último mensaje cae en el rango elegido. No recorta los mensajes dentro de cada chat; para eso usa Periodo.',
    tipActivityDate: 'Incluye solo los chats cuyo último mensaje, enviado o recibido, es de esta fecha o posterior.',
    tipSpeed: 'Cuántos chats se cargan al mismo tiempo. Rápida termina antes pero exige más al teléfono vinculado.',
    tipYourName: 'Cómo apareces como remitente en los archivos exportados.',
    tipMaxPerChat: 'Exporta solo los N mensajes más recientes de cada chat. Déjalo vacío para no tener límite.',
    tipSystem: 'Avisos de cifrado, cambios en grupos, llamadas y mensajes eliminados.',
    tipOnlyLoaded: 'No pide historial antiguo a WhatsApp: exporta solo lo que ya está cargado. Es más rápido, pero puede quedar incompleto.',
    conn: {
      connecting: 'Conectando',
      noTab: 'WhatsApp Web no está abierto',
      inactive: 'Extensión sin activar en la pestaña',
      waiting: 'Esperando a WhatsApp Web',
      ok: 'Conectado',
      okAs: (a) => `Conectado: ${a}`,
      exporting: 'Exportando',
      error: 'Error de conexión',
      startFailed: (m) => `No se pudo iniciar: ${m}`,
    },
    openWaTitle: 'Abre WhatsApp Web',
    openWaText: 'Inicia sesión en WhatsApp Web en una pestaña de este navegador para exportar tus chats.',
    openWaBtn: 'Abrir WhatsApp Web',
    reloadTitle: 'Recarga WhatsApp Web',
    reloadText: 'La pestaña se abrió antes de instalar o actualizar la extensión. Recárgala para activarla.',
    reloadBtn: 'Recargar pestaña',
    waitingTitle: 'Esperando tus chats',
    waitingText: 'Inicia sesión y espera a que aparezca la lista de chats en WhatsApp Web.',
    listErrorTitle: 'No se pudo leer la lista de chats',
    retry: 'Reintentar',
    selected: (n, total) => `${n} de ${total} ${total === 1 ? 'seleccionado' : 'seleccionados'}`,
    selectAll: 'Seleccionar todo',
    deselectAll: 'Deseleccionar todo',
    noMatches: 'No hay chats que coincidan.',
    noneInFilters: 'Ningún chat cumple los filtros de último mensaje y grupos.',
    chatLabel: (kind, archived) => (kind === 'group' ? (archived ? 'Grupo archivado' : 'Grupo') : archived ? 'Chat archivado' : 'Chat'),
    yesterday: 'Ayer',
    newMessages: 'Mensajes nuevos desde la última exportación',
    exportN: (n) => (n === 1 ? 'Exportar 1 chat' : `Exportar ${n} chats`),
    problemNoChats: 'Ningún chat cumple los filtros',
    problemSelect: 'Selecciona al menos un chat',
    problemFormat: 'Elige al menos un formato',
    problemSince: 'Elige la fecha de inicio',
    problemActivity: 'Elige la fecha del último mensaje',
    newExport: 'Nueva exportación',
    cancelExport: 'Cancelar exportación',
    cancelling: 'Cancelando',
    lastExport: (d) => `Solo mensajes posteriores a tu última exportación (${d}).`,
    phase: {
      connecting: 'Conectando con WhatsApp Web',
      loading: 'Cargando historial',
      reading: 'Leyendo mensajes',
      zipping: 'Generando ZIP',
      cancelling: 'Cancelando: se descargará lo exportado hasta ahora',
      starting: 'Iniciando',
    },
    ofChats: (d, total) => `${d} de ${total} chats`,
    calculating: 'Calculando',
    warnings: (n) => (n === 1 ? '1 chat con avisos' : `${n} chats con avisos`),
    doneTitle: 'Exportación lista',
    cancelledTitle: 'Exportación cancelada',
    stoppedTitle: 'La exportación se detuvo',
    savedTo: 'El archivo se guardó en tu carpeta de Descargas.',
    partialSaved: 'Se descargó lo exportado hasta ese momento.',
  },
};

let L = I18N.en;
const t = (key) => L[key] ?? I18N.en[key] ?? key;

const $ = (id) => document.getElementById(id);
const fmtNum = (n) => Number(n || 0).toLocaleString(L.locale);
const pad = (n) => String(n).padStart(2, '0');

/** Fecha: dia/mes/ano en espanol, mes/dia/ano en ingles. */
function fmtDate(d) {
  const dd = pad(d.getDate());
  const mm = pad(d.getMonth() + 1);
  return L === I18N.es ? `${dd}/${mm}/${d.getFullYear()}` : `${mm}/${dd}/${d.getFullYear()}`;
}

/** Hora: 24 h en espanol, 12 h en ingles. */
function fmtTime(d) {
  if (L === I18N.es) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getHours() % 12 || 12}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

const ui = {
  tab: null,
  chats: [],
  known: new Set(),
  selected: new Set(),
  filter: 'all',
  query: '',
  pool: [], // chats que pasan los filtros de grupos y fecha del ultimo mensaje
  visible: [],
  rendered: 0,
  lastExportAt: 0,
  lastRun: { at: 0, chats: {} },
  formatsUsed: new Set(['json']),
  view: '',
  state: null,
  ticker: null,
  retryTimer: null,
  conn: { kind: '', key: 'connecting', arg: null },
  connect: null,
};

// ------------------------------------------------------------------
// Idioma
// ------------------------------------------------------------------

function applyLanguage(lang) {
  L = I18N[lang] || I18N.en;
  document.documentElement.lang = L === I18N.es ? 'es' : 'en';
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) node.placeholder = t(node.dataset.i18nPlaceholder);
  for (const node of document.querySelectorAll('[data-i18n-title]')) node.title = t(node.dataset.i18nTitle);
  for (const node of document.querySelectorAll('[data-i18n-aria]')) node.setAttribute('aria-label', t(node.dataset.i18nAria));
  for (const node of document.querySelectorAll('.info')) node.setAttribute('aria-label', t('moreInfo'));
  $('meName').placeholder = L.me;
  renderConn();
  if (ui.connect) renderConnect();
  updatePeriodState();
  updateSpeedHint();
  renderDateFields();
  if (ui.chats.length) applyFilter();
  if (ui.view === 'progress' && ui.state) renderProgress(ui.state);
  else if (ui.view === 'done' && ui.state) renderDone(ui.state);
  else if (ui.view) show(ui.view);
}

// ------------------------------------------------------------------
// Comunicacion con la pestana de WhatsApp Web
// ------------------------------------------------------------------

async function findWaTab() {
  const tabs = await chrome.tabs.query({ url: `${WA_URL}*` });
  if (!tabs.length) return null;
  const win = await chrome.windows.getLastFocused().catch(() => null);
  return tabs.find((tb) => tb.active && win && tb.windowId === win.id) || tabs.find((tb) => tb.active) || tabs[0];
}

async function rpc(method, params) {
  if (!ui.tab) throw new Error('no tab');
  const res = await chrome.tabs.sendMessage(ui.tab.id, { target: 'wa-export', method, params });
  if (res && res.error) throw new Error(res.error);
  return res;
}

// ------------------------------------------------------------------
// Vistas
// ------------------------------------------------------------------

function show(view) {
  ui.view = view;
  for (const v of ['connect', 'select', 'progress', 'done']) $(`view-${v}`).hidden = v !== view;
  $('refresh').hidden = view !== 'select';
  $('open-options').hidden = view !== 'select';
  $('footer').hidden = view === 'connect';
  const primary = $('primary');
  const secondary = $('secondary');
  secondary.hidden = view !== 'progress';
  primary.hidden = view === 'progress';
  if (view === 'select') updateCta();
  if (view === 'progress' && !secondary.disabled) secondary.textContent = t('cancelExport');
  if (view === 'done') {
    primary.textContent = t('newExport');
    primary.disabled = false;
  }
}

function setView(view) {
  if (ui.view === view) return;
  show(view);
  $(`view-${view}`).scrollTop = 0;
  $('navbar').classList.remove('scrolled');
}

function setConn(kind, key, arg) {
  ui.conn = { kind, key, arg };
  renderConn();
}

function renderConn() {
  const c = ui.conn;
  const v = L.conn[c.key];
  $('conn').className = `conn ${c.kind}`;
  $('conn-text').textContent = typeof v === 'function' ? v(c.arg) : v || '';
}

function showConnect(titleKey, textOrKey, action) {
  ui.connect = { titleKey, textOrKey, action };
  renderConnect();
  setView('connect');
}

function renderConnect() {
  const c = ui.connect;
  $('connect-title').textContent = t(c.titleKey);
  $('connect-text').textContent = I18N.en[c.textOrKey] ? t(c.textOrKey) : c.textOrKey;
  const btn = $('connect-action');
  btn.hidden = !c.action;
  if (c.action) {
    btn.textContent = t(c.action.labelKey);
    btn.onclick = c.action.run;
  }
}

// ------------------------------------------------------------------
// Conexion
// ------------------------------------------------------------------

async function connect() {
  clearTimeout(ui.retryTimer);
  ui.tab = await findWaTab();
  if (!ui.tab) {
    setConn('bad', 'noTab');
    showConnect('openWaTitle', 'openWaText', { labelKey: 'openWaBtn', run: () => chrome.tabs.create({ url: WA_URL }) });
    return;
  }

  let status;
  try {
    status = await rpc('status');
  } catch {
    setConn('bad', 'inactive');
    showConnect('reloadTitle', 'reloadText', { labelKey: 'reloadBtn', run: () => chrome.tabs.reload(ui.tab.id) });
    return;
  }

  if (status.state && status.state.status === 'running') {
    renderProgress(status.state);
    return;
  }
  if (!status.ready) {
    setConn('busy', 'waiting');
    showConnect('waitingTitle', 'waitingText', null);
    ui.retryTimer = setTimeout(connect, 2000);
    return;
  }
  await loadChats();
}

async function loadChats() {
  $('refresh').classList.add('spin');
  try {
    const res = await rpc('listChats');
    if (!res.ready) {
      ui.retryTimer = setTimeout(connect, 2000);
      return;
    }
    ui.lastRun = (await chrome.storage.local.get(LAST_RUN_KEY))[LAST_RUN_KEY] || { at: 0, chats: {} };
    ui.lastExportAt = ui.lastRun.at || 0;
    ui.chats = res.chats.map((c) => {
      const lastT = ui.lastRun.chats[c.id] || 0;
      return { ...c, hasNew: lastT ? c.t > lastT : false };
    });
    for (const c of ui.chats) {
      if (!ui.known.has(c.id)) {
        ui.known.add(c.id);
        ui.selected.add(c.id); // los chats nuevos entran seleccionados
      }
    }
    const ids = new Set(ui.chats.map((c) => c.id));
    for (const id of [...ui.selected]) if (!ids.has(id)) ui.selected.delete(id);

    const acct = res.account ? `+${res.account.split('@')[0]}` : '';
    setConn('ok', acct ? 'okAs' : 'ok', acct);
    ui.connect = null;
    updatePeriodState();
    applyFilter();
    setView('select');
  } catch (e) {
    setConn('bad', 'error');
    showConnect('listErrorTitle', e.message, { labelKey: 'retry', run: connect });
  } finally {
    $('refresh').classList.remove('spin');
  }
}

// ------------------------------------------------------------------
// Lista de chats y filtros
// ------------------------------------------------------------------

function scope() {
  const act = $('activity').value;
  return {
    includeGroups: $('includeGroups').checked,
    activityMode: act,
    activityDays: act === 'date' ? 0 : Number(act) || 0,
    activitySince: act === 'date' ? $('activitySince').value || null : null,
  };
}

/** Filtros que definen que chats entran en la exportacion. */
function inScope(c, sc) {
  if (!sc.includeGroups && c.kind === 'group') return false;
  if (sc.activitySince) return c.t >= new Date(`${sc.activitySince}T00:00:00`).getTime() / 1000;
  if (sc.activityDays) return c.t >= Date.now() / 1000 - sc.activityDays * 86400;
  return true;
}

const selectedInPool = () => ui.pool.filter((c) => ui.selected.has(c.id));

function matchesFilter(c) {
  if (ui.filter === 'individual' && c.kind !== 'individual') return false;
  if (ui.filter === 'group' && c.kind !== 'group') return false;
  if (ui.filter === 'archived' && !c.archived) return false;
  return !ui.query || c.name.toLowerCase().includes(ui.query);
}

function applyFilter() {
  const sc = scope();
  $('activity-date-cell').hidden = sc.activityMode !== 'date';
  if (!sc.includeGroups && ui.filter === 'group') setKind('all');
  $('scope').querySelector('[data-kind="group"]').hidden = !sc.includeGroups;
  ui.pool = ui.chats.filter((c) => inScope(c, sc));
  ui.visible = ui.pool.filter(matchesFilter);
  ui.rendered = 0;
  $('list').textContent = '';
  $('list-empty').hidden = ui.visible.length > 0;
  $('list-empty').textContent = ui.pool.length ? t('noMatches') : t('noneInFilters');
  renderMore();
  updateSelectAll();
}

const sentinel = document.createElement('div');
sentinel.style.height = '1px';
const observer = new IntersectionObserver((entries) => {
  if (entries.some((e) => e.isIntersecting)) renderMore();
});

function renderMore() {
  const list = $('list');
  sentinel.remove();
  const frag = document.createDocumentFragment();
  const end = Math.min(ui.visible.length, ui.rendered + PAGE_SIZE);
  for (let i = ui.rendered; i < end; i++) frag.append(rowFor(ui.visible[i]));
  ui.rendered = end;
  list.append(frag);
  if (ui.rendered < ui.visible.length) {
    list.append(sentinel);
    observer.observe(sentinel);
  }
}

function initials(name) {
  const clean = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (!parts.length) return '#';
  return (parts[0][0] + (parts.length > 1 ? parts[1][0] : '')).toUpperCase();
}

/** Fecha corta al estilo de Mensajes: hora si es hoy, "Ayer", dia de la semana o fecha. */
function shortDate(unix) {
  if (!unix) return '';
  const d = new Date(unix * 1000);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return fmtTime(d);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return t('yesterday');
  if (now - d < 6 * 864e5) return d.toLocaleDateString(L.locale, { weekday: 'long' });
  return fmtDate(d);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== '') e.textContent = text;
  return e;
}

function svgIcon(id, cls) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (cls) s.setAttribute('class', cls);
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', `#${id}`);
  s.append(u);
  return s;
}

function rowFor(c) {
  const row = el('label', 'row');
  row.setAttribute('role', 'listitem');
  row.dataset.id = c.id;
  const input = el('input');
  input.type = 'checkbox';
  input.checked = ui.selected.has(c.id);
  input.setAttribute('aria-label', c.name);
  const circle = el('span', 'select-circle');
  circle.append(svgIcon('i-check'));
  const avatar = el('span', 'avatar', initials(c.name));
  const main = el('span', 'row-main');
  const top = el('span', 'row-top');
  if (c.hasNew) {
    const dot = el('span', 'new-dot');
    dot.title = t('newMessages');
    top.append(dot);
  }
  top.append(el('span', 'row-name', c.name), el('span', 'row-date', shortDate(c.t)));
  main.append(top, el('div', 'row-sub', L.chatLabel(c.kind, c.archived)));
  row.append(input, circle, avatar, main);
  return row;
}

$('list').addEventListener('change', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  if (e.target.checked) ui.selected.add(row.dataset.id);
  else ui.selected.delete(row.dataset.id);
  updateSelectAll();
});

const allVisibleSelected = () => ui.visible.length > 0 && ui.visible.every((c) => ui.selected.has(c.id));

function updateSelectAll() {
  const btn = $('select-all');
  btn.hidden = !ui.visible.length;
  btn.textContent = allVisibleSelected() ? t('deselectAll') : t('selectAll');
  const total = ui.pool.length;
  $('sel-count').textContent = L.selected(fmtNum(selectedInPool().length), total === 1 ? 1 : fmtNum(total));
  updateCta();
}

$('select-all').addEventListener('click', () => {
  const select = !allVisibleSelected();
  for (const c of ui.visible) {
    if (select) ui.selected.add(c.id);
    else ui.selected.delete(c.id);
  }
  for (const row of $('list').querySelectorAll('.row')) row.querySelector('input').checked = ui.selected.has(row.dataset.id);
  updateSelectAll();
});

let searchTimer;
$('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    ui.query = e.target.value.trim().toLowerCase();
    applyFilter();
  }, 120);
});

$('scope').addEventListener('change', (e) => {
  ui.filter = e.target.value;
  applyFilter();
});

function setKind(kind) {
  ui.filter = kind;
  document.querySelector(`input[name="kind"][value="${kind}"]`).checked = true;
}

for (const id of ['activity', 'includeGroups', 'activitySince']) {
  $(id).addEventListener('change', () => {
    applyFilter();
    saveOptions();
    if (id === 'activity' && $('activity').value === 'date' && !$('activitySince').value) $('activitySince').focus();
  });
}

$('refresh').addEventListener('click', loadChats);

// Linea fina bajo la barra superior cuando el contenido se desplaza, como en iOS.
for (const v of document.querySelectorAll('.view')) {
  v.addEventListener(
    'scroll',
    () => {
      $('navbar').classList.toggle('scrolled', v.scrollTop > 4);
      hideTip();
    },
    { passive: true }
  );
}

// ------------------------------------------------------------------
// Tooltips
// ------------------------------------------------------------------

const tip = $('tooltip');
let tipOwner = null;

function showTip(btn) {
  tipOwner = btn;
  tip.textContent = t(btn.dataset.tip);
  tip.hidden = false;
  btn.setAttribute('aria-describedby', 'tooltip');
  btn.setAttribute('aria-expanded', 'true');
  const r = btn.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  const below = r.bottom + 8 + h < window.innerHeight - 8;
  tip.style.left = `${left}px`;
  tip.style.top = `${below ? r.bottom + 8 : r.top - h - 8}px`;
}

function hideTip() {
  if (!tipOwner) return;
  tipOwner.removeAttribute('aria-describedby');
  tipOwner.setAttribute('aria-expanded', 'false');
  tipOwner = null;
  tip.hidden = true;
}

for (const btn of document.querySelectorAll('.info')) {
  btn.type = 'button';
  btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('mouseenter', () => showTip(btn));
  btn.addEventListener('mouseleave', hideTip);
  btn.addEventListener('focus', () => showTip(btn));
  btn.addEventListener('blur', hideTip);
  // Dentro de un <label>, el clic no debe activar el control (interruptor o menu).
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    btn.focus(); // en pantallas tactiles no hay hover: el foco lo mantiene visible
    showTip(btn);
  });
}

// ------------------------------------------------------------------
// Configuracion avanzada (hoja)
// ------------------------------------------------------------------

let sheetOpener = null;

function openSheet(e) {
  const sheet = $('sheet');
  sheetOpener = e?.currentTarget || null;
  hideTip();
  sheet.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('open')));
  $('sheet-done').focus();
}

function closeSheet() {
  const sheet = $('sheet');
  if (sheet.hidden) return;
  hideTip();
  sheet.classList.remove('open');
  const done = () => {
    sheet.hidden = true;
    (sheetOpener || $('open-advanced')).focus();
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) done();
  else setTimeout(done, 320);
}

$('open-options').addEventListener('click', openSheet);
$('open-advanced').addEventListener('click', openSheet);
$('sheet-done').addEventListener('click', closeSheet);
$('sheet').addEventListener('click', (e) => {
  if (e.target === $('sheet')) closeSheet();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (tipOwner) hideTip();
  else closeSheet();
});

// ------------------------------------------------------------------
// Opciones
// ------------------------------------------------------------------

function readOptions() {
  return {
    lang: $('lang').value,
    formats: [...document.querySelectorAll('input[name="fmt"]:checked')].map((i) => i.value),
    period: $('period').value,
    since: $('since').value || null,
    speed: document.querySelector('input[name="speed"]:checked').value,
    meName: $('meName').value.trim(),
    maxPerChat: parseInt($('maxPerChat').value, 10) || 0,
    includeSystem: $('includeSystem').checked,
    quick: $('quick').checked,
    ...scope(),
  };
}

function writeOptions(o) {
  if (o.lang) $('lang').value = o.lang === 'es' ? 'es' : 'en';
  if (Array.isArray(o.formats) && o.formats.length) {
    for (const i of document.querySelectorAll('input[name="fmt"]')) i.checked = o.formats.includes(i.value);
  }
  if (o.period) $('period').value = o.period;
  if (o.since) $('since').value = o.since;
  if (o.speed) {
    const i = document.querySelector(`input[name="speed"][value="${o.speed}"]`);
    if (i) i.checked = true;
  }
  if (o.meName && o.meName !== 'Yo' && o.meName !== 'Me') $('meName').value = o.meName;
  if (o.maxPerChat) $('maxPerChat').value = o.maxPerChat;
  $('includeSystem').checked = !!o.includeSystem;
  $('quick').checked = !!o.quick;
  if (typeof o.includeGroups === 'boolean') $('includeGroups').checked = o.includeGroups;
  if (o.activitySince) $('activitySince').value = o.activitySince;
  const mode = o.activityMode || (o.activitySince ? 'date' : String(o.activityDays || 0));
  if ([...$('activity').options].some((op) => op.value === mode)) $('activity').value = mode;
}

function saveOptions() {
  chrome.storage.local.set({ [STORAGE_KEY]: readOptions() });
  updateCta();
}

function toExportOptions(o) {
  const speed = SPEEDS[o.speed] || SPEEDS.normal;
  return {
    lang: o.lang,
    formats: o.formats,
    chatIds: selectedInPool().map((c) => c.id),
    includeGroups: o.includeGroups,
    activityDays: o.activityDays,
    activitySince: o.activitySince,
    loadFullHistory: !o.quick,
    since: o.period === 'since' ? o.since : null,
    onlyNew: o.period === 'new',
    maxPerChat: o.maxPerChat,
    includeSystem: o.includeSystem,
    meName: o.meName,
    lastRun: o.period === 'new' ? ui.lastRun : null,
    concurrency: speed.concurrency,
    delayMs: speed.delayMs,
  };
}

function updatePeriodState() {
  const opt = $('period').querySelector('option[value="new"]');
  opt.disabled = !ui.lastExportAt;
  if (opt.disabled && $('period').value === 'new') $('period').value = 'all';
  const period = $('period').value;
  $('since-cell').hidden = period !== 'since';
  const note = $('period-note');
  note.hidden = !(period === 'new' && ui.lastExportAt);
  if (!note.hidden) {
    const d = new Date(ui.lastExportAt * 1000);
    note.textContent = L.lastExport(`${fmtDate(d)} ${fmtTime(d)}`);
  }
}

/** Muestra las fechas elegidas con el formato del idioma de la extension. */
function renderDateFields() {
  for (const txt of document.querySelectorAll('.date-text')) {
    const v = $(txt.dataset.for).value;
    txt.classList.toggle('empty', !v);
    txt.textContent = v ? fmtDate(new Date(`${v}T00:00:00`)) : t('chooseDate');
  }
}

for (const input of document.querySelectorAll('.date-field input')) {
  input.addEventListener('click', () => {
    try {
      input.showPicker();
    } catch {
      /* navegadores sin showPicker: el campo nativo sigue funcionando */
    }
  });
  input.addEventListener('input', renderDateFields);
  input.addEventListener('change', renderDateFields);
}

function updateSpeedHint() {
  const speed = document.querySelector('input[name="speed"]:checked').value;
  $('speed-hint').textContent = L.speedHint[speed] || L.speedHint.normal;
}

$('lang').addEventListener('change', () => {
  applyLanguage($('lang').value);
  saveOptions();
});
$('period').addEventListener('change', () => {
  updatePeriodState();
  saveOptions();
  if ($('period').value === 'since' && !$('since').value) $('since').focus();
});
$('since').addEventListener('change', saveOptions);
$('basic').addEventListener('change', (e) => {
  if (e.target.name === 'fmt') saveOptions();
});
$('options').addEventListener('change', () => {
  updateSpeedHint();
  saveOptions();
});
$('options').addEventListener('input', (e) => {
  if (e.target.type === 'text' || e.target.type === 'number') saveOptions();
});

function updateCta() {
  if (ui.view !== 'select') return;
  const btn = $('primary');
  const n = selectedInPool().length;
  const o = readOptions();
  let problem = '';
  if (o.activityMode === 'date' && !o.activitySince) problem = t('problemActivity');
  else if (!ui.pool.length) problem = t('problemNoChats');
  else if (!n) problem = t('problemSelect');
  else if (!o.formats.length) problem = t('problemFormat');
  else if (o.period === 'since' && !o.since) problem = t('problemSince');
  btn.disabled = !!problem;
  btn.textContent = problem || L.exportN(n === 1 ? 1 : fmtNum(n));
}

// ------------------------------------------------------------------
// Exportacion y progreso
// ------------------------------------------------------------------

$('primary').addEventListener('click', async () => {
  if (ui.view === 'done') {
    await loadChats();
    return;
  }
  if (ui.view !== 'select') return;
  const opts = toExportOptions(readOptions());
  ui.formatsUsed = new Set(opts.formats);
  $('primary').disabled = true;
  try {
    const res = await rpc('start', { options: opts });
    if (res && res.ok === false) throw new Error(res.error);
    renderProgress({ status: 'running', phase: 'starting', total: opts.chatIds.length, done: 0, messagesTotal: 0, active: [], recent: [], errors: [], startedAt: Date.now() });
  } catch (e) {
    $('primary').disabled = false;
    setConn('bad', 'startFailed', e.message);
  }
});

$('secondary').addEventListener('click', () => {
  $('secondary').disabled = true;
  $('secondary').textContent = t('cancelling');
  rpc('cancel').catch(() => {});
});

function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function fmtBytes(b) {
  if (!b) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b.toLocaleString(L.locale, { maximumFractionDigits: i ? 1 : 0 })} ${u[i]}`;
}

function fillRows(ul, items, make) {
  ul.textContent = '';
  for (const it of items) ul.append(make(it));
}

function errorItem(e) {
  const li = el('li');
  li.append(el('strong', '', e.name), el('span', 'err', e.error));
  return li;
}

function renderErrors(prefix, s) {
  const count = s.errorCount || (s.errors || []).length;
  $(`${prefix}-errors-wrap`).hidden = !count;
  if (!count) return;
  $(`${prefix}-errors-title`).textContent = L.warnings(count);
  fillRows($(`${prefix}-errors`), s.errors || [], errorItem);
}

function tickProgress() {
  const s = ui.state;
  if (!s || s.status !== 'running') return;
  const elapsed = Date.now() - (s.startedAt || Date.now());
  $('p-elapsed').textContent = fmtDuration(elapsed);
  const secs = elapsed / 1000;
  $('p-rate').textContent = secs > 1 ? fmtNum(Math.round(s.messagesTotal / secs)) : '0';
  if (s.done >= 2 && s.total > s.done) $('p-eta').textContent = fmtDuration((elapsed / s.done) * (s.total - s.done));
  else if (s.total && s.done === s.total) $('p-eta').textContent = '0:00';
  else $('p-eta').textContent = t('calculating');
}

function renderProgress(s) {
  ui.state = s;
  if (ui.view !== 'progress') {
    $('secondary').disabled = false;
    setView('progress');
  }
  setConn('busy', 'exporting');
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  $('ring-fill').style.strokeDashoffset = `${(326.73 * (1 - pct / 100)).toFixed(2)}px`;
  $('p-pct').textContent = `${pct}%`;
  $('p-count').textContent = L.ofChats(fmtNum(s.done), fmtNum(s.total));
  $('p-phase').textContent = L.phase[s.phase] || '';
  $('p-msgs').textContent = fmtNum(s.messagesTotal);

  const active = s.active || [];
  $('p-active-wrap').hidden = !active.length;
  fillRows($('p-active'), active, (a) => {
    const li = el('li');
    li.append(svgIcon('i-spinner', 'spinner'), el('span', 'name', a.name), el('span', 'num', fmtNum(a.count)));
    return li;
  });
  const recent = s.recent || [];
  $('p-recent-wrap').hidden = !recent.length;
  fillRows($('p-recent'), recent, (r) => {
    const li = el('li');
    li.append(svgIcon(r.error ? 'i-alert' : 'i-check-circle', r.error ? 'bad' : 'ok'), el('span', 'name', r.name), el('span', 'num', fmtNum(r.count)));
    return li;
  });
  renderErrors('p', s);
  tickProgress();
  if (!ui.ticker) ui.ticker = setInterval(tickProgress, 1000);
}

function renderDone(s) {
  ui.state = s;
  clearInterval(ui.ticker);
  ui.ticker = null;
  setView('done');
  show('done');
  const ok = s.status === 'done';
  const count = s.errorCount || 0;
  const icon = $('d-icon');
  icon.className = `result-icon${ok && !count ? '' : ' warn-state'}`;
  icon.textContent = '';
  icon.append(svgIcon(ok && !count ? 'i-check-circle' : 'i-alert'));
  $('d-title').textContent = ok ? t('doneTitle') : s.status === 'cancelled' ? t('cancelledTitle') : t('stoppedTitle');
  $('d-sub').textContent = ok ? t('savedTo') : s.fileName ? `${s.error || ''} ${t('partialSaved')}`.trim() : s.error || '';
  $('d-file-card').hidden = !s.fileName;
  $('d-file').textContent = s.fileName || '';
  $('d-size').textContent = fmtBytes(s.fileSize);
  $('d-chats').textContent = fmtNum(s.done);
  $('d-msgs').textContent = fmtNum(s.messagesTotal);
  $('d-time').textContent = fmtDuration((s.finishedAt || Date.now()) - (s.startedAt || Date.now()));
  $('next-step').textContent = L.nextStepText(ui.formatsUsed);
  renderErrors('d', s);
  setConn('ok', 'ok');
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.target !== 'wa-export-panel') return;
  if (!sender.tab || !(sender.tab.url || '').startsWith(WA_URL)) return; // solo la pestana de WhatsApp Web
  if (ui.tab && sender.tab.id !== ui.tab.id) return;
  const s = msg.state;
  if (s.status === 'running') renderProgress(s);
  else if (ui.view === 'progress' && ['done', 'cancelled', 'error'].includes(s.status)) renderDone(s);
});

// Reconectar si la pestana de WhatsApp se abre, recarga o cierra.
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete' || !(tab.url || '').startsWith(WA_URL)) return;
  if (!ui.tab || ui.tab.id === tabId || ui.view === 'connect') setTimeout(connect, 800);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  if (ui.tab && ui.tab.id === tabId) connect();
});

// ------------------------------------------------------------------
// Inicio
// ------------------------------------------------------------------

(async () => {
  const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
  if (stored) writeOptions(stored);
  applyLanguage($('lang').value);
  await connect();
})();
