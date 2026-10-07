# 🤖 bot-whatsapp-2

Bot de WhatsApp que se conecta **por CÓDIGO QR** (librería **Baileys**), **sin la
API oficial de Meta**. Es una versión del bot `anderson-whatsapp-bot` que conserva
**toda la lógica de atención** (menú de trámites, precios, consulta de cédula,
licencia, antecedentes, preguntas frecuentes, IA de respaldo, transcripción de
audios, seguimiento automático, etc.) pero conectada directamente a un número de
WhatsApp Business.

> **Número del bot:** +57 322 666 2517

---

## 🧠 ¿Cómo funciona la conexión por QR?

1. El bot arranca y muestra un **código QR** en una página web (`/qr`).
2. Abres **WhatsApp Business** en el teléfono del número **+57 322 666 2517**.
3. Vas a **Ajustes → Dispositivos vinculados → Vincular un dispositivo**.
4. Escaneas el QR. ✅ Listo: el bot queda conectado y empieza a responder.

No necesitas Meta Business, ni tokens, ni verificación. Solo escanear el QR una vez.

---

## 🚀 Puesta en marcha (local)

```bash
npm install
cp .env.example .env      # rellena GROQ_API_KEY (y lo demás que uses)
npm start
```

Luego abre en el navegador:

- **http://localhost:10000/qr** → para ver y escanear el código QR.
- **http://localhost:10000/health** → debe responder `{"ok":true,"status":"..."}`.

---

## ☁️ Despliegue en un servidor (para que quede 24/7)

El bot necesita estar **siempre encendido**. Opciones:

### Opción 1 — VPS (recomendado)
Un servidor pequeño (Ubuntu) con Node.js 20+. Subes el proyecto, corres
`npm install && npm start` (idealmente con **pm2** para que se reinicie solo):

```bash
npm install -g pm2
pm2 start server.js --name bot-whatsapp-2
pm2 save && pm2 startup
```

Abre el puerto del servicio y entra a `http://TU-IP:10000/qr` para escanear el QR.

### Opción 2 — Render
1. Sube el proyecto a GitHub.
2. **New + → Web Service**, conecta el repo. Render lee `render.yaml`.
3. Añade las variables de entorno (ver abajo).
4. Abre `https://TU-SERVICIO.onrender.com/qr` y escanea el QR.

> ⚠️ **Importante en Render (plan gratis):** el disco no es persistente, así que
> la sesión (`auth_baileys/`) se borra en cada redeploy y habría que **volver a
> escanear el QR**. Para producción, usa un **VPS** o un **disco persistente** de
> Render (plan pago).

---

## 🔑 Variables de entorno

| Variable | Descripción | ¿Obligatoria? |
|---|---|---|
| `PORT` | Puerto del servidor | No (por defecto `10000`) |
| `BOT_NAME` | Nombre del dispositivo vinculado | No |
| `AUTH_DIR` | Carpeta de la sesión (por defecto `./auth_baileys`) | No |
| `GROQ_API_KEY` | Clave de Groq (IA de respaldo + transcripción de audios) | **Sí** (para IA/audios) |
| `GROQ_MODEL` | Modelo de Groq | No |
| `ADMIN_PHONE` | Número del dueño para **comandos** al bot | No |
| `ADMIN_NOTIFICATIONS_ENABLED` | Reenviar copias de avisos al admin (`true`/`false`) | No (por defecto `false`) |
| `CEDULA_APP_ID` / `CEDULA_TOKEN` | API oficial de consulta de cédula | Recomendado |

> 🔎 **Consulta de cédula:** con `CEDULA_APP_ID` y `CEDULA_TOKEN` configurados, el
> bot usa la **API oficial** y devuelve **todos los datos**: nacionalidad, cédula,
> **fecha de nacimiento**, nombre completo, RIF y **datos electorales** (estado,
> municipio, parroquia y centro electoral).
>
> Si la API oficial falla (por ejemplo, límite de consultas) o **no** configuras
> esas credenciales, el bot usa automáticamente un **respaldo web gratuito** que
> devuelve cédula, RIF, nombre y, cuando existe, el estado donde vota.
| `SUPABASE_URL` / `SUPABASE_KEY` | Respaldo de sesiones **y de la sesión de WhatsApp** en Supabase | No |
| `SELF_URL` | URL pública del servicio (para el keep-alive). En Render se toma sola | No |

> 📌 **Avisos al administrador DESACTIVADOS por defecto:** como el bot responde
> desde el mismo número donde llega toda la información, no reenvía copias. Si
> algún día las quieres, pon `ADMIN_NOTIFICATIONS_ENABLED=true` y configura
> `ADMIN_PHONE`.

---

## 🔌 Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/` | Estado del bot (JSON) |
| `GET` | `/health` | Salud del servidor |
| `GET` | `/estado` | Página de estado legible (¿el bot responde?) |
| `GET` | `/qr` | Página para escanear el código QR |
| `GET` | `/pair` | Vincular con el código de 8 dígitos (por número) |
| `GET` | `/selftest` | Envía un mensaje de prueba para verificar el envío |

---

## 📌 Comandos del administrador (por WhatsApp)

Si configuras `ADMIN_PHONE` con tu número personal, puedes escribirle al bot:

