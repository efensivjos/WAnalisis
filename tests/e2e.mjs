/*
 * Prueba end-to-end: carga la extension real en Chromium, sirve un WhatsApp
 * Web simulado en https://web.whatsapp.com/ (interceptando la red), inicia la
 * exportacion desde el popup y valida el ZIP descargado.
 *
 * Uso: node tests/e2e.mjs
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync } from 'node:fs';
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

async function runFromPopup(context, extId, waPage, setOptions) {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`);
  await popup.waitForSelector('#start:not([disabled])');
  if (setOptions) await setOptions(popup);
  const dl = waPage.waitForEvent('download', { timeout: 60000 });
  await popup.click('#start');
  const download = await dl;
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'wa-dl-')), download.suggestedFilename());
  await download.saveAs(file);
  await waPage.waitForFunction(() => ['done', 'cancelled', 'error'].includes(window.__WAExport.getState().status));
  const popupText = await popup.locator('#status-main').textContent();
  await popup.close();
  return { name: download.suggestedFilename(), files: readZip(readFileSync(file)), popupText, file };
}

const userDataDir = mkdtempSync(path.join(tmpdir(), 'wa-profile-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});

let failed = false;
try {
  await context.route('https://web.whatsapp.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: mockHtml })
  );
  const wa = await context.newPage();
  await wa.goto('https://web.whatsapp.com/');
  await wa.waitForFunction(() => !!window.__WAExport, null, { timeout: 15000 });
  const extId = extensionId(extDir);

  // ---------- Exportacion completa ----------
  const r1 = await runFromPopup(context, extId, wa);
  const f = r1.files;
  console.log('ZIP 1:', r1.file, Object.keys(f));
  assert.match(r1.name, /^whatsapp-export-\d{8}-\d{4}\.zip$/);
  assert.match(r1.popupText, /Listo: 240 mensajes de 3 chats/);

  const index = JSON.parse(f['index.json']);
  assert.equal(index.chat_count, 3, 'excluye status@broadcast');
  assert.equal(index.complete, true);
  assert.equal(index.account, '5215500000000@c.us');
  const byName = Object.fromEntries(index.chats.map((c) => [c.name, c]));
  assert.equal(byName['Ana López'].message_count, 230, 'historial completo de Ana');
  // grupo: 10 mensajes, menos gp2 y revoked = 8
  assert.equal(byName['Equipo Ventas'].message_count, 8);
  assert.equal(byName['Banco, S.A. "Atención"'].message_count, 2);
  assert.equal(byName['Banco, S.A. "Atención"'].archived, true);

  const anaJson = JSON.parse(f[byName['Ana López'].files.json]);
  assert.equal(anaJson.messages.length, 230);
  assert.ok(anaJson.messages.every((m, i, a) => i === 0 || a[i - 1].timestamp <= m.timestamp), 'orden cronologico');
  assert.equal(anaJson.messages[0].text, 'Mensaje 0 con Ana');
  assert.equal(anaJson.messages[0].from_me, true);
  assert.equal(anaJson.messages[0].sender_name, 'Yo');
  assert.equal(anaJson.messages[1].sender_name, 'Ana López');
  assert.match(anaJson.messages[0].id, /^true_5215511111111@c\.us_MSG\d+$/, 'ids con $1 normalizados');
  assert.match(anaJson.messages[0].datetime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);

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
  assert.equal(loc.text, 'Oficina CDMX');
  assert.equal(loc.sender_name, '99887766554433', 'LID sin contacto');
  const reply = gm.find((m) => m.quoted_id);
  assert.equal(reply.quoted_sender, 'Lucía');
  assert.equal(reply.quoted_text, 'Cuando es la junta?');
  assert.equal(gm.find((m) => m.mentions).mentions[0], 'Carlos Ruiz');
  assert.equal(gm.find((m) => m.type === 'document').forwarded, true);
  assert.equal(gm.find((m) => m.type === 'ptt').media.duration, 12);

  const all = parseCsv(f['todos_los_mensajes.csv'].replace(/^﻿/, ''));
  assert.equal(all[0][0], 'chat_id');
  assert.equal(all.length - 1, 240, 'CSV combinado');
  const bankRows = parseCsv(f[byName['Banco, S.A. "Atención"'].files.csv].replace(/^﻿/, ''));
  assert.equal(bankRows.length, 3);
  assert.equal(bankRows[1][1], 'Banco, S.A. "Atención"');
  assert.equal(bankRows[1][10], 'Linea 1\nLinea 2, con coma y "comillas"');
  assert.equal(bankRows[2][10], 'Gracias 🙏 ñandú');
  assert.ok(f['LEEME.txt'].includes('todos_los_mensajes.csv'));

  // ---------- Incremental con firma antigua de loadEarlierMsgs ----------
  await wa.evaluate(() => {
    window.__legacySig = true;
    window.__mock.addNewAnaMessage();
  });
  const r2 = await runFromPopup(context, extId, wa, async (popup) => {
    await popup.check('input[name="onlyNew"]');
    await popup.uncheck('input[name="fmt_csv"]');
  });
  const idx2 = JSON.parse(r2.files['index.json']);
  console.log('ZIP 2:', r2.name, Object.keys(r2.files));
  assert.equal(idx2.message_count, 1, 'solo el mensaje nuevo');
  assert.ok(!('todos_los_mensajes.csv' in r2.files), 'sin CSV');
  const ana2 = JSON.parse(r2.files[idx2.chats.find((c) => c.message_count === 1).files.json]);
  assert.equal(ana2.messages[0].text, 'Mensaje nuevo despues de exportar');

  // ---------- Filtro por nombre y limite por chat ----------
  const r3 = await runFromPopup(context, extId, wa, async (popup) => {
    await popup.uncheck('input[name="onlyNew"]');
    await popup.fill('input[name="nameFilter"]', 'ana');
    await popup.fill('input[name="maxPerChat"]', '100');
  });
  const idx3 = JSON.parse(r3.files['index.json']);
  assert.equal(idx3.chat_count, 1);
  assert.equal(idx3.chats[0].message_count, 100);

  // ---------- El popup recuerda las opciones ----------
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`);
  await popup.waitForSelector('#start');
  assert.equal(await popup.inputValue('input[name="nameFilter"]'), 'ana');
  await popup.close();

  console.log('OK: todas las pruebas pasaron');
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await context.close();
}
process.exit(failed ? 1 : 0);
