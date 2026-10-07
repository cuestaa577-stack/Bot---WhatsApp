# 🚀 ¿El bot funciona en Render si Render se actualiza/redeploya?

## Respuesta corta

**Depende de una cosa: ¿configuraste Supabase?**

| Escenario | ¿Sobrevive a un redeploy de Render? |
|---|---|
| **Sin Supabase** (como está ahora) | ❌ **NO.** Cada redeploy/reinicio borra la sesión → hay que **volver a vincular** (nuevo QR/código). |
| **Con Supabase configurado** | ✅ **SÍ.** El bot guarda la sesión en Supabase y la restaura solo. No hay que re-vincular. |
| **Render + disco persistente** (plan de pago) | ✅ **SÍ.** La carpeta `auth_baileys/` se conserva entre redeploys. |

> **Por qué:** El plan **gratis** de Render usa un **disco temporal (efímero)**. En cada
> redeploy o reinicio, el disco se borra y con él la carpeta `auth_baileys/`, que es
> donde vive la vinculación de WhatsApp. Sin esa carpeta, WhatsApp pide vincular de nuevo.

---

## ✅ Cómo hacer que SÍ sobreviva (Supabase) — paso a paso

El bot **ya trae el código listo** para esto (respalda y restaura la sesión solo).
Solo hay que activarlo.

### 1. Crea la tabla en Supabase
En tu proyecto de Supabase → **SQL Editor** → pega y ejecuta:

```sql
create table if not exists baileys_auth (
  id text primary key,
  value text,
  updated_at timestamptz default now()
);
```

### 2. Copia tus credenciales de Supabase
En Supabase → **Settings** → **API**:
- **Project URL** → es tu `SUPABASE_URL`
- **anon public key** (o service_role) → es tu `SUPABASE_KEY`

### 3. Ponlas en Render
En Render → tu servicio → **Environment** → añade:

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | `https://xxxxx.supabase.co` |
| `SUPABASE_KEY` | tu clave de Supabase |
| `PAIRING_PHONE` | `573226662517` |
| `ADMIN_PHONE` | `573226662517` |
| `GROQ_API_KEY` | tu clave de Groq |
| `CEDULA_APP_ID` | `9496` |
| `CEDULA_TOKEN` | `13a4fd65ee46de0ec286ec47aac3ce9e` |

### 4. Vincula una sola vez
Abre `https://TU-SERVICIO.onrender.com/pair` (o `/qr`) y vincula.
Desde ese momento, **cada redeploy restaura la sesión desde Supabase automáticamente**.

> El bot respalda la sesión **en cada cambio de credenciales** y **cada 5 minutos**,
> así que la copia en Supabase siempre está al día.

---

## ⚠️ El otro problema del plan gratis: Render "se duerme"

El plan **gratis** de Render **suspende el servicio a los 15 minutos sin tráfico**.
Mientras está dormido, **el bot NO responde** (aunque la sesión siga guardada).

**Solución:** un "pinger" externo que lo despierte cada 5 minutos:
- **UptimeRobot** (gratis) o **cron-job.org**
- Apunta a: `https://TU-SERVICIO.onrender.com/health`
- Intervalo: **cada 5 minutos**

Con esto, el servicio casi nunca se duerme.

---

## ⛔ Muy importante: NO corras el bot en dos lugares a la vez

WhatsApp permite **una sola conexión activa** por sesión. Si dejas el bot corriendo
en dos sitios con la misma sesión, WhatsApp **desconecta uno** (error 440,
"connection replaced") y el bot deja de responder.

👉 Cuando lo pases a Render, **apaga** el bot de este entorno temporal (o viceversa).

---

## 🥇 Recomendación final (lo más confiable)

| Opción | Costo | ¿Sobrevive redeploy? | ¿Se duerme? | Nota |
|---|---|---|---|---|
| **VPS + `pm2`** | ~$5/mes | ✅ Sí (disco real) | ❌ No | **La mejor** para 24/7 |
| Render + Supabase + pinger | Gratis | ✅ Sí | ⚠️ Casi nunca | Bueno y gratis |
| Render + disco persistente | De pago | ✅ Sí | ❌ No (plan de pago) | Sencillo |
| Render gratis **sin** Supabase | Gratis | ❌ No | ⚠️ Sí | Hay que re-vincular siempre |

---

## Resumen en una frase

**Si dejas Render como está (sin Supabase), cada vez que Render actualice tendrás
que volver a vincular el bot. Si configuras Supabase (2 minutos de trabajo), el bot
sobrevive a los redeploys solo.** Y para que el plan gratis no se duerma, añade un
pinger externo cada 5 minutos. Para 24/7 de verdad, un **VPS con `pm2`**.
