# 📤 Cómo descomprimir y subir el bot a GitHub (paso a paso, fácil)

Guía para principiantes. No necesitas saber programar para subirlo por la web.

---

## PARTE 1 — Descomprimir el ZIP

El archivo se llama **`bot-whatsapp-corregido-v5.zip`**.

### 💻 En Windows
1. Busca el archivo `.zip` (probablemente en **Descargas**).
2. **Clic derecho** sobre él.
3. Elige **"Extraer todo…"**.
4. Aparece una ventana → pulsa **"Extraer"**.
5. Se crea una **carpeta** `bot-whatsapp-corregido-v5` con todo dentro. ✅

### 🍎 En Mac
1. Busca el archivo `.zip`.
2. **Doble clic** sobre él.
3. Se crea automáticamente una **carpeta** al lado. ✅

### 📱 En Android (celular)
1. Abre la app **"Archivos"** (o **"Mis archivos"**).
2. Busca el `.zip` (suele estar en **Descargas**).
3. **Tócalo** → elige **"Extraer"**.
   - Si no aparece la opción, instala **ZArchiver** (gratis) y ábrelo con esa app.
4. Se crea una **carpeta** con el contenido. ✅

> Dentro de la carpeta verás otra carpeta llamada **`bot-whatsapp`**. Dentro de
> ESA están los archivos del bot (`server.js`, `package.json`, etc.).

---

## PARTE 2 — Subir a GitHub por la web (la forma más fácil)

> No necesitas instalar nada ni usar comandos. Todo desde el navegador.

### Paso 1 — Crea tu cuenta (si no tienes)
1. Entra a **https://github.com**
2. Pulsa **Sign up** y crea tu cuenta (correo, usuario y contraseña).

### Paso 2 — Crea el repositorio
1. Arriba a la derecha, pulsa el **+** → **New repository**.
2. **Repository name:** escribe `bot-whatsapp`.
3. Marca **Private** (privado) ✅ (recomendado).
4. **NO** marques ninguna casilla de "Add a README".
5. Pulsa el botón verde **Create repository**.

### Paso 3 — Sube los archivos
1. En la página que aparece, busca el enlace azul
   **"uploading an existing file"** y púlsalo.
   *(Si no lo ves: pulsa "Add file" → "Upload files".)*
2. Abre la carpeta **`bot-whatsapp`** que descomprimiste.
3. **Selecciona TODOS los archivos de adentro** (Ctrl+A en Windows, Cmd+A en Mac)
   y **arrástralos** a la zona que dice *"Drag files here"*.
   - ⚠️ Arrastra **el contenido de dentro de `bot-whatsapp`**, no la carpeta entera.
   - Si no puedes arrastrar, pulsa **"choose your files"** y selecciónalos.
4. Espera a que suban (verás la lista).
5. Abajo, pulsa el botón verde **Commit changes**.

✅ **¡Listo!** Recarga la página y verás tu código en GitHub.

> **Tranquilo con la seguridad:** el ZIP **NO** incluye tus claves (`.env`) ni la
> sesión de WhatsApp (`auth_baileys/`). Esos archivos **no están** en el ZIP, así
> que no se pueden subir por accidente.

---

## PARTE 3 — (Opcional) Subirlo con comandos

Si prefieres la terminal, dentro de la carpeta `bot-whatsapp`:

```bash
git init
git add .
git commit -m "Bot de WhatsApp corregido"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/bot-whatsapp.git
git push -u origin main
```

> Cuando pida contraseña, usa un **token** (no tu clave normal):
> GitHub → **Settings** → **Developer settings** → **Personal access tokens** →
> **Tokens (classic)** → **Generate new token** → marca **repo** → cópialo.

---

## ❓ Preguntas frecuentes

**¿Subir esto a GitHub hace que el bot funcione?**
No. GitHub **solo guarda** el código. Para que el bot esté encendido 24/7
necesitas **Render** o un **VPS** (ver las otras guías).

**¿Es peligroso subirlo?**
No. El ZIP no trae tus claves ni la sesión de WhatsApp. Aun así, usa un repo
**privado**.

**¿Puedo subir desde el celular?**
Sí, con el navegador del celular y los mismos pasos de la Parte 2. Es un poco más
incómodo, pero funciona.

**Me equivoqué y subí algo mal, ¿qué hago?**
En GitHub puedes borrar archivos y volver a subirlos. No pasa nada.

---

## En una frase

**Descomprime el ZIP, entra a github.com, crea un repositorio privado y arrastra
los archivos de dentro de la carpeta `bot-whatsapp`.** Eso es todo.
