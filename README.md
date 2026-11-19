# WAnalisis

Extensión de Chrome que exporta tus chats de WhatsApp Web, con historial completo, a TXT, JSON y CSV dentro de un solo ZIP. Pensada para analizar conversaciones con Claude.

- **Panel lateral** que queda abierto junto a WhatsApp Web: eliges chats, opciones y ves el progreso en vivo.
- **Masivo y rápido:** procesa varios chats en paralelo y escala de forma lineal con el tamaño del historial.
- **Incremental:** en las siguientes corridas exporta solo lo nuevo y salta los chats sin cambios.
- **100 % local:** sin servidores, sin analítica y sin conexiones de red. Chrome bloquea por política cualquier intento de conexión desde la extensión. Ver [Privacidad y seguridad](#privacidad-y-seguridad).

## Instalación (modo desarrollador)

1. Descarga o clona este repositorio.
2. Abre `chrome://extensions` y activa **Modo de desarrollador** (arriba a la derecha).
3. Clic en **Cargar descomprimida** y elige la carpeta `extension/`.
4. Abre (o recarga) https://web.whatsapp.com e inicia sesión.

Requiere Chrome 116 o posterior.

## Uso

1. Con WhatsApp Web abierto, haz clic en el ícono de la extensión. Se abre el panel lateral con todos tus chats.
2. Por defecto todos están seleccionados. Arriba de la lista puedes:
   - **Incluir grupos:** apágalo para dejar fuera todos los grupos.
   - **Último mensaje:** exporta solo los chats con actividad reciente (Día, Semana, Mes o 3 meses). "Cualquiera" no filtra por fecha.
   - Usar la búsqueda o las pestañas (Personas, Grupos, Archivados) para ajustar la selección a mano.
3. Revisa **Opciones** si quieres cambiar formatos, periodo o velocidad.
4. Clic en **Exportar N chats**. El panel muestra avance, mensajes por segundo y tiempo restante. También aparece un indicador pequeño dentro de WhatsApp Web.
5. Al terminar se descarga `whatsapp-export-AAAAMMDD-HHMM.zip`. Si cancelas, se descarga lo exportado hasta ese momento (`-parcial.zip`).

### Opciones

| Opción | Efecto |
| --- | --- |
| Incluir grupos | Encendido: exporta chats individuales y grupos. Apagado: solo chats individuales. |
| Último mensaje | Solo chats cuyo último mensaje cae en el último día, semana (7 días), mes (30 días) o 3 meses (90 días). No recorta los mensajes de cada chat; para eso está **Periodo**. |
| Formatos | TXT (transcripción compacta), JSON (estructurado) y CSV (tabla). Puedes elegir cualquier combinación. |
| Periodo | Todo el historial, desde una fecha, o solo lo nuevo desde la última exportación completa. |
| Velocidad | Cuidadosa (1 chat a la vez con pausas), Normal (2 en paralelo, recomendado) o Rápida (4 en paralelo sin pausas). |
| Tu nombre | Cómo apareces como remitente (por defecto "Yo"). |
| Máximo por chat | Solo los N mensajes más recientes de cada chat (0 = sin límite). |
| Mensajes de sistema | Avisos de cifrado, cambios de grupo, llamadas y mensajes eliminados. Desactivado por defecto. |
| Solo mensajes ya cargados | No pide historial a WhatsApp; exporta lo que ya está en memoria. Muy rápido, pero incompleto. |

Las opciones se recuerdan entre sesiones.

## Contenido del ZIP

```
index.json                 Resumen: chats, conteos, primer y último mensaje, rutas de archivos
txt/<chat>__<id>.txt       Transcripción legible por chat (la opción con menos tokens)
json/<chat>__<id>.json     Metadatos del chat + mensajes estructurados
csv/<chat>__<id>.csv       Un CSV por chat (UTF-8 con BOM, abre bien en Excel)
todos_los_mensajes.csv     Todos los mensajes en una sola tabla
LEEME.txt                  Descripción de campos
```

Ejemplo de TXT (ocupa cerca de un tercio de lo que ocupa el JSON equivalente):

```
Chat: Equipo Ventas (grupo)
Participantes (4): Carlos Ruiz, Lucía, Pedrito, +5215599999999
Mensajes: 8, del 2026-10-22 al 2026-10-22
Exportado: 2026-11-19T02:12:00-06:00

--- 2026-10-22 ---
[12:00] Carlos Ruiz: Hola equipo, bienvenidos
[12:00] Lucía: Cuándo es la junta
[12:00] Yo: [responde a Lucía: "Cuándo es la junta"] El lunes a las 10
[12:00] Pedrito: [imagen] Foto del pizarrón
[12:00] Carlos Ruiz: [nota de voz 12s]
```

Ejemplo de mensaje en JSON:

```json
{
  "id": "false_120363000000000001@g.us_3EB0...",
  "timestamp": 1792670404,
  "datetime": "2026-10-22T12:00:04-06:00",
  "from_me": false,
  "sender_id": "5215544444444@c.us",
  "sender_name": "Pedrito",
  "type": "image",
  "text": "Foto del pizarrón",
  "media": { "mimetype": "image/jpeg", "size": 12345 }
}
```

Los campos opcionales (`quoted_*`, `media`, `location`, `forwarded`, `starred`, `mentions`, `poll_options`) solo aparecen cuando aplican.

Columnas del CSV: `chat_id, chat_name, chat_type, message_id, datetime, timestamp, sender_name, sender_id, from_me, type, text, quoted_sender, quoted_text, forwarded, starred, media_mimetype, media_filename, latitude, longitude`.

## Privacidad y seguridad

Todo el proceso ocurre en la computadora de quien instala la extensión. No hay servidor, cuenta, analítica ni telemetría, y la extensión no hace ninguna conexión de red.

### Qué garantiza la extensión

| Medida | Detalle |
| --- | --- |
| Sin red | El código no contiene `fetch`, `XMLHttpRequest`, `WebSocket` ni ninguna otra vía de envío. Además, las páginas de la extensión tienen una política de seguridad (CSP) con `connect-src 'none'`: aunque alguien agregara código de red, Chrome lo bloquearía. |
| Sin código externo | No usa librerías, CDNs ni fuentes web. Manifest V3 prohíbe ejecutar código descargado de internet. |
| Permisos mínimos | `storage` (guardar tus opciones), `sidePanel` (el panel) y acceso solo a `web.whatsapp.com`. No pide acceso a otros sitios, pestañas, historial ni descargas. |
| Aislada | Bloquea mensajes de otras extensiones y de sitios web (`externally_connectable`) y no expone archivos a páginas web. |
| Sin rastros en WhatsApp | El registro de la última exportación (ids de chat y fechas) vive en `chrome.storage.local` de la extensión, que es local y no se sincroniza. No escribe nada en el almacenamiento de WhatsApp Web ni en la consola, cuyos mensajes WhatsApp Web podría incluir en sus reportes de errores. |
| El ZIP no sale de tu equipo | Se arma en memoria y se guarda con la descarga normal de Chrome. |

### Cómo verificarlo

1. `npm run audit:privacy` revisa el código y el manifest. Falla si encuentra cualquier mecanismo de envío, URLs externas o permisos de más.
2. `npm test` ejecuta la exportación completa con un monitor que registra toda solicitud de red. Falla si hay alguna.
3. A mano: en WhatsApp Web abre DevTools (F12), pestaña **Network**, y exporta. La extensión no genera solicitudes. El único tráfico es el normal de WhatsApp Web al cargar mensajes antiguos, igual que cuando haces scroll hacia arriba en un chat.

### Riesgos que dependen de tu entorno

La extensión no puede controlar estos puntos; conviene revisarlos:

- **Otras extensiones:** cualquier extensión con acceso a `web.whatsapp.com` puede leer tus chats directamente, con o sin esta herramienta. Para exportar, usa un perfil de Chrome dedicado que solo tenga esta extensión.
- **Carpeta de Descargas en la nube:** si tu carpeta de Descargas se respalda en OneDrive, iCloud, Google Drive o Dropbox, el ZIP se subirá ahí. Activa "Preguntar dónde se guardará cada archivo" en `chrome://settings/downloads` y guárdalo en una carpeta no sincronizada o cifrada. Borra el ZIP cuando ya no lo necesites.
- **Análisis de descargas de Chrome:** Chrome revisa las descargas en busca de malware. Con la Protección mejorada de Navegación segura puede pedirte permiso para enviar un archivo a Google para un análisis profundo; rechaza esa opción para este ZIP. En equipos administrados por una empresa, sus políticas también pueden inspeccionar descargas.
- **Instalación:** instala desde una copia del código que hayas revisado. Una extensión cargada desde una carpeta no se actualiza sola, así que nadie puede cambiar su código sin que tú lo vuelvas a cargar.
- **Uso con Claude:** subir los archivos a Claude es compartirlos con Anthropic. Sube solo lo que quieras analizar.

## Uso con Claude

- **Leer y resumir conversaciones:** sube los `.txt` de los chats que te interesen.
- **Análisis cuantitativo** (quién escribe más, horarios, tendencias): sube `todos_los_mensajes.csv`.
- **Muchos chats:** empieza por `index.json` para que Claude vea el panorama y elija qué revisar.

## Cómo funciona

| Archivo | Rol |
| --- | --- |
| `extension/src/page/exporter.js` | Corre en el contexto de la página (`world: "MAIN"`) y usa los módulos internos de WhatsApp Web (`WAWebCollections`, `WAWebChatLoadMessages`), el mismo enfoque de [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js). Carga el historial con `loadEarlierMsgs` hasta el inicio de cada chat, normaliza mensajes y arma el ZIP con `CompressionStream` nativo, sin dependencias. |
| `extension/src/content/bridge.js` | Puente RPC entre el panel y la página. |
| `extension/src/panel/` | Panel lateral: selección, opciones, progreso y resultado. |
| `extension/src/background/service-worker.js` | Abre el panel al hacer clic en el ícono. |

Detalles de eficiencia:

- Cada vuelta de carga procesa solo el lote nuevo (costo lineal; antes era cuadrático en chats grandes).
- Varios chats se cargan en paralelo según la velocidad elegida.
- El CSV combinado se comprime en flujo mientras se exporta, sin guardar una segunda copia sin comprimir en memoria.
- En modo incremental, los chats sin actividad desde la última exportación se saltan sin pedir historial.
- Si falla la carga de historial a mitad de un chat, se conserva lo cargado y se reporta como aviso.

## Limitaciones

- **Historial disponible:** WhatsApp Web solo puede cargar lo que tu teléfono sincronizó al vincular el dispositivo, más lo que pide bajo demanda al teléfono. Mantén el teléfono conectado a internet durante la exportación. Si un chat trae menos mensajes de los esperados, ábrelo en WhatsApp Web, desplázate hacia arriba para forzar la sincronización y vuelve a exportar.
- **Multimedia:** no se descargan fotos, audios ni documentos; se exportan sus metadatos y pies de foto.
- **Cambios de WhatsApp:** si WhatsApp renombra sus módulos internos, la extensión muestra un error claro. Los nombres están centralizados en `MODULES` dentro de `exporter.js`.
- **Tamaño:** el ZIP se arma en memoria; el límite es 4 GB (sin ZIP64). Para cuentas enormes exporta por partes con el filtro de fecha o la selección de chats.
- **Términos de servicio:** úsalo solo con tu propia cuenta y tus propias conversaciones. Esta herramienta no está afiliada a WhatsApp ni a Meta.

## Pruebas

La prueba end-to-end carga la extensión real en Chromium, simula WhatsApp Web interceptando `https://web.whatsapp.com/`, maneja el panel lateral como lo haría una persona y valida cada ZIP: conteos (incluye un chat de 20 000 mensajes), orden, ausencia de duplicados, formato TXT, CSV con comas y saltos de línea, ids con formato nuevo `$1`, firma antigua de `loadEarlierMsgs`, modo incremental, selección manual, filtros de grupos y de fecha del último mensaje, cancelación con descarga parcial y persistencia de opciones. Durante todo el flujo registra cada solicitud de red y falla si aparece alguna, y verifica que no quede ningún rastro en el almacenamiento de WhatsApp Web. Antes corre la auditoría estática de privacidad.

```bash
npm install
npx playwright install chromium
npm test                      # SCREENSHOTS=capturas npm test guarda capturas del panel
```