- `clientes` → ver la tabla de clientes y su etapa.
- `cliente <número>` → ver el detalle de un cliente.
- `cliente <número> <etapa>` → cambiar la etapa de un cliente.
- `estado` → estado del bot.
- `probar cedula <número>` → probar la consulta de cédula.
- `ver instrucciones` / `borrar instrucciones` → gestionar instrucciones temporales.

---

## 🛡️ Cómo se evita que el bot "deje de responder"

Esta versión trae **auto-recuperación** para que el bot siga funcionando sin que
tengas que reiniciarlo a mano:

1. **Nunca se cae por un error puntual.** Hay una red de seguridad global
   (`uncaughtException` y `unhandledRejection`): si algo falla, se registra en el
   log y el bot **sigue vivo**.
2. **Reconexión automática e infinita.** Si se cae la conexión con WhatsApp, el
   bot reintenta solo con espera progresiva (5s, 10s, 20s… hasta 5 min) y **no
   se rinde**. Antes, si el arranque fallaba una vez, se quedaba muerto.
3. **Vigilante (watchdog).** Cada minuto revisa la conexión; si el socket quedó
   "colgado" (dice conectado pero no lo está), fuerza la reconexión.
4. **Recuperación de logout.** Si WhatsApp desvincula el dispositivo (logout),
   el bot **borra la sesión y genera un QR nuevo solo**, para que vuelvas a
   escanear sin tocar el servidor.
5. **Sesión de WhatsApp persistente (opcional, con Supabase).** Guarda la sesión
   en Supabase para que **sobreviva a reinicios/redeploys** en hosts sin disco
   persistente (como Render gratis) y **no haya que reescanear el QR**.
6. **Keep-alive (opcional).** Hace ping a su propio `/health` cada 5 min para
   reducir que un host gratuito "duerma".

### Diagnóstico rápido (por qué no responde)

Abre en el navegador:

- `https://TU-SERVICIO/estado` → página legible: dice de un vistazo si el bot
  está conectado, cuándo fue la última conexión y si la sesión está guardada.
- `https://TU-SERVICIO/` → JSON con `status`, `intentosReconexion`,
  `ultimaConexion`, `ultimoMensajeRecibido`, `sesionGuardada`, `uptimeSegundos`.
- `https://TU-SERVICIO/health` → salud resumida.
- `https://TU-SERVICIO/qr` → si muestra un QR, la sesión se perdió y hay que
  volver a escanear; si dice "Bot conectado", la conexión está bien.
- `https://TU-SERVICIO/pair` → código de 8 dígitos para vincular por número
  (alternativa al QR, más confiable).

Interpretación de `status`:

| `status` | Significado | Qué hacer |
|---|---|---|
| `conectado` | Todo bien | — |
| `esperando_qr` | Falta vincular el dispositivo | Escanear el QR en `/qr` |
| `desconectado` | Se cayó y está reconectando | Esperar; se recupera solo |
| `iniciando` | Arrancando | Esperar unos segundos |

### Para que quede 24/7 sin caídas (recomendado)

- **Mejor opción: un VPS** con `pm2` (disco persistente → la sesión se conserva y
  no hay que reescanear). Ver la sección de despliegue arriba.
- **Si usas Render gratis:** activa el respaldo en **Supabase** (abajo) y pon un
  *pinger* externo (UptimeRobot, cron-job.org) apuntando a `/health` cada 5 min
  para que no se duerma. Ten en cuenta que el plan gratis puede reiniciarse.
- **Mantén la librería Baileys actualizada** (`npm install @whiskeysockets/baileys@latest`),
  porque WhatsApp cambia sus protocolos con frecuencia.

### Activar el respaldo de la sesión de WhatsApp en Supabase

1. En tu proyecto de Supabase, abre **SQL Editor** y ejecuta:

```sql
create table if not exists baileys_auth (
  id text primary key,
  value text,
  updated_at timestamptz default now()
);
```

2. Configura `SUPABASE_URL` y `SUPABASE_KEY` en las variables de entorno.
3. Listo: el bot respaldará la sesión cada 5 minutos y la restaurará sola al
   arrancar. Si Supabase no está configurado, todo esto se ignora sin afectar al
   bot.

---

## ⚠️ Consideraciones sobre la conexión por QR (Baileys)

- Es una conexión **no oficial**: WhatsApp podría **bloquear el número** si se usa
  con envíos masivos o automatización agresiva. Úsalo con moderación.
- El servidor debe quedar **siempre encendido**; si se apaga, el bot se desconecta
  (se reconecta solo al reiniciar, sin reescanear, si la sesión se conserva).
- Si se cierra la sesión (logout), hay que **borrar la carpeta `auth_baileys/`** y
  **volver a escanear el QR**.
- Mantén la librería Baileys actualizada, porque WhatsApp cambia sus protocolos.

---

## 🖼️ Vista previa

La página del QR (`/qr`) se ve así: ver `vista-previa-qr.png`.

---

## 📌 Diferencias con el bot original

- **Conexión:** Baileys por QR (antes: WhatsApp Cloud API de Meta).
- **Sin tokens de Meta:** se eliminan `WHATSAPP_ACCESS_TOKEN`,
  `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` y el webhook.
- **Avisos al administrador desactivados por defecto** (configurable).
- **Se elimina** el módulo "Programador IA / Autopiloto" de Habla'App (no aplica).
- **Se conserva** toda la lógica de conversación, precios, cédula, FAQ, IA y audios.
