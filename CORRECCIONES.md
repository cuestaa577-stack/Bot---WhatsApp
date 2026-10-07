# 🛠️ Diagnóstico y corrección: "El bot dejó de responder"

## ¿Qué estaba pasando?

El bot está hecho con **Baileys** (conexión a WhatsApp por código QR, sin la API
de Meta). En este tipo de conexión, el bot "deja de responder" casi siempre por
**una de estas causas**:

1. **Se cayó la conexión** con WhatsApp y el bot **no se reconectó**.
2. **WhatsApp desvinculó el dispositivo (logout)** y el bot se quedó esperando
   para siempre, sin generar un QR nuevo.
3. **El proceso de Node se murió** por un error no controlado (una excepción o
   una promesa rechazada tumbaba todo el bot).
4. **El servidor se reinició/redeployó** y, al no tener disco persistente
   (Render plan gratis), **se perdió la sesión** → había que reescanear el QR.
5. **El host gratuito "se durmió"** por inactividad y dejó de recibir mensajes.

El código original tenía **fallos reales** en los puntos 1, 2 y 3:

- La reconexión solo se intentaba **una vez**; si el arranque fallaba (por
  ejemplo, un fallo de red al consultar la versión de Baileys), el bot **se
  quedaba muerto para siempre**.
- En un **logout**, el bot solo imprimía un mensaje y **no generaba un QR
  nuevo**; quedaba desconectado de forma permanente.
- **No había red de seguridad**: cualquier error no controlado **mataba el
  proceso** (Node 20+ cierra el proceso ante una promesa rechazada).

## ¿Qué se corrigió? (resumen)

| # | Problema | Solución aplicada |
|---|---|---|
| 1 | El proceso moría por cualquier error | **Red de seguridad global** (`uncaughtException` y `unhandledRejection`): se registra el error y el bot **sigue vivo**. |
| 2 | Reconexión frágil (un solo intento) | **Reconexión automática e infinita** con espera progresiva (5s, 10s, 20s… máx. 5 min). Nunca se rinde. |
| 3 | Logout dejaba el bot muerto | **Auto-recuperación de logout**: borra la sesión y **genera un QR nuevo solo**. |
| 4 | Conexión "colgada" sin evento de cierre | **Vigilante (watchdog)** que revisa cada minuto y fuerza la reconexión si el socket no está abierto. |
| 5 | La sesión se perdía al reiniciar | **Respaldo de la sesión de WhatsApp en Supabase** (opcional): sobrevive a reinicios/redeploys sin reescanear el QR. |
| 6 | El host gratuito se duerme | **Keep-alive**: ping al propio `/health` cada 5 min (se activa con `SELF_URL` o en Render automáticamente). |
| 7 | Difícil saber por qué no responde | **Diagnóstico ampliado** en `/` y `/health`: estado, intentos de reconexión, última conexión, último mensaje, si hay sesión guardada, uptime. |

## Archivos modificados

- **`server.js`** — se endureció toda la capa de conexión y arranque.
- **`README.md`** — nueva sección "Cómo se evita que el bot deje de responder"
  + diagnóstico + guía de Supabase.
- **`.env.example`** — nueva variable `SELF_URL`.

## Pruebas realizadas (verificadas)

Se probó el bot con un **simulador de Baileys** que fuerza cada fallo:

- ✅ **Caída de conexión (código 428):** reconecta a los 5s y vuelve a quedar
  "conectado".
- ✅ **Logout (código 401):** borra la sesión y **genera un QR nuevo**.
- ✅ **Error no controlado:** el proceso **sigue vivo** y sigue atendiendo.
- ✅ **Socket "colgado" (sin evento de cierre):** el **vigilante** lo detecta y
  reconecta.

## Qué debes hacer ahora

1. **Sube esta versión** a tu servidor (reemplaza el `server.js` anterior).
2. **Instala/actualiza dependencias**: `npm install`.
3. **Reinicia el bot**: `npm start` (o `pm2 restart bot-whatsapp-2`).
4. **Escanea el QR** una vez en `https://TU-SERVICIO/qr`.
5. Si estás en **Render gratis**, para máxima estabilidad:
   - Activa el **respaldo en Supabase** (SQL en el README) para no reescanear.
   - Pon un **pinger externo** (UptimeRobot, cron-job.org) a `/health` cada 5 min.
   - Mejor aún: muévelo a un **VPS con `pm2`** (disco persistente, 24/7).

> 💡 **Recomendación clave:** para que el bot **nunca** se caiga, lo ideal es un
> **VPS con `pm2`**. Ahí la sesión se conserva y el bot queda encendido 24/7.
> El plan gratis de Render puede reiniciarse o dormirse y siempre será menos
> confiable para una conexión por QR.
