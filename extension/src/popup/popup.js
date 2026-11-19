const WA_URL = 'https://web.whatsapp.com/';
const STORAGE_KEY = 'wa-export-options';

const $ = (id) => document.getElementById(id);
const form = $('opts');
let waTab = null;

function readForm() {
  const f = form.elements;
  const formats = [];
  if (f.fmt_json.checked) formats.push('json');
  if (f.fmt_csv.checked) formats.push('csv');
  return {
    formats,
    includeIndividuals: f.includeIndividuals.checked,
    includeGroups: f.includeGroups.checked,
    includeArchived: f.includeArchived.checked,
    nameFilter: f.nameFilter.value.trim(),
    loadFullHistory: f.loadFullHistory.checked,
    onlyNew: f.onlyNew.checked,
    includeSystem: f.includeSystem.checked,
    since: f.since.value || null,
    maxPerChat: parseInt(f.maxPerChat.value, 10) || 0,
    meName: f.meName.value.trim() || 'Yo',
    delayMs: parseInt(f.delayMs.value, 10) || 0,
  };
}

function writeForm(o) {
  const f = form.elements;
  if (Array.isArray(o.formats)) {
    f.fmt_json.checked = o.formats.includes('json');
    f.fmt_csv.checked = o.formats.includes('csv');
  }
  for (const k of ['includeIndividuals', 'includeGroups', 'includeArchived', 'loadFullHistory', 'onlyNew', 'includeSystem']) {
    if (typeof o[k] === 'boolean') f[k].checked = o[k];
  }
  for (const k of ['nameFilter', 'since', 'maxPerChat', 'meName', 'delayMs']) {
    if (o[k] !== undefined && o[k] !== null) f[k].value = o[k];
  }
}

async function findWaTab() {
  const tabs = await chrome.tabs.query({ url: `${WA_URL}*` });
  return tabs.find((t) => t.active) || tabs[0] || null;
}

async function send(type, options) {
  return chrome.tabs.sendMessage(waTab.id, { target: 'wa-export', type, options });
}

function render(s) {
  const running = s && s.status === 'running';
  $('start').disabled = running || !waTab;
  $('cancel').hidden = !running;
  if (!s || s.status === 'idle') {
    $('status').hidden = true;
    return;
  }
  $('status').hidden = false;
  const pct = s.chatTotal ? Math.round((s.chatIndex / s.chatTotal) * 100) : 0;
  $('bar-fill').style.width = `${s.status === 'done' ? 100 : pct}%`;

  if (running) {
    $('status-main').textContent = s.chatTotal
      ? `Chat ${s.chatIndex} de ${s.chatTotal} (${pct}%) - ${s.messagesTotal.toLocaleString()} mensajes`
      : s.phase;
    $('status-detail').textContent = s.currentChat
      ? `${s.phase}: ${s.currentChat} (${s.currentChatMessages.toLocaleString()} cargados). Puedes cerrar este popup; la exportacion sigue en la pestana.`
      : s.phase;
  } else if (s.status === 'done') {
    $('status-main').textContent = `Listo: ${s.messagesTotal.toLocaleString()} mensajes de ${s.chatTotal} chats.`;
    $('status-detail').textContent = `Descargado: ${s.fileName}`;
  } else {
    $('status-main').textContent = s.error || 'Exportacion detenida.';
    $('status-detail').textContent = s.fileName ? `Archivo parcial: ${s.fileName}` : (s.log || []).slice(-1)[0] || '';
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const options = readForm();
  if (!options.formats.length) {
    render({ status: 'error', error: 'Elige al menos un formato (JSON o CSV).' });
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: options });
  try {
    await send('start', options);
    render({ status: 'running', phase: 'Iniciando', chatIndex: 0, chatTotal: 0, messagesTotal: 0 });
  } catch {
    $('reload-tab').hidden = false;
  }
});

$('cancel').addEventListener('click', () => send('cancel').catch(() => {}));
$('open-wa').addEventListener('click', () => chrome.tabs.create({ url: WA_URL }));
$('reload-wa').addEventListener('click', async () => {
  await chrome.tabs.reload(waTab.id);
  window.close();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.target === 'wa-export-popup') render(msg.state);
});

(async () => {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  if (stored[STORAGE_KEY]) writeForm(stored[STORAGE_KEY]);

  waTab = await findWaTab();
  if (!waTab) {
    $('no-tab').hidden = false;
    $('start').disabled = true;
    return;
  }
  try {
    render(await send('getState'));
  } catch {
    $('reload-tab').hidden = false;
    $('start').disabled = true;
  }
})();
