# WAnalisis

Extensión de Chrome que exporta **todos** tus chats de WhatsApp Web, con historial completo, a JSON y CSV dentro de un solo ZIP. Pensada para analizar conversaciones con Claude.

- Un clic: recorre todos los chats, carga el historial hacia atrás y descarga el ZIP.
- Todo ocurre en tu navegador. No hay servidores ni envío de datos a terceros.
- Exportación incremental: en las siguientes corridas puede bajar solo los mensajes nuevos.

## Instalación (modo desarrollador)

1. Descarga o clona este repositorio.
2. Abre `chrome://extensions` y activa **Modo de desarrollador** (arriba a la derecha).
3. Clic en **Cargar descomprimida** y elige la carpeta `extension/`.
4. Abre (o recarga) https://web.whatsapp.com e inicia sesión.

## Uso

1. Espera a que cargue la lista de chats en WhatsApp Web.
2. Clic en el ícono de la extensión y luego en **Exportar todo**.
3. Aparece un panel de progreso en la esquina de WhatsApp Web. Puedes cerrar el popup; la exportación sigue en la pestaña. Deja la pestaña abierta hasta que termine.
4. Al terminar se descarga `whatsapp-export-AAAAMMDD-HHMM.zip`. Si cancelas, se descarga lo exportado hasta ese momento (`-parcial.zip`).

### Opciones

| Opción | Efecto |
| --- | --- |
| Formato JSON / CSV | Qué archivos generar (puedes elegir ambos). |
| Individuales / Grupos / Archivados | Qué chats incluir. Estados y canales siempre se excluyen. |
| Solo chats que contengan | Filtra por nombre del chat. |
| Cargar historial completo | Pide a WhatsApp los mensajes anteriores hasta el inicio de cada chat. Si lo desactivas, solo exporta lo que ya está cargado en memoria (muy rápido). |
| Solo mensajes nuevos | Exporta únicamente lo recibido desde la última exportación completa. |
| Incluir mensajes de sistema | Avisos de cifrado, cambios de grupo, llamadas, mensajes eliminados. |
| Desde | Fecha mínima de los mensajes. |
| Máx. por chat | Mensajes más recientes por chat (0 = sin límite). |
| Tu nombre | Cómo apareces como remitente (por defecto "Yo"). |
| Pausa entre cargas | Milisegundos entre solicitudes de historial. Súbelo si ves cortes. |

## Contenido del ZIP

```
index.json                 Lista de chats: id, nombre, tipo, conteo, primer y último mensaje, rutas
json/<chat>__<id>.json     Un archivo por chat: metadatos + mensajes
csv/<chat>__<id>.csv       Un archivo por chat (UTF-8 con BOM, abre bien en Excel)
todos_los_mensajes.csv     Todos los mensajes en una sola tabla
LEEME.txt                  Descripción de campos
```

Ejemplo de mensaje en JSON:

```json
{
  "id": "false_5215511111111@c.us_3EB0...",
  "timestamp": 1792670404,
  "datetime": "2026-10-22T12:00:04-06:00",
  "from_me": false,
  "sender_id": "5215511111111@c.us",
  "sender_name": "Ana López",
  "type": "image",
  "text": "Foto del pizarrón",
  "quoted_sender": "Lucía",
  "quoted_text": "Cuándo es la junta",
  "media": { "mimetype": "image/jpeg", "size": 12345 }
}
```

Los campos opcionales (`quoted_*`, `media`, `location`, `forwarded`, `starred`, `mentions`, `poll_options`) solo aparecen cuando aplican, para reducir tamaño y tokens.

Columnas del CSV: `chat_id, chat_name, chat_type, message_id, datetime, timestamp, sender_name, sender_id, from_me, type, text, quoted_sender, quoted_text, forwarded, starred, media_mimetype, media_filename, latitude, longitude`.

## Uso con Claude

- Análisis de una conversación: sube `json/<chat>.json`.
- Análisis global o búsqueda transversal: sube `todos_los_mensajes.csv` (o usa la herramienta de análisis de datos con el CSV).
- Para muchos chats, sube primero `index.json` para que Claude vea el panorama y elija qué archivos revisar.

## Cómo funciona

- `extension/src/page/exporter.js` corre en el contexto de la página (`world: "MAIN"`) y usa los módulos internos de WhatsApp Web (`WAWebCollections`, `WAWebChatLoadMessages`, etc.), el mismo enfoque que usa [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js). Para cada chat llama a `loadEarlierMsgs` hasta que WhatsApp indica que no hay mensajes anteriores, normaliza los mensajes y arma el ZIP con `CompressionStream` nativo (sin dependencias).
- `extension/src/content/bridge.js` comunica el popup con la página.
- `extension/src/popup/` es la interfaz de opciones y progreso.

## Limitaciones

- **Historial disponible:** WhatsApp Web solo puede cargar lo que tu teléfono sincronizó al vincular el dispositivo, más lo que pide bajo demanda al teléfono. Mantén el teléfono conectado a internet durante la exportación. Si un chat muestra menos mensajes de los esperados, abre ese chat en WhatsApp Web, desplázate hacia arriba para forzar la sincronización y vuelve a exportar.
- **Multimedia:** no se descargan fotos, audios ni documentos; se exportan sus metadatos y pies de foto.
- **Cambios de WhatsApp:** si WhatsApp renombra sus módulos internos, la extensión mostrará un error claro. Los nombres están centralizados en `MODULES` dentro de `exporter.js` para actualizarlos fácilmente.
- **Tamaño:** el ZIP se arma en memoria; el límite es 4 GB (sin ZIP64). Para cuentas muy grandes usa el filtro de fecha o nombre.
- **Términos de servicio:** úsalo solo con tu propia cuenta y tus propias conversaciones. Esta herramienta no está afiliada a WhatsApp ni a Meta.

## Pruebas

La prueba end-to-end carga la extensión real en Chromium, simula WhatsApp Web interceptando `https://web.whatsapp.com/` y valida el ZIP (conteos, orden, CSV con comas y saltos de línea, ids con formato nuevo `$1`, firma antigua de `loadEarlierMsgs`, modo incremental, filtros).

```bash
npm install   # instala Playwright
npx playwright install chromium
npm test
```
