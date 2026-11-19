/*
 * Empaqueta la carpeta extension/ en dist/wanalisis-extension-v<version>.zip,
 * listo para descomprimir y cargar en chrome://extensions ("Cargar descomprimida").
 * Sin dependencias: usa zlib de Node 22+. Imprime el SHA-256 para verificar la descarga.
 *
 * Uso: npm run package
 */
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'extension');
const { version } = JSON.parse(readFileSync(path.join(src, 'manifest.json'), 'utf8'));
const folder = 'wanalisis-extension';
const out = path.join(root, 'dist', `${folder}-v${version}.zip`);

function walk(dir) {
  return readdirSync(dir)
    .filter((n) => !n.startsWith('.'))
    .sort()
    .flatMap((n) => {
      const p = path.join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

// Fecha fija para que el ZIP sea reproducible (mismo contenido, mismo hash).
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

const INSTALL_TXT = `WAnalisis ${version}: exportar chats de WhatsApp Web

Instalación en Google Chrome (versión 116 o posterior):

1. Mueve esta carpeta (wanalisis-extension) a un lugar donde no la vayas a borrar,
   por ejemplo Documentos. Chrome la lee desde ahí cada vez que se abre.
2. Abre una pestaña nueva y entra a chrome://extensions
3. Activa "Modo de desarrollador" (arriba a la derecha).
4. Haz clic en "Cargar descomprimida" y selecciona esta carpeta
   (la que contiene el archivo manifest.json).
5. Fija el ícono: clic en el rompecabezas junto a la barra de direcciones
   y luego en el alfiler junto a WAnalisis.
6. Abre https://web.whatsapp.com, inicia sesión y haz clic en el ícono
   de WAnalisis para abrir el panel.

Actualizar: reemplaza el contenido de esta carpeta, pulsa el botón de recargar
de la extensión en chrome://extensions y recarga WhatsApp Web.

Todo se procesa en tu equipo. La extensión no se conecta a internet.
`.replace(/\n/g, '\r\n');

const entries = walk(src).map((file) => ({
  name: `${folder}/${path.relative(src, file).split(path.sep).join('/')}`,
  data: readFileSync(file),
}));
entries.push({ name: `${folder}/INSTALAR.txt`, data: Buffer.from('\ufeff' + INSTALL_TXT, 'utf8') });

const parts = [];
const central = [];
let offset = 0;
const files = entries;
for (const entry of entries) {
  const name = Buffer.from(entry.name);
  const data = entry.data;
  const crc = zlib.crc32(data);
  const deflated = zlib.deflateRawSync(data, { level: 9 });
  const useDeflate = deflated.length < data.length;
  const body = useDeflate ? deflated : data;
  const method = useDeflate ? 8 : 0;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);

  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0);
  cen.writeUInt16LE(20, 4);
  cen.writeUInt16LE(20, 6);
  cen.writeUInt16LE(0x0800, 8);
  cen.writeUInt16LE(method, 10);
  cen.writeUInt16LE(DOS_TIME, 12);
  cen.writeUInt16LE(DOS_DATE, 14);
  cen.writeUInt32LE(crc, 16);
  cen.writeUInt32LE(body.length, 20);
  cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(name.length, 28);
  cen.writeUInt32LE(offset, 42);

  parts.push(local, name, body);
  central.push(cen, name);
  offset += 30 + name.length + body.length;
}
const cd = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cd.length, 12);
end.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...parts, cd, end]);

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, zip);
const sha = createHash('sha256').update(zip).digest('hex');
console.log(`${path.relative(root, out)} (${(zip.length / 1024).toFixed(1)} KB, ${files.length} archivos)`);
console.log(`SHA-256: ${sha}`);
