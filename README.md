# WAnalisis

Extensión de Chrome que exporta tus chats de WhatsApp Web, con historial completo, a TXT, JSON y CSV dentro de un solo ZIP. Pensada para analizar conversaciones con Claude.

- **Panel lateral con diseño estilo Apple** (listas agrupadas, controles nativos, modo claro y oscuro) que queda abierto junto a WhatsApp Web: eliges chats, opciones y ves el progreso en vivo.
- **Masivo y rápido:** procesa varios chats en paralelo y escala de forma lineal con el tamaño del historial.
- **Incremental:** en las siguientes corridas exporta solo lo nuevo y salta los chats sin cambios.
- **100 % local:** sin servidores, sin analítica y sin conexiones de red. Chrome bloquea por política cualquier intento de conexión desde la extensión. Ver [Privacidad y seguridad](#privacidad-y-seguridad).

## Instalación

La extensión no está en la Chrome Web Store: se instala a mano en "modo desarrollador". Toma unos dos minutos y no requiere conocimientos técnicos.

**Necesitas** Google Chrome 116 o posterior. Para ver tu versión, abre `chrome://settings/help`. Debería funcionar también en otros navegadores basados en Chromium (Edge, Brave), pero solo está probada en Chrome.

### 1. Descarga la extensión

Elige una de estas dos opciones:

- **Opción A, el ZIP listo:** el archivo `wanalisis-extension-vX.Y.Z.zip` (te lo compartieron o lo generaste con `npm run package`).
- **Opción B, desde GitHub:** en la página del repositorio, botón verde **Code** y luego **Download ZIP**. La extensión es la carpeta `extension` que viene dentro.

### 2. Descomprime en una carpeta permanente

1. Descomprime el ZIP. En Windows: clic derecho y **Extraer todo**. En Mac: doble clic.
2. Mueve la carpeta resultante a un lugar donde no la vayas a borrar, por ejemplo Documentos.

Chrome lee la extensión desde esa carpeta cada vez que se abre. Si la borras o la mueves, la extensión deja de funcionar.

### 3. Activa el modo desarrollador

1. Abre una pestaña nueva, escribe `chrome://extensions` en la barra de direcciones y presiona Enter.
2. Activa el interruptor **Modo de desarrollador**, arriba a la derecha.

### 4. Carga la extensión

1. Haz clic en **Cargar descomprimida**, arriba a la izquierda.
2. Selecciona la carpeta que contiene el archivo `manifest.json`:
   - Con la opción A: la carpeta `wanalisis-extension`. En Windows puede quedar dentro de otra carpeta con un nombre parecido; entra hasta ver `manifest.json`.
   - Con la opción B: la carpeta `extension`.
3. Aparece la tarjeta **WAnalisis: exportar chats de WhatsApp Web**. Si ves un error, revisa que elegiste la carpeta correcta.

### 5. Fija el ícono en la barra

Haz clic en el ícono de rompecabezas (Extensiones), junto a la barra de direcciones, y luego en el alfiler junto a WAnalisis. Así el ícono queda siempre visible.

### 6. Abre WhatsApp Web

1. Abre https://web.whatsapp.com e inicia sesión con el código QR. Si la pestaña ya estaba abierta, recárgala.
2. Haz clic en el ícono de WAnalisis. Se abre el panel lateral con tus chats. El panel está en inglés por defecto; cambia el idioma en **Language**.

### Actualizar a una versión nueva

1. Reemplaza el contenido de la carpeta por el de la versión nueva (misma ubicación).
2. En `chrome://extensions`, presiona el botón de recargar (flecha circular) en la tarjeta de WAnalisis.
3. Recarga la pestaña de WhatsApp Web.

Tus opciones y el registro de la última exportación se conservan.

### Desinstalar

En `chrome://extensions`, presiona **Quitar** en la tarjeta de WAnalisis. Esto borra también las opciones guardadas y el registro de la última exportación. Después puedes borrar la carpeta.

### Problemas comunes

| Síntoma | Solución |
| --- | --- |
| Chrome dice que falta el archivo de manifiesto | Elegiste una carpeta equivocada. Selecciona la que contiene `manifest.json`. |
| El panel dice "Recarga WhatsApp Web" | La pestaña se abrió antes de instalar o actualizar la extensión. Recárgala. |
| No pasa nada al hacer clic en el ícono | Revisa que tu Chrome sea versión 116 o posterior. |
| La extensión desapareció o marca error al abrir Chrome | Se movió o borró su carpeta. Vuelve a cargarla (paso 4). |
| Chrome muestra un aviso sobre extensiones en modo desarrollador | Es normal en extensiones instaladas a mano. |

### Verificar el ZIP (opcional)

`npm run package` imprime la huella SHA-256 del ZIP, y el resultado es reproducible: el mismo código siempre da la misma huella. Quien reciba el archivo puede compararla para confirmar que no fue modificado:

- Windows: `certutil -hashfile wanalisis-extension-v2.4.1.zip SHA256`
- Mac o Linux: `shasum -a 256 wanalisis-extension-v2.4.1.zip`

## Uso

1. Con WhatsApp Web abierto, haz clic en el ícono de la extensión. Se abre el panel lateral con todos tus chats, todos seleccionados.
2. En **Configuración** (pantalla principal):
   - **Idioma:** inglés por defecto; cámbialo a español si lo prefieres.
   - **Formato:** JSON por defecto. Activa también TXT o CSV si los necesitas.
   - **Periodo:** todo el historial, desde una fecha, o solo lo nuevo desde tu última exportación.
3. En **Filtros**:
   - **Incluir grupos:** apágalo para dejar fuera todos los grupos.
   - **Último mensaje:** exporta solo los chats con actividad reciente (último día, semana, mes, 3 meses) o desde una **fecha específica** elegida en el calendario.
4. Ajusta la selección a mano con la búsqueda o con Todos, Personas, Grupos y Archivados.
5. Si necesitas más control, abre **Configuración avanzada** (fila al final de Configuración o ícono de ajustes arriba a la derecha).
6. Haz clic en **Exportar N chats**. El panel muestra avance, mensajes por segundo y tiempo restante. También aparece un indicador pequeño dentro de WhatsApp Web.
7. Al terminar se descarga `whatsapp-export-AAAAMMDD-HHMM.zip`. Si cancelas, se descarga lo exportado hasta ese momento (`-parcial.zip`).

Cada opción tiene un ícono de información (ⓘ): pasa el mouse o haz clic sobre él para ver qué hace.

### Opciones

| Dónde | Opción | Efecto |
| --- | --- | --- |
| Configuración | Idioma | Inglés (por defecto) o español. Cambia el panel, el indicador en WhatsApp Web y los textos legibles de la exportación. |
| Configuración | Formato | JSON (por defecto), TXT (transcripción compacta) y CSV (tabla). Puedes elegir varios. |
| Configuración | Periodo | Qué mensajes se exportan de cada chat: todo el historial, desde una fecha, o solo lo nuevo desde la última exportación completa. |
| Filtros | Incluir grupos | Encendido: chats individuales y grupos. Apagado: solo chats individuales. |
| Filtros | Último mensaje | Fecha del último mensaje enviado o recibido en cada conversación. Solo entran los chats cuyo último mensaje cae en el rango: último día, semana (7 días), mes (30 días), 3 meses (90 días) o desde una fecha específica. No recorta los mensajes de cada chat; para eso está **Periodo**. |
| Avanzada | Velocidad | Cuidadosa (1 chat a la vez con pausas), Normal (2 en paralelo, recomendado) o Rápida (4 en paralelo sin pausas). |
| Avanzada | Tu nombre | Cómo apareces como remitente. Por defecto "Me" en inglés y "Yo" en español. |
| Avanzada | Máximo por chat | Solo los N mensajes más recientes de cada chat. Vacío = sin límite. |
| Avanzada | Mensajes de sistema | Avisos de cifrado, cambios de grupo, llamadas y mensajes eliminados. Desactivado por defecto. |
| Avanzada | Solo mensajes ya cargados | No pide historial a WhatsApp; exporta lo que ya está en memoria. Muy rápido, pero incompleto. |

Las opciones se recuerdan entre sesiones.

### Formato de fechas

- En el panel y en las transcripciones TXT: día/mes/año y hora de 24 h en español (`22/10/2026 14:05`); mes/día/año y hora de 12 h en inglés (`10/22/2026 2:05 PM`).
- En JSON y CSV se usa siempre el estándar ISO 8601 (`2026-10-22T14:05:00-06:00`), que se ordena bien en Excel y no es ambiguo para Claude.

## Contenido del ZIP

```
index.json                 Resumen: chats, conteos, primer y último mensaje, rutas de archivos
txt/<chat>__<id>.txt       Transcripción legible por chat (la opción con menos tokens)
json/<chat>__<id>.json     Metadatos del chat + mensajes estructurados
csv/<chat>__<id>.csv       Un CSV por chat (UTF-8 con BOM, abre bien en Excel)
all_messages.csv           Todos los mensajes en una sola tabla (todos_los_mensajes.csv en español)
README.txt                 Descripción de campos (LEEME.txt en español)
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
| Aislada | No escucha mensajes de otras extensiones ni de sitios web: cualquier intento recibe "Could not establish connection". Tampoco expone archivos a páginas web. |
| Sin rastros en WhatsApp | El registro de la última exportación (ids de chat y fechas) vive en `chrome.storage.local` de la extensión, que es local y no se sincroniza. No escribe nada en el almacenamiento de WhatsApp Web ni en la consola, cuyos mensajes WhatsApp Web podría incluir en sus reportes de errores. |
| El ZIP no sale de tu equipo | Se arma en memoria y se guarda con la descarga normal de Chrome. |

### Cómo verificarlo

1. `npm run audit:privacy` revisa el código y el manifest. Falla si encuentra cualquier mecanismo de envío, URLs externas o permisos de más.
2. `npm test` además carga la extensión en Chrome y falla si `chrome://extensions` muestra cualquier aviso del manifest, y ejecuta la exportación completa con un monitor que registra toda solicitud de red. Falla si hay alguna.
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
- **Análisis cuantitativo** (quién escribe más, horarios, tendencias): sube `all_messages.csv` (o `todos_los_mensajes.csv` si exportaste en español).
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

## Empaquetar

```bash
npm run package               # genera dist/wanalisis-extension-v<versión>.zip e imprime su SHA-256
```

Corre la auditoría de privacidad antes de empaquetar. Para probar el paquete tal como lo recibe otra persona, descomprímelo y ejecuta la prueba contra esa copia: `EXT_DIR=ruta/a/wanalisis-extension node tests/e2e.mjs`.
