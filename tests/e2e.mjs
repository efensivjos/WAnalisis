/*
 * Prueba end-to-end: carga la extension real en Chromium, sirve un WhatsApp
 * Web simulado en https://web.whatsapp.com/ (interceptando la red), maneja el
 * panel lateral como lo haria una persona y valida los ZIP descargados.
 *
 * Uso: node tests/e2e.mjs   (SCREENSHOTS=dir para guardar capturas del panel)
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const extDir = path.resolve(here, '..', 'extension');
const mockHtml = readFileSync(path.join(here, 'mock-wa.html'), 'utf8');
const shotsDir = process.env.SCREENSHOTS || '';
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

// ID de una extension desempaquetada: SHA-256 de la ruta, primeros 32 hex mapeados a a-p.
function extensionId(dir) {
  const hex = createHash('sha256').update(dir).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

function readZip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  assert.ok(eocd >= 0, 'EOCD no encontrado');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    const lnlen = buf.readUInt16LE(off + 26);
    const lxlen = buf.readUInt16LE(off + 28);
    const data = buf.subarray(off + 30 + lnlen + lxlen, off + 30 + lnlen + lxlen + csize);
    const raw = method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
    assert.equal(raw.length, usize, `tamano de ${name}`);
    assert.equal(zlib.crc32(raw), crc, `CRC de ${name}`);
    files[name] = raw.toString('utf8');
    p += 46 + nlen + xlen + clen;
  }
  return files;
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r') { /* ignorar */ }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const shot = async (page, name) => {
  if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `${name}.png`) });
};

async function openPanel(context, extId) {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 380, height: 760 });
  await panel.goto(`chrome-extension://${extId}/src/panel/panel.html`);
  await panel.waitForSelector('#view-select:not([hidden]) .row');
  return panel;
}

async function openSheet(panel) {
  await panel.click('#open-options');
  await panel.waitForSelector('.sheet-backdrop.open');
  await panel.waitForTimeout(400); // animacion de la hoja
}

async function closeSheet(panel) {
  await panel.click('#sheet-done');
  await panel.waitForSelector('#sheet', { state: 'hidden' });
}

async function exportFromPanel(panel, waPage) {
  const dl = waPage.waitForEvent('download', { timeout: 120000 });
  const t0 = Date.now();
  await panel.click('#primary');
  const download = await dl;
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'wa-dl-')), download.suggestedFilename());
  await download.saveAs(file);
  await panel.waitForSelector('#view-done:not([hidden])', { timeout: 30000 });
  return { name: download.suggestedFilename(), files: readZip(readFileSync(file)), file, ms: Date.now() - t0 };
}

