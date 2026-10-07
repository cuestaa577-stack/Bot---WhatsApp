# 🐙 ¿Se puede subir el bot a GitHub? — Lo que SÍ y lo que NO

## ⚠️ Lo primero (muy importante)

**GitHub NO ejecuta el bot.** GitHub es un **repositorio** (guarda el código),
**no un servidor**. Subir los archivos a GitHub **no hace que el bot funcione solo**.

| Servicio de GitHub | ¿Sirve para el bot 24/7? | Por qué |
|---|---|---|
| **Repositorio** (guardar código) | ❌ No ejecuta | Solo almacena archivos |
| **GitHub Pages** | ❌ No | Solo sirve webs **estáticas** (HTML/CSS), no Node.js |
| **GitHub Actions** | ❌ No (para 24/7) | Ejecuta tareas programadas; los jobs se **cortan a las 6 h** y no mantienen conexión |
| **GitHub Codespaces** | ❌ No (para 24/7) | Se **apaga por inactividad**; no es un servidor permanente |

👉 Para que el bot **esté encendido 24/7**, necesita un lugar que **ejecute Node.js
de forma permanente**: un **VPS** (con `pm2`) o **Render/Railway**.

---

## ✅ Entonces, ¿para qué SÍ sirve GitHub?

GitHub es **excelente** como complemento. Sirve para:

1. **Respaldo del código** — si algo pasa, tu bot está guardado.
2. **Auto-deploy** — conectas GitHub a Render/Railway y **cada `git push`
   redeploya solo**. Muy cómodo para actualizar.
3. **Trabajar desde varios dispositivos** o con más personas.

### Las 2 combinaciones que SÍ funcionan

| Combinación | Cómo funciona |
|---|---|
| **GitHub + Render** | Subes el código a GitHub → Render lo ejecuta → cada push se actualiza solo. |
| **GitHub + VPS** | Subes el código a GitHub → en el VPS haces `git pull` y `pm2 restart`. |

> En ambos casos, **quien ejecuta el bot es Render o el VPS**, no GitHub.

---

## 🔒 SEGURIDAD (crítico antes de subir nada)

Tu proyecto **ya está protegido**: el archivo `.gitignore` **excluye** lo peligroso.
Lo verifiqué con una prueba real y **NO se suben**:

| Archivo | Qué es | ¿Se sube? |
|---|---|---|
| `.env` | Tus claves secretas (Groq, cédula) | ❌ **NO** (protegido) |
| `auth_baileys/` | La **sesión de tu WhatsApp** | ❌ **NO** (protegido) |
| `clientes.json` | Datos de tus clientes | ❌ **NO** (protegido) |
| `sesiones.json` | Conversaciones | ❌ **NO** (protegido) |
| `node_modules/` | Dependencias (pesadas) | ❌ **NO** (protegido) |
| `server.js`, guías, etc. | El código del bot | ✅ Sí (seguro) |

> ⚠️ **NUNCA** subas `auth_baileys/` ni `.env` a GitHub. Si alguien los obtiene,
> puede **entrar a tu WhatsApp** y usar tus claves. El `.gitignore` ya lo evita.

> 💡 **Recomendación:** crea el repositorio como **PRIVADO** para que nadie vea tu
> código. Si lo haces público, los secretos siguen protegidos, pero cualquiera
> vería tu lógica del bot.

---

## 🚀 Cómo subir el bot a GitHub (paso a paso)

### 1. Crea la cuenta y el repositorio
1. Entra a **https://github.com** y crea una cuenta (si no tienes).
2. Arriba a la derecha: **+** → **New repository**.
3. Nombre: `bot-whatsapp` (o el que quieras).
4. Marca **Private** (recomendado).
5. **NO** marques "Add a README" (ya tienes uno).
6. **Create repository**.

### 2. Sube el código desde tu computadora
Abre la terminal **dentro de la carpeta del bot** (donde está `server.js`) y ejecuta:

```bash
git init
git add .
git commit -m "Bot de WhatsApp - versión corregida"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/bot-whatsapp.git
git push -u origin main
```

> Cuando pida usuario/contraseña: la contraseña **ya no es tu clave de GitHub**,
> sino un **token**. Créalo en GitHub → **Settings** → **Developer settings** →
> **Personal access tokens** → **Tokens (classic)** → **Generate new token** →
> marca **repo** → cópialo y úsalo como contraseña.

### 3. Verifica
Recarga la página de tu repositorio en GitHub. Debes ver `server.js`, las guías,
etc. **Y NO** debes ver `.env` ni `auth_baileys/`. ✅

---

## 🔄 Opción A — GitHub + Render (auto-deploy)

1. En **Render** → **New** → **Web Service**.
2. Conecta tu cuenta de GitHub y elige el repositorio `bot-whatsapp`.
3. Configura:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/health`
4. En **Environment**, añade tus variables (las que están en tu `.env`):
   `BOT_NAME`, `PAIRING_PHONE`, `ADMIN_PHONE`, `GROQ_API_KEY`, `CEDULA_APP_ID`,
   `CEDULA_TOKEN`, y (recomendado) `SUPABASE_URL` + `SUPABASE_KEY`.
5. **Deploy**. Luego vincula en `/pair` o `/qr`.

> A partir de aquí, **cada vez que hagas `git push`, Render actualiza el bot solo**.
> ⚠️ Recuerda el problema de Render gratis (se duerme y pierde la sesión):
> revisa **RENDER-PASO-A-PASO.md** (Supabase + pinger).

---

## 🔄 Opción B — GitHub + VPS (la más confiable)

### En el VPS, la primera vez:
```bash
apt update && apt install -y git
git clone https://github.com/TU_USUARIO/bot-whatsapp.git
cd bot-whatsapp
cp .env.example .env && nano .env   # rellena tus claves
npm install
npm install -g pm2
pm2 start server.js --name bot-whatsapp-2
pm2 save && pm2 startup
```

### Para actualizar en el futuro (cuando cambies el código en GitHub):
```bash
cd bot-whatsapp
git pull
npm install
pm2 restart bot-whatsapp-2
```

> La sesión de WhatsApp **se conserva**: no hay que volver a vincular.
> Ver **GUIA-VPS-PM2.md** para la guía completa.

---

## 📋 Resumen

| Pregunta | Respuesta |
|---|---|
| ¿Subir el bot a GitHub lo hace funcionar? | **No.** GitHub guarda, no ejecuta. |
| ¿Sirve GitHub para algo entonces? | **Sí:** respaldo + auto-deploy con Render o VPS. |
| ¿Es peligroso subirlo? | **No**, si respetas el `.gitignore` (ya está listo). |
| ¿Qué NO debo subir nunca? | `.env` y `auth_baileys/` (ya están bloqueados). |
| ¿Qué necesito además de GitHub? | Un **VPS** (pm2) o **Render** para ejecutarlo. |

---

## En una frase

**Subir el bot a GitHub es una buena idea como respaldo y para auto-deploy, pero
GitHub por sí solo NO lo ejecuta.** Para que funcione 24/7 necesitas un **VPS con
`pm2`** (lo más confiable) o **Render** — y GitHub se encarga de mantener el código
actualizado. Tus secretos (`.env` y `auth_baileys/`) **ya están protegidos** y no
se suben.
