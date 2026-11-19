/*
 * Carga la extension en Chromium con el modo desarrollador activo y falla si
 * chrome://extensions muestra cualquier aviso o error del manifest.
 *
 * Uso: node tests/manifest-check.mjs   (EXT_DIR=ruta para probar una copia empaquetada)
 */
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const extDir = path.resolve(process.env.EXT_DIR || path.join(here, '..', 'extension'));

const context = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'wa-manifest-')), {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
let failed = false;
try {
  const page = await context.newPage();
  await page.goto('chrome://extensions');
  const items = await page.evaluate(async () => {
    const call = (fn, ...args) => new Promise((r) => fn(...args, r));
    const dp = chrome.developerPrivate;
    // Chrome solo registra los avisos del manifest con el modo desarrollador activo al cargar.
    await call(dp.updateProfileConfiguration, { inDeveloperMode: true });
    for (const e of await call(dp.getExtensionsInfo, { includeDisabled: true })) await call(dp.reload, e.id, { failQuietly: true });
    await new Promise((r) => setTimeout(r, 1500));
    return (await call(dp.getExtensionsInfo, { includeDisabled: true, includeTerminated: true })).map((e) => ({
      name: e.name,
      state: e.state,
      problems: [...(e.installWarnings || []), ...(e.manifestErrors || []).map((m) => m.message), ...(e.runtimeErrors || []).map((m) => m.message)],
    }));
  });
  const ours = items.find((e) => e.name.startsWith('WAnalisis'));
  if (ours) console.log(`Nombre mostrado: ${ours.name}`);
  if (!ours) throw new Error('La extension no se cargo');
  if (ours.state !== 'ENABLED') throw new Error(`Estado inesperado: ${ours.state}`);
  if (ours.problems.length) throw new Error(`Avisos en chrome://extensions:\n  - ${ours.problems.join('\n  - ')}`);
  console.log('Manifest: OK (sin avisos ni errores en chrome://extensions)');
} catch (e) {
  failed = true;
  console.error(`Manifest: FALLA\n${e.message}`);
} finally {
  await context.close();
}
process.exit(failed ? 1 : 0);
