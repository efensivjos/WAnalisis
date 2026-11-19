/*
 * Auditoria estatica de privacidad: falla si el codigo de la extension contiene
 * cualquier mecanismo capaz de enviar datos fuera del navegador, o si el
 * manifest pide mas permisos de los necesarios.
 *
 * Uso: node tests/privacy-audit.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const problems = [];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// URLs permitidas en el codigo: el sitio donde corre y el namespace de SVG (no es una conexion).
const ALLOWED_URLS = ['https://web.whatsapp.com/', 'http://www.w3.org/2000/svg'];

const FORBIDDEN = [
  [/\bfetch\s*\(/, 'fetch()'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\bEventSource\b/, 'EventSource'],
  [/\bRTCPeerConnection\b/, 'WebRTC'],
  [/\bsendBeacon\b/, 'navigator.sendBeacon'],
  [/\bimportScripts\b/, 'importScripts'],
  [/\bimport\s*\(/, 'import() dinamico'],
  [/\beval\s*\(/, 'eval()'],
  [/\bnew\s+Function\b/, 'new Function'],
  [/\bstorage\.sync\b/, 'chrome.storage.sync (se sincroniza con la nube)'],
  [/\b(connectExternal|onMessageExternal|onConnectExternal)\b/, 'mensajeria externa'],
  [/\bchrome\.(identity|cookies|webRequest|history|bookmarks|downloads)\b/, 'API de Chrome no necesaria'],
  [/\.src\s*=\s*['"`]https?:/, 'carga de recurso remoto'],
  [/<script[^>]+src=["']https?:/i, 'script remoto'],
  [/<link[^>]+href=["']https?:/i, 'hoja de estilos remota'],
  [/@import\b/, '@import en CSS'],
  [/url\(\s*['"]?https?:/i, 'url() remota en CSS'],
];

for (const file of walk(root)) {
  const rel = path.relative(root, file);
  if (!/\.(js|mjs|html|css|json)$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  for (const [re, label] of FORBIDDEN) {
    const m = text.match(re);
    if (m) problems.push(`${rel}: ${label} (${m[0]})`);
  }
  for (const m of text.matchAll(/https?:\/\/[^\s'"`)<>]+/g)) {
    if (!ALLOWED_URLS.some((u) => m[0].startsWith(u))) problems.push(`${rel}: URL no permitida ${m[0]}`);
  }
}

// Manifest: permisos minimos y politicas de aislamiento.
const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const eq = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...b].sort());
if (!eq(manifest.permissions, ['storage', 'sidePanel'])) problems.push(`manifest: permisos inesperados ${JSON.stringify(manifest.permissions)}`);
if (!eq(manifest.host_permissions, ['https://web.whatsapp.com/*'])) problems.push(`manifest: host_permissions inesperados ${JSON.stringify(manifest.host_permissions)}`);
if (manifest.optional_permissions || manifest.optional_host_permissions) problems.push('manifest: no debe pedir permisos opcionales');
if (manifest.web_accessible_resources) problems.push('manifest: no debe exponer recursos a sitios web');
if (manifest.update_url) problems.push('manifest: no debe tener update_url (actualizaciones remotas)');
const csp = manifest.content_security_policy?.extension_pages || '';
for (const d of ["default-src 'none'", "connect-src 'none'", "script-src 'self'"]) {
  if (!csp.includes(d)) problems.push(`manifest: la CSP debe incluir ${d}`);
}
// Sin externally_connectable, los sitios web no pueden enviar mensajes a la extension, y otras
// extensiones solo podrian hacerlo si existieran listeners externos (prohibidos arriba).
// Declararlo vacio no agrega proteccion y Chrome lo marca como aviso.
if (manifest.externally_connectable) problems.push('manifest: no debe declarar externally_connectable');
for (const cs of manifest.content_scripts || []) {
  if (!eq(cs.matches, ['https://web.whatsapp.com/*'])) problems.push(`manifest: content script fuera de WhatsApp Web ${JSON.stringify(cs.matches)}`);
}

if (problems.length) {
  console.error('Auditoria de privacidad: FALLA');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('Auditoria de privacidad: OK (sin red, sin sincronizacion, permisos minimos)');
