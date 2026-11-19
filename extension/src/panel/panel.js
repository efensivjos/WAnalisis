/* Panel lateral de WAnalisis: seleccion de chats, opciones, progreso y resultado. */

const WA_URL = 'https://web.whatsapp.com/';
const STORAGE_KEY = 'wa-export-options-v2';
const LAST_RUN_KEY = 'wa-export-last-run';
const PAGE_SIZE = 200;
const SPEEDS = {
  careful: { concurrency: 1, delayMs: 400, hint: 'Un chat a la vez con pausas. Para cuentas muy grandes o conexiones lentas.' },
  normal: { concurrency: 2, delayMs: 150, hint: 'Dos chats en paralelo. Recomendado.' },
  fast: { concurrency: 4, delayMs: 0, hint: 'Cuatro chats en paralelo sin pausas. Más rápido, más carga para el teléfono.' },
};
const KIND_TAG = { individual: '', group: 'Grupo' };
const AVATAR_COLORS = ['#00a884', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#ef4444', '#14b8a6', '#6366f1', '#84cc16', '#0ea5e9'];

const $ = (id) => document.getElementById(id);
const fmtNum = (n) => Number(n || 0).toLocaleString('es');

const ui = {
  tab: null,
  chats: [],
  known: new Set(),
  selected: new Set(),
  filter: 'all',
  query: '',
  visible: [],
  rendered: 0,
  lastExportAt: 0,
  lastRun: { at: 0, chats: {} },
  view: '',
  state: null,
  ticker: null,
  retryTimer: null,
};

// ------------------------------------------------------------------
// Comunicacion con la pestaña de WhatsApp Web
// ------------------------------------------------------------------

async function findWaTab() {
  const tabs = await chrome.tabs.query({ url: `${WA_URL}*` });
  if (!tabs.length) return null;
  const win = await chrome.windows.getLastFocused().catch(() => null);
  return tabs.find((t) => t.active && win && t.windowId === win.id) || tabs.find((t) => t.active) || tabs[0];
}

async function rpc(method, params) {
  if (!ui.tab) throw new Error('sin pestaña');
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
  $('footer').hidden = view === 'connect';
  const primary = $('primary');
  const secondary = $('secondary');
  secondary.hidden = true;
  primary.hidden = false;
  if (view === 'select') updateCta();
  if (view === 'progress') {
    primary.hidden = true;
    secondary.hidden = false;
    secondary.textContent = 'Cancelar exportación';
    secondary.classList.add('block');
  }
  if (view === 'done') {
    primary.textContent = 'Nueva exportación';
    primary.disabled = false;
  }
}

function setConn(kind, text) {
  $('conn').className = `conn ${kind}`;
  $('conn-text').textContent = text;
}

function showConnect(title, text, action) {
  show('connect');
  $('connect-title').textContent = title;
  $('connect-text').textContent = text;
  const btn = $('connect-action');
  btn.hidden = !action;
  if (action) {
    btn.textContent = action.label;
    btn.onclick = action.run;
  }
}

// ------------------------------------------------------------------
// Conexion
// ------------------------------------------------------------------

async function connect() {
  clearTimeout(ui.retryTimer);
  ui.tab = await findWaTab();
  if (!ui.tab) {
    setConn('bad', 'WhatsApp Web no está abierto');
    showConnect('Abre WhatsApp Web', 'Inicia sesión en WhatsApp Web en una pestaña de este navegador para exportar tus chats.', {
      label: 'Abrir WhatsApp Web',
      run: () => chrome.tabs.create({ url: WA_URL }),
    });
    return;
  }

  let status;
  try {
    status = await rpc('status');
  } catch {
    setConn('bad', 'Extensión sin activar en la pestaña');
    showConnect('Recarga WhatsApp Web', 'La pestaña se abrió antes de instalar o actualizar la extensión. Recárgala para activarla.', {
      label: 'Recargar pestaña',
      run: () => chrome.tabs.reload(ui.tab.id),
    });
    return;
  }

  if (status.state && status.state.status === 'running') {
    setConn('busy', 'Exportando');
    renderProgress(status.state);
    return;
  }
  if (!status.ready) {
    setConn('busy', 'Esperando a WhatsApp Web');
    showConnect('Esperando tus chats', 'Inicia sesión y espera a que aparezca la lista de chats en WhatsApp Web.', null);
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
    const firstLoad = ui.known.size === 0;
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
    setConn('ok', acct ? `Conectado · ${acct}` : 'Conectado');
    updateLastExport();
    updateChipCounts();
    applyFilter();
    show('select');
    if (firstLoad) $('search').focus();
  } catch (e) {
    setConn('bad', 'Error de conexión');
    showConnect('No se pudo leer la lista de chats', e.message, { label: 'Reintentar', run: connect });
  } finally {
    $('refresh').classList.remove('spin');
  }
}

// ------------------------------------------------------------------
// Lista de chats
// ------------------------------------------------------------------

function matchesFilter(c) {
  if (ui.filter === 'individual' && c.kind !== 'individual') return false;
  if (ui.filter === 'group' && c.kind !== 'group') return false;
  if (ui.filter === 'archived' && !c.archived) return false;
  return !ui.query || c.name.toLowerCase().includes(ui.query);
}

function updateChipCounts() {
  const counts = { all: ui.chats.length, individual: 0, group: 0, archived: 0 };
  for (const c of ui.chats) {
    if (c.kind === 'individual') counts.individual++;
    if (c.kind === 'group') counts.group++;
    if (c.archived) counts.archived++;
  }
  for (const chip of $('chips').children) chip.querySelector('span').textContent = fmtNum(counts[chip.dataset.filter]);
}

function applyFilter() {
  ui.visible = ui.chats.filter(matchesFilter);
  ui.rendered = 0;
  $('list').textContent = '';
  $('list-empty').hidden = ui.visible.length > 0;
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

function colorFor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function initials(name) {
  const clean = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (!parts.length) return '#';
  return (parts[0][0] + (parts.length > 1 ? parts[1][0] : '')).toUpperCase();
}

const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
function relTime(t) {
  if (!t) return '';
  const diff = t * 1000 - Date.now();
  const abs = Math.abs(diff);
  const units = [
    ['year', 31536e6], ['month', 2592e6], ['week', 6048e5], ['day', 864e5], ['hour', 36e5], ['minute', 6e4],
  ];
  for (const [unit, ms] of units) if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  return 'ahora';
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
  const box = el('span', 'box');
  box.append(svgIcon('i-check'));
  const avatar = el('span', 'avatar', initials(c.name));
  avatar.style.background = colorFor(c.id);
  const main = el('span', 'row-main');
  main.append(el('div', 'row-name', c.name));
  const meta = el('div', 'row-meta');
  if (KIND_TAG[c.kind]) meta.append(el('span', 'tag', KIND_TAG[c.kind]));
  if (c.archived) meta.append(el('span', 'tag', 'Archivado'));
  meta.append(el('span', '', relTime(c.t)));
  main.append(meta);
  row.append(input, box, avatar, main);
  if (c.hasNew) row.append(el('span', 'badge-new', 'Nuevo'));
  row.classList.toggle('off', !input.checked);
  return row;
}

$('list').addEventListener('change', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  if (e.target.checked) ui.selected.add(row.dataset.id);
  else ui.selected.delete(row.dataset.id);
  row.classList.toggle('off', !e.target.checked);
  updateSelectAll();
});

function updateSelectAll() {
  const box = $('select-all');
  const vis = ui.visible;
  const sel = vis.reduce((n, c) => n + (ui.selected.has(c.id) ? 1 : 0), 0);
  box.checked = vis.length > 0 && sel === vis.length;
  box.indeterminate = sel > 0 && sel < vis.length;
  const filtered = ui.filter !== 'all' || ui.query;
  $('select-all-label').textContent = filtered ? `Seleccionar visibles (${fmtNum(vis.length)})` : 'Seleccionar todos';
  $('sel-count').textContent = `${fmtNum(ui.selected.size)} de ${fmtNum(ui.chats.length)}`;
  updateCta();
}

$('select-all').addEventListener('change', (e) => {
  for (const c of ui.visible) {
    if (e.target.checked) ui.selected.add(c.id);
    else ui.selected.delete(c.id);
  }
  for (const row of $('list').querySelectorAll('.row')) {
    const input = row.querySelector('input');
    input.checked = ui.selected.has(row.dataset.id);
    row.classList.toggle('off', !input.checked);
  }
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

$('chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  for (const c of $('chips').children) c.classList.toggle('active', c === chip);
  ui.filter = chip.dataset.filter;
  applyFilter();
});

$('refresh').addEventListener('click', loadChats);

// ------------------------------------------------------------------
// Opciones
// ------------------------------------------------------------------

function readOptions() {
  const formats = [...document.querySelectorAll('input[name="fmt"]:checked')].map((i) => i.value);
  const period = document.querySelector('input[name="period"]:checked').value;
  const speed = document.querySelector('input[name="speed"]:checked').value;
  return {
    formats,
    period,
    since: $('since').value || null,
    speed,
    meName: $('meName').value.trim() || 'Yo',
    maxPerChat: parseInt($('maxPerChat').value, 10) || 0,
    includeSystem: $('includeSystem').checked,
    quick: $('quick').checked,
  };
}

function writeOptions(o) {
  if (Array.isArray(o.formats)) {
    for (const i of document.querySelectorAll('input[name="fmt"]')) i.checked = o.formats.includes(i.value);
  }
  const set = (name, value) => {
    const i = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (i) i.checked = true;
  };
  if (o.period) set('period', o.period);
  if (o.speed) set('speed', o.speed);
  if (o.since) $('since').value = o.since;
  if (o.meName) $('meName').value = o.meName;
  if (o.maxPerChat) $('maxPerChat').value = o.maxPerChat;
  $('includeSystem').checked = !!o.includeSystem;
  $('quick').checked = !!o.quick;
}

function toExportOptions(o) {
  const speed = SPEEDS[o.speed] || SPEEDS.normal;
  return {
    formats: o.formats,
    chatIds: ui.chats.filter((c) => ui.selected.has(c.id)).map((c) => c.id),
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

function updateLastExport() {
  const card = $('period-new');
  const input = card.querySelector('input');
  if (ui.lastExportAt) {
    const d = new Date(ui.lastExportAt * 1000);
    $('last-export-text').textContent = `Desde la última exportación (${d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}).`;
    input.disabled = false;
  } else {
    $('last-export-text').textContent = 'Disponible después de tu primera exportación completa.';
    input.disabled = true;
    if (input.checked) document.querySelector('input[name="period"][value="all"]').checked = true;
  }
}

function onOptionsChanged() {
  const o = readOptions();
  const fmt = o.formats.length ? o.formats.map((f) => f.toUpperCase()).join(', ') : 'sin formato';
  const period = { all: 'Todo', since: o.since ? `Desde ${o.since}` : 'Desde fecha', new: 'Solo lo nuevo' }[o.period];
  const speed = { careful: 'Cuidadosa', normal: 'Normal', fast: 'Rápida' }[o.speed];
  $('options-summary').textContent = `${fmt} · ${period} · ${speed}`;
  $('speed-hint').textContent = (SPEEDS[o.speed] || SPEEDS.normal).hint;
  if (o.period === 'since' && !o.since) $('since').focus();
  chrome.storage.local.set({ [STORAGE_KEY]: o });
  updateCta();
}

$('options').addEventListener('change', onOptionsChanged);
$('options').addEventListener('input', (e) => {
  if (e.target.type === 'text' || e.target.type === 'number') onOptionsChanged();
});
$('since').addEventListener('change', () => {
  document.querySelector('input[name="period"][value="since"]').checked = true;
  onOptionsChanged();
});

function updateCta() {
  if (ui.view !== 'select') return;
  const btn = $('primary');
  const n = ui.selected.size;
  const o = readOptions();
  let problem = '';
  if (!n) problem = 'Selecciona al menos un chat';
  else if (!o.formats.length) problem = 'Elige al menos un formato';
  else if (o.period === 'since' && !o.since) problem = 'Elige la fecha de inicio';
  btn.disabled = !!problem;
  btn.textContent = problem || (n === 1 ? 'Exportar 1 chat' : `Exportar ${fmtNum(n)} chats`);
}

// ------------------------------------------------------------------
// Exportación y progreso
// ------------------------------------------------------------------

$('primary').addEventListener('click', async () => {
  if (ui.view === 'done') {
    await loadChats();
    return;
  }
  if (ui.view !== 'select') return;
  const opts = toExportOptions(readOptions());
  $('primary').disabled = true;
  try {
    const res = await rpc('start', { options: opts });
    if (res && res.ok === false) throw new Error(res.error);
    renderProgress({ status: 'running', phase: 'Iniciando', total: opts.chatIds.length, done: 0, messagesTotal: 0, active: [], recent: [], errors: [], startedAt: Date.now() });
  } catch (e) {
    $('primary').disabled = false;
    setConn('bad', `No se pudo iniciar: ${e.message}`);
  }
});

$('secondary').addEventListener('click', () => {
  $('secondary').disabled = true;
  $('secondary').textContent = 'Cancelando';
  rpc('cancel').catch(() => {});
});

function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtBytes(b) {
  if (!b) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b.toFixed(i ? 1 : 0)} ${u[i]}`;
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
  $(`${prefix}-errors-title`).textContent = count === 1 ? '1 chat con avisos' : `${fmtNum(count)} chats con avisos`;
  fillRows($(`${prefix}-errors`), s.errors || [], errorItem);
}

function tickProgress() {
  const s = ui.state;
  if (!s || s.status !== 'running') return;
  const elapsed = Date.now() - (s.startedAt || Date.now());
  $('p-elapsed').textContent = fmtDuration(elapsed);
  const secs = elapsed / 1000;
  $('p-rate').textContent = secs > 1 ? fmtNum(Math.round(s.messagesTotal / secs)) : '0';
  if (s.done >= 2 && s.total > s.done) {
    $('p-eta').textContent = fmtDuration((elapsed / s.done) * (s.total - s.done));
  } else if (s.total && s.done === s.total) {
    $('p-eta').textContent = '0:00';
  } else {
    $('p-eta').textContent = 'calculando';
  }
}

function renderProgress(s) {
  ui.state = s;
  if (ui.view !== 'progress') {
    show('progress');
    $('secondary').disabled = false;
  }
  setConn('busy', 'Exportando');
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  $('ring-fill').style.strokeDashoffset = `${(326.73 * (1 - pct / 100)).toFixed(2)}px`;
  $('p-pct').textContent = `${pct}%`;
  $('p-count').textContent = `${fmtNum(s.done)} de ${fmtNum(s.total)} chats`;
  $('p-phase').textContent = s.phase || '';
  $('p-msgs').textContent = fmtNum(s.messagesTotal);

  const active = s.active || [];
  $('p-active-wrap').hidden = !active.length;
  fillRows($('p-active'), active, (a) => {
    const li = el('li');
    li.append(el('span', 'spinner'), el('span', 'name', a.name), el('span', 'num', fmtNum(a.count)));
    return li;
  });
  const recent = s.recent || [];
  $('p-recent-wrap').hidden = !recent.length;
  fillRows($('p-recent'), recent, (r) => {
    const li = el('li');
    li.append(svgIcon(r.error ? 'i-alert' : 'i-check', r.error ? 'bad' : 'ok'), el('span', 'name', r.name), el('span', 'num', fmtNum(r.count)));
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
  show('done');
  const ok = s.status === 'done';
  const count = s.errorCount || 0;
  const icon = $('d-icon');
  icon.className = `result-icon${ok && !count ? '' : ' warn'}`;
  icon.textContent = '';
  icon.append(svgIcon(ok && !count ? 'i-check' : 'i-alert'));
  $('d-title').textContent = ok ? 'Exportación lista' : s.status === 'cancelled' ? 'Exportación cancelada' : 'La exportación se detuvo';
  $('d-sub').textContent = ok
    ? 'El archivo se guardó en tu carpeta de Descargas.'
    : s.fileName
      ? `${s.error || ''} Se descargó lo exportado hasta ese momento.`.trim()
      : s.error || '';
  $('d-file-card').hidden = !s.fileName;
  $('d-file').textContent = s.fileName || '';
  $('d-size').textContent = fmtBytes(s.fileSize);
  $('d-chats').textContent = fmtNum(s.done);
  $('d-msgs').textContent = fmtNum(s.messagesTotal);
  $('d-time').textContent = fmtDuration((s.finishedAt || Date.now()) - (s.startedAt || Date.now()));
  renderErrors('d', s);
  setConn('ok', 'Conectado');
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.target !== 'wa-export-panel') return;
  if (!sender.tab || !(sender.tab.url || '').startsWith(WA_URL)) return; // solo la pestana de WhatsApp Web
  if (ui.tab && sender.tab.id !== ui.tab.id) return;
  const s = msg.state;
  if (s.status === 'running') renderProgress(s);
  else if (ui.view === 'progress' && ['done', 'cancelled', 'error'].includes(s.status)) renderDone(s);
});

// Reconectar si la pestaña de WhatsApp se abre, recarga o cierra.
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
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  if (stored[STORAGE_KEY]) writeOptions(stored[STORAGE_KEY]);
  onOptionsChanged();
  await connect();
})();
