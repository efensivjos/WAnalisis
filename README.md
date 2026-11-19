# WAnalisis

Extensión de Chrome que exporta tus chats de WhatsApp Web, con historial completo, a TXT, JSON y CSV dentro de un solo ZIP. Pensada para analizar conversaciones con Claude.

- **Panel lateral** que queda abierto junto a WhatsApp Web: eliges chats, opciones y ves el progreso en vivo.
- **Masivo y rápido:** procesa varios chats en paralelo y escala de forma lineal con el tamaño del historial.
- **Incremental:** en las siguientes corridas exporta solo lo nuevo y salta los chats sin cambios.
- **Privado:** todo ocurre en tu navegador. No hay servidores ni envío de datos a terceros.

## Instalación (modo desarrollador)

1. Descarga o clona este repositorio.
2. Abre `chrome://extensions` y activa **Modo de desarrollador** (arriba a la derecha).
3. Clic en **Cargar descomprimida** y elige la carpeta `extension/`.
4. Abre (o recarga) https://web.whatsapp.com e inicia sesión.

Requiere Chrome 116 o posterior.

## Uso

1. Con WhatsApp Web abierto, haz clic en el ícono de la extensión. Se abre el panel lateral con todos tus chats.
2. Por defecto todos están seleccionados. Usa la búsqueda o los filtros (Personas, Grupos, Archivados) para ajustar la selección.
3. Revisa **Opciones** si quieres cambiar formatos, periodo o velocidad.
4. Clic en **Exportar N chats**. El panel muestra avance, mensajes por segundo y tiempo restante. También aparece un indicador pequeño dentro de WhatsApp Web.
5. Al terminar se descarga `whatsapp-export-AAAAMMDD-HHMM.zip`. Si cancelas, se descarga lo exportado hasta ese momento (`-parcial.zip`).

### Opciones

| Opción | Efecto |
| --- | --- |
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

La prueba end-to-end carga la extensión real en Chromium, simula WhatsApp Web interceptando `https://web.whatsapp.com/`, maneja el panel lateral como lo haría una persona y valida cada ZIP: conteos (incluye un chat de 20 000 mensajes), orden, ausencia de duplicados, formato TXT, CSV con comas y saltos de línea, ids con formato nuevo `$1`, firma antigua de `loadEarlierMsgs`, modo incremental, selección manual, cancelación con descarga parcial y persistencia de opciones.

```bash
npm install
npx playwright install chromium
npm test                      # SCREENSHOTS=capturas npm test guarda capturas del panel
```
