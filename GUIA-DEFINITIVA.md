# ✅ Guía definitiva — Bot de WhatsApp que NO deja de responder (v3)

Esta guía resume **el estado actual**, **cómo vincular el bot** (2 métodos),
**qué se verificó**, **qué se mejoró** y **cómo dejarlo funcionando 24/7**.

---

## 0) Estado actual (¡ya está vinculado!)

El bot quedó **conectado** a WhatsApp con el número **+57 322 666 2517**
(nombre de dispositivo: **Gestion - Venezuela**):

- `registered: True` en la sesión guardada.
- `status: conectado` en `/health`.
- **Reconecta solo** al reiniciar el servidor (no hay que volver a escanear).
- **Envía mensajes** correctamente (probado con `/selftest`).

> La sesión se guarda en la carpeta `auth_baileys/`. Mientras esa carpeta se
> conserve, **el bot NO pide QR otra vez**.

---

## 1) Cómo vincular el bot (si algún día hay que rehacerlo)

Hay **dos métodos**. El **código por número es el más confiable** (no depende de
la cámara ni de escanear a tiempo).

### 🔑 Método A — Código por número (RECOMENDADO)
1. Abre en el navegador: **`https://TU-SERVICIO/pair`**
2. Verás un **código de 8 dígitos** (ej.: `G8Q8 41B6`).
3. En el teléfono abre **WhatsApp** → **Ajustes** → **Dispositivos vinculados**
   → **Vincular un dispositivo** → **Vincular con el número del teléfono**.
4. Escribe el código de 8 dígitos.

> El código caduca en ~1 minuto. La página `/pair` **se actualiza sola cada 10 s**
> con un código nuevo, así que siempre verás uno vigente.

### 📲 Método B — Código QR
1. Abre: **`https://TU-SERVICIO/qr`**
2. En el teléfono: **WhatsApp** → **Ajustes** → **Dispositivos vinculados**
   → **Vincular un dispositivo** → escanea el QR.
3. La página **se actualiza sola cada 5 s** para mostrarte siempre el QR más
   reciente (antes mostraba uno viejo y por eso fallaba con
   *"No se pudo vincular el dispositivo"*).

> **Ambos métodos funcionan al mismo tiempo.** Se probó que pedir el código por
> número **no cancela** el QR, así que puedes usar el que prefieras.

---

## 2) Qué se verificó (con pruebas reales)

### Lógica de atención (14 casos) — TODOS OK ✅
| Caso | Resultado |
|---|---|
| "hola" | Muestra el menú ✅ |
| "1" (renovación) | Cotiza 35.000 COP ✅ |
| "5" (licencia) | Pide el grado ✅ |
| "6" (antecedentes) | Cotiza 28.000 COP ✅ |
| "7" (verificar C.I) | Pide la cédula ✅ |
| "8" (asesor) | Avisa que envió la solicitud ✅ |
| Precio directo | Cotiza correctamente ✅ |
| Métodos de pago | Responde la FAQ ✅ |
| "¿entregan en físico?" | Respuesta exacta configurada ✅ |
| Pregunta abierta | Responde la IA (Groq) ✅ |
| Descuento por referido | Ofrece el descuento ✅ |

### Resiliencia de conexión — TODAS OK ✅
| Prueba | Resultado |
|---|---|
| Caída de conexión (código 428) | Reconecta a los 5s ✅ |
| Logout de WhatsApp (código 401) | Borra sesión y genera QR nuevo ✅ |
| Socket "colgado" (sin evento de cierre) | El vigilante reconecta ✅ |
| Error no controlado | El proceso sigue vivo ✅ |
| Expiración de QR/código (código 408) | Reinicia y ofrece uno nuevo en 2s ✅ |

### Servicios externos — OK ✅
- **Groq (IA):** clave válida, modelos `openai/gpt-oss-120b` y `qwen/qwen3.8-27b`.
- **API de cédula:** credenciales válidas y respondiendo.

---

## 3) Mejoras aplicadas

### v2 (estabilidad)
| # | Mejora | Por qué importa |
|---|---|---|
| 1 | **Resolución del JID `@lid`** | WhatsApp nuevo identifica a los contactos con un identificador de privacidad (`@lid`). Antes el bot podía **no reconocer al cliente** y fallar al responder. Ahora toma el número real de `senderPn`. |
| 2 | **Caché de reintentos de descifrado** (`msgRetryCounterCache`) | Evita **perder mensajes** que no se descifran al primer intento. |
| 3 | **Caché de claves de señal** (`makeCacheableSignalKeyStore`) | Más estabilidad y menos cortes silenciosos. |