const userDataDir = mkdtempSync(path.join(tmpdir(), 'wa-profile-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});

let failed = false;
try {
  // Monitoreo de red: cualquier solicitud que no sea la carga de la pagina simulada
  // o un recurso local de la extension cuenta como fuga.
  const leaks = [];
  context.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('chrome-extension://') || u.startsWith('blob:') || u.startsWith('data:')) return;
    if (u.startsWith('https://web.whatsapp.com/') && r.resourceType() === 'document') return;
    leaks.push(`${r.resourceType()} ${u}`);
  });
  await context.route(/^(?!https:\/\/web\.whatsapp\.com\/)https?:/, (route) => {
    leaks.push(`bloqueada ${route.request().url()}`);
    route.abort();
  });
  await context.route('https://web.whatsapp.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: mockHtml })
  );
  const wa = await context.newPage();
  await wa.goto('https://web.whatsapp.com/');
  await wa.waitForFunction(() => !!window.__WAExport, null, { timeout: 15000 });
  const extId = extensionId(extDir);

  // ---------- Panel: lista, filtros y busqueda ----------
  let panel = await openPanel(context, extId);
  assert.equal(await panel.locator('.row').count(), 4, 'excluye status@broadcast');
  assert.match(await panel.textContent('#conn-text'), /Conectado: \+5215500000000/);
  assert.equal(await panel.textContent('#primary'), 'Exportar 4 chats');
  assert.equal(await panel.textContent('#sel-count'), '4 de 4 seleccionados');
  assert.ok(await panel.locator('#period-new input').isDisabled(), '"Solo lo nuevo" sin exportacion previa');
  await shot(panel, '1-seleccion');

  await panel.click('#scope label:has(input[value="group"])');
  assert.equal(await panel.locator('.row').count(), 1);
  await panel.click('#scope label:has(input[value="archived"])');
  assert.equal(await panel.locator('.row').count(), 1);
  await panel.click('#scope label:has(input[value="all"])');
  await panel.fill('#search', 'banco');
  await panel.waitForFunction(() => document.querySelectorAll('.row').length === 1);
  await panel.fill('#search', '');
  await panel.waitForFunction(() => document.querySelectorAll('.row').length === 4);

  await openSheet(panel);
  await panel.click('#speed label:has(input[value="fast"])');
  await shot(panel, '2-opciones');
  await closeSheet(panel);
  assert.equal(await panel.textContent('#options-summary'), 'TXT, JSON y CSV. Todo el historial. Velocidad rápida.');

  // ---------- Exportacion completa (4 chats en paralelo) ----------
  const r1 = await exportFromPanel(panel, wa);
  const f = r1.files;
  console.log(`ZIP 1: ${r1.file} (${r1.ms} ms)`, Object.keys(f));
  assert.match(r1.name, /^whatsapp-export-\d{8}-\d{4}\.zip$/);
  assert.equal(await panel.textContent('#d-title'), 'Exportación lista');
  assert.equal(await panel.textContent('#d-msgs'), (20240).toLocaleString('es'));
  assert.equal(await panel.textContent('#d-chats'), '4');
  await shot(panel, '3-resultado');

  const index = JSON.parse(f['index.json']);
  assert.equal(index.chat_count, 4);
  assert.equal(index.complete, true);
  assert.equal(index.account, '5215500000000@c.us');
  assert.equal(index.options.concurrency, 4);
  assert.deepEqual(index.chats.map((c) => c.name), ['Ana López', 'Banco, S.A. "Atención"', 'Equipo Ventas', 'Historial grande'], 'orden por actividad');
  const byName = Object.fromEntries(index.chats.map((c) => [c.name, c]));
  assert.equal(byName['Ana López'].message_count, 230, 'historial completo de Ana');
  assert.equal(byName['Equipo Ventas'].message_count, 8, 'grupo sin gp2 ni revoked');
  assert.equal(byName['Banco, S.A. "Atención"'].message_count, 2);
  assert.equal(byName['Banco, S.A. "Atención"'].archived, true);
  assert.equal(byName['Historial grande'].message_count, 20000, 'historial grande completo');

  const anaJson = JSON.parse(f[byName['Ana López'].files.json]);
  assert.ok(anaJson.messages.every((m, i, a) => i === 0 || a[i - 1].timestamp <= m.timestamp), 'orden cronologico');
  assert.equal(anaJson.messages[0].text, 'Mensaje 0 con Ana');
  assert.equal(anaJson.messages[0].sender_name, 'Yo');
  assert.equal(anaJson.messages[1].sender_name, 'Ana López');
  assert.match(anaJson.messages[0].id, /^true_5215511111111@c\.us_MSG\d+$/, 'ids con $1 normalizados');
  assert.match(anaJson.messages[0].datetime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  const bigJson = JSON.parse(f[byName['Historial grande'].files.json]);
  assert.equal(new Set(bigJson.messages.map((m) => m.id)).size, 20000, 'sin duplicados');

  const grpJson = JSON.parse(f[byName['Equipo Ventas'].files.json]);
  const gm = grpJson.messages;
  assert.equal(grpJson.chat.kind, 'group');
  assert.equal(grpJson.chat.participants.length, 4);
  assert.ok(!f[byName['Equipo Ventas'].files.json].includes('AAAAAAAAAA'), 'no exporta miniaturas base64');
  const img = gm.find((m) => m.type === 'image');
  assert.equal(img.text, 'Foto del pizarron');
  assert.equal(img.sender_name, 'Pedrito', 'usa notifyName si no hay contacto');
  assert.deepEqual(img.media, { mimetype: 'image/jpeg', size: 12345 });
  const loc = gm.find((m) => m.type === 'location');
  assert.deepEqual(loc.location, { lat: 19.43, lng: -99.13 });
  assert.equal(loc.sender_name, '99887766554433', 'LID sin contacto');
  const reply = gm.find((m) => m.quoted_id);
  assert.equal(reply.quoted_sender, 'Lucía');
  assert.equal(reply.quoted_text, 'Cuando es la junta?');
  assert.equal(gm.find((m) => m.mentions).mentions[0], 'Carlos Ruiz');
  assert.equal(gm.find((m) => m.type === 'document').forwarded, true);
  assert.equal(gm.find((m) => m.type === 'ptt').media.duration, 12);

  // TXT
  const grpTxt = f[byName['Equipo Ventas'].files.txt];
  assert.match(grpTxt, /^Chat: Equipo Ventas \(grupo\)\nParticipantes \(4\): Carlos Ruiz, Lucía, \+5215544444444, 99887766554433\n/);
  assert.match(grpTxt, /\n--- \d{4}-\d{2}-\d{2} ---\n/);
  assert.match(grpTxt, /\] Yo: \[responde a Lucía: "Cuando es la junta\?"\] El lunes a las 10\n/);
  assert.match(grpTxt, /\] Pedrito: \[imagen\] Foto del pizarron\n/);
  assert.match(grpTxt, /\] Carlos Ruiz: \[nota de voz 12s\]\n/);
  assert.match(grpTxt, /\] \+5215544444444: \[reenviado\] \[documento: cotizacion\.pdf\]\n/);
  assert.match(grpTxt, /\] 99887766554433: \[ubicación 19\.43,-99\.13\] Oficina CDMX\n/);
  const bankTxt = f[byName['Banco, S.A. "Atención"'].files.txt];
  assert.match(bankTxt, /Banco, S\.A\.: Linea 1\n    Linea 2, con coma y "comillas"\n/, 'multilinea con sangria');
  const txtRatio = f[byName['Historial grande'].files.txt].length / f[byName['Historial grande'].files.json].length;
  console.log(`TXT/JSON tamano: ${(txtRatio * 100).toFixed(0)}%`);
  assert.ok(txtRatio < 0.6, 'TXT mucho mas compacto que JSON');

  // CSV
  const all = parseCsv(f['todos_los_mensajes.csv'].replace(/^﻿/, ''));
  assert.equal(all[0][0], 'chat_id');
  assert.equal(all.length - 1, 20240, 'CSV combinado');
  const bankRows = parseCsv(f[byName['Banco, S.A. "Atención"'].files.csv].replace(/^﻿/, ''));
  assert.equal(bankRows.length, 3);
  assert.equal(bankRows[1][1], 'Banco, S.A. "Atención"');
  assert.equal(bankRows[1][10], 'Linea 1\nLinea 2, con coma y "comillas"');
  assert.equal(bankRows[2][10], 'Gracias 🙏 ñandú');
  assert.ok(f['LEEME.txt'].includes('todos_los_mensajes.csv'));

  // Panel flotante dentro de WhatsApp Web
  const overlayText = await wa.evaluate(() => document.querySelector('#wanalisis-overlay')?.shadowRoot?.textContent || '');
  assert.match(overlayText, /Exportación lista/);
  await shot(wa, '4-overlay');

  // ---------- Incremental (firma antigua de loadEarlierMsgs) ----------
  const callsBefore = await wa.evaluate(() => {
    window.__legacySig = true;
    window.__mock.addNewAnaMessage();
    return window.__loadCalls;
  });
  await panel.click('#primary'); // "Nueva exportacion"
  await panel.waitForSelector('#view-select:not([hidden])');
  assert.ok(!(await panel.locator('#period-new input').isDisabled()), '"Solo lo nuevo" habilitado');
  assert.equal(await panel.locator('.row .new-dot').count(), 1, 'marca el chat con mensajes nuevos');
  await openSheet(panel);
  await panel.click('#period-new');
  await panel.click('label.choice:has(input[value="csv"])');
  await closeSheet(panel);
  assert.equal(await panel.textContent('#options-summary'), 'TXT y JSON. Solo lo nuevo. Velocidad rápida.');
  const r2 = await exportFromPanel(panel, wa);
  const idx2 = JSON.parse(r2.files['index.json']);
  console.log('ZIP 2:', Object.keys(r2.files));
  assert.equal(idx2.message_count, 1, 'solo el mensaje nuevo');
  assert.equal(idx2.chats.filter((c) => c.skipped).length, 3, 'chats sin cambios se saltan');
  assert.equal(await wa.evaluate(() => window.__loadCalls), callsBefore, 'no pide historial de mas');
  assert.ok(!('todos_los_mensajes.csv' in r2.files), 'sin CSV');
  const ana2 = JSON.parse(r2.files[idx2.chats.find((c) => c.message_count === 1).files.json]);
  assert.equal(ana2.messages[0].text, 'Mensaje nuevo despues de exportar');

  // ---------- Seleccion manual y limite por chat ----------
  await panel.click('#primary');
  await panel.waitForSelector('#view-select:not([hidden])');
  await openSheet(panel);
  await panel.click('label.choice:has(input[name="period"][value="all"])');
  await panel.fill('#maxPerChat', '100');
  await closeSheet(panel);
  assert.equal(await panel.textContent('#select-all'), 'Deseleccionar todo');
  await panel.click('#select-all'); // deseleccionar todos
  assert.equal(await panel.textContent('#primary'), 'Selecciona al menos un chat');
  assert.ok(await panel.locator('#primary').isDisabled());
  await panel.fill('#search', 'ana');
  await panel.waitForFunction(() => document.querySelectorAll('.row').length === 1);
  await panel.click('.row');
  assert.equal(await panel.textContent('#primary'), 'Exportar 1 chat');
  const r3 = await exportFromPanel(panel, wa);
  const idx3 = JSON.parse(r3.files['index.json']);
  assert.equal(idx3.chat_count, 1);
  assert.equal(idx3.chats[0].message_count, 100);

  // ---------- Filtros: incluir grupos y fecha del ultimo mensaje ----------
  await panel.click('#primary');
  await panel.waitForSelector('#view-select:not([hidden])');
  await panel.fill('#search', '');
  await panel.waitForFunction(() => document.querySelectorAll('.row').length === 4);
  await openSheet(panel);
  await panel.fill('#maxPerChat', '0');
  await closeSheet(panel);
  await panel.click('#select-all'); // seleccionar todos
  assert.equal(await panel.textContent('#primary'), 'Exportar 4 chats');

  await panel.click('#activity label:has(input[value="1"])'); // ultimo dia
  await panel.waitForFunction(() => document.querySelectorAll('.row').length === 2);
  assert.equal(await panel.textContent('#primary'), 'Exportar 2 chats');
  assert.equal(await panel.textContent('#sel-count'), '2 de 2 seleccionados');
  await panel.click('#activity label:has(input[value="7"])'); // ultima semana
  await panel.waitForFunction(() => document.querySelectorAll('.row').length === 2);
  await panel.click('#activity label:has(input[value="90"])'); // 3 meses
  await panel.waitForFunction(() => document.querySelectorAll('.row').length === 3);
  await panel.click('#activity label:has(input[value="30"])'); // ultimo mes
  await panel.waitForFunction(() => document.querySelectorAll('.row').length === 3);
  await panel.click('label.cell:has(#includeGroups)'); // sin grupos
  await panel.waitForFunction(() => document.querySelectorAll('.row').length === 2);
  assert.ok(await panel.locator('#scope [data-kind="group"]').isHidden(), 'oculta el filtro de grupos');
  assert.equal(await panel.textContent('#primary'), 'Exportar 2 chats');
  await panel.waitForTimeout(300); // deja terminar la animacion del interruptor
  await shot(panel, '6-filtros');

  const r4 = await exportFromPanel(panel, wa);
  const idx4 = JSON.parse(r4.files['index.json']);
  assert.deepEqual(idx4.chats.map((c) => c.name).sort(), ['Ana López', 'Banco, S.A. "Atención"']);
  assert.equal(idx4.options.includeGroups, false);
  assert.equal(idx4.options.activityDays, 30);
  // El exportador tambien aplica los filtros aunque reciba ids de grupos o chats antiguos.
  const dlDirect = wa.waitForEvent('download');
  await wa.evaluate(() => {
    const ids = window.__WAExport.listChats().chats.map((c) => c.id);
    window.__WAExport.start({ chatIds: ids, includeGroups: false, activityDays: 30, formats: ['json'], concurrency: 4, delayMs: 0 });
  });
  const directFile = path.join(mkdtempSync(path.join(tmpdir(), 'wa-dl-')), 'direct.zip');
  await (await dlDirect).saveAs(directFile);
  const idxDirect = JSON.parse(readZip(readFileSync(directFile))['index.json']);
  assert.deepEqual(idxDirect.chats.map((c) => c.name).sort(), ['Ana López', 'Banco, S.A. "Atención"']);
  await wa.waitForFunction(() => window.__WAExport.getState().status === 'done');

  // Sin chats en el rango: boton deshabilitado con explicacion.
  await panel.click('#primary');
  await panel.waitForSelector('#view-select:not([hidden])');
  await panel.click('label.cell:has(#includeGroups)'); // con grupos
  await panel.click('#activity label:has(input[value="1"])');
  await wa.evaluate(() => window.__mock.ageAll(3 * 86400));
  await panel.click('#refresh');
  await panel.waitForFunction(() => document.querySelectorAll('.row').length === 0);
  assert.equal(await panel.textContent('#primary'), 'Ningún chat cumple los filtros');
  assert.ok(await panel.locator('#primary').isDisabled());
  assert.match(await panel.textContent('#list-empty'), /Ningún chat cumple los filtros/);
  await wa.evaluate(() => window.__mock.ageAll(-3 * 86400));
  await panel.click('#activity label:has(input[value="0"])');
  await panel.click('#refresh');
  await panel.waitForFunction(() => document.querySelectorAll('.row').length === 4);

  // ---------- Cancelacion: descarga parcial ----------
  assert.equal(await panel.textContent('#primary'), 'Exportar 4 chats');
  await openSheet(panel);
  await panel.click('#speed label:has(input[value="careful"])');
  await closeSheet(panel);
  await wa.evaluate(() => window.__mock.resetHistory());
  const dl = wa.waitForEvent('download');
  await panel.click('#primary');
  await panel.waitForSelector('#p-active li');
  await panel.waitForFunction(() => document.querySelector('#p-msgs').textContent !== '0');
  await panel.waitForTimeout(500); // deja terminar la animacion del anillo
  await shot(panel, '5-progreso');
  await panel.click('#secondary');
  const partial = await dl;
  assert.match(partial.suggestedFilename(), /-parcial\.zip$/);
  await panel.waitForSelector('#view-done:not([hidden])');
  assert.equal(await panel.textContent('#d-title'), 'Exportación cancelada');

  // ---------- Sin rastros en el almacenamiento de WhatsApp Web ----------
  assert.deepEqual(await wa.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('wa-export'))), []);
  await wa.evaluate(() => localStorage.setItem('wa-export:last-run', JSON.stringify({ '5215599999999@c.us': 123 })));

  // ---------- Las opciones se recuerdan; el registro antiguo se migra ----------
  await panel.close();
  panel = await openPanel(context, extId);
  assert.equal(await panel.locator('input[name="fmt"][value="csv"]').isChecked(), false);
  assert.equal(await panel.locator('input[name="speed"][value="careful"]').isChecked(), true);
  assert.equal(await panel.locator('#includeGroups').isChecked(), true);
  assert.equal(await panel.locator('input[name="activity"][value="0"]').isChecked(), true);
  await panel.waitForFunction(async () => {
    const r = (await chrome.storage.local.get('wa-export-last-run'))['wa-export-last-run'];
    return r && r.chats['5215599999999@c.us'] === 123 && r.chats['5215511111111@c.us'] > 0;
  });
  assert.equal(await wa.evaluate(() => localStorage.getItem('wa-export:last-run')), null, 'registro antiguo borrado');
  await panel.close();

  // ---------- Ninguna conexion de red durante todo el flujo ----------
  assert.deepEqual(leaks, [], 'sin solicitudes de red fuera del navegador');

  console.log('OK: todas las pruebas pasaron');
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await context.close();
}
process.exit(failed ? 1 : 0);