### v3 (vinculación a prueba de fallos)
| # | Mejora | Por qué importa |
|---|---|---|
| 4 | **Vinculación por CÓDIGO de número** (`/pair`) | Método más confiable que el QR; no depende de la cámara ni de escanear a tiempo. |
| 5 | **QR siempre fresco** (`/qr` recarga cada 5s + sin caché) | Antes la página podía mostrar un QR **ya expirado** → *"No se pudo vincular el dispositivo"*. Ahora nunca. |
| 6 | **Limpieza de QR/código al cerrar** | La página jamás muestra un código viejo. |
| 7 | **Reconexión rápida tras expiración (408)** | El 408 **no es un error**: reinicia el contador y ofrece un QR/código nuevo en 2s (sin esperas de 1-5 min). |
| 8 | **Navegador estándar** (`Browsers.ubuntu("Chrome")`) | Máxima compatibilidad con WhatsApp para vincular. |
| 9 | **`/selftest`** | Verifica en un clic que el bot puede enviar mensajes. |

---

## 4) Cómo probar que el bot responde

1. **Desde tu teléfono:** envía un mensaje (ej.: *"hola"*) al **+57 322 666 2517**.
   Debe responder el menú.
2. **Prueba de envío:** abre `https://TU-SERVICIO/selftest`. Debe responder
   `{"ok":true,...}` y llegarte un mensaje de prueba.

---

## 5) Cómo dejar el bot 24/7 sin que se detenga

El bot **ya se auto-recupera** de caídas de red, logouts, expiraciones y errores.
Lo único que puede tumbarlo es que **el servidor donde corre se apague**. Opciones:

### 🥇 Opción recomendada: VPS con `pm2` (disco persistente, 24/7 real)
```bash
sudo apt update && sudo apt install -y nodejs npm
cd /ruta/del/bot
npm install
npm install -g pm2
pm2 start server.js --name bot-whatsapp-2
pm2 save
pm2 startup        # ejecuta el comando que te muestre
```
Luego abre `http://TU-IP:10000/pair` (o `/qr`) **una sola vez** y vincula.
Con `pm2` el bot se reinicia solo si el proceso muere o si el servidor se reinicia.

### 🥈 Opción Render (gratis) — con 2 ajustes obligatorios
1. **Activa el respaldo en Supabase** (para no re-vincular en cada redeploy):
```sql
create table if not exists baileys_auth (
  id text primary key,
  value text,
  updated_at timestamptz default now()
);
```
Configura `SUPABASE_URL` y `SUPABASE_KEY` en las variables de entorno.
2. **Pon un pinger externo** (UptimeRobot, cron-job.org) apuntando a
   `https://TU-SERVICIO.onrender.com/health` **cada 5 minutos**, para que el
   plan gratis no se duerma.

> ⚠️ El plan gratis de Render puede reiniciarse; con Supabase + pinger es usable,
> pero un VPS siempre será más confiable para una conexión por QR.

### 🥉 Correr en tu PC (solo para pruebas)
La PC debe quedar **encendida y sin suspensión**. Para exponer el QR:
```bash
cloudflared tunnel --url http://localhost:10000
```
> El túnel rápido de Cloudflare cambia de URL al reiniciar. Una vez vinculado,
> el bot **ya no necesita el túnel** para responder.

---

## 6) Diagnóstico: ¿por qué no responde?

Abre `https://TU-SERVICIO/health` y mira `status`:

| `status` | Significado | Qué hacer |
|---|---|---|
| `conectado` | Todo bien | — |
| `esperando_qr` | Falta vincular | Usar `/pair` (código) o `/qr` |
| `desconectado` | Se cayó y está reconectando | Esperar; se recupera solo |
| `iniciando` | Arrancando | Esperar unos segundos |

Campos útiles: `intentosReconexion`, `ultimaConexion`, `uptimeSegundos`.

---

## 7) Pruebas incluidas (carpeta `tests/`)

```bash
node tests/test_harness.js    # 14 casos de conversación
node tests/test_conn.js       # reconexión, logout y vigilante
node tests/test_lid.js        # resolución de JID @lid
node tests/test_pairing.js    # el código por número no cancela el QR
```

---

## 8) Resumen en una frase

El bot **ya está vinculado y responde**, **no se cae por errores, se reconecta
solo, se recupera de logouts, detecta conexiones colgadas, reconoce a los
contactos nuevos (`@lid`) y ahora se vincula de forma confiable por código de
número o por QR siempre fresco**. Para que quede **24/7 de verdad**, móntalo en
un **VPS con `pm2`** (o en Render gratis con Supabase + pinger externo).
