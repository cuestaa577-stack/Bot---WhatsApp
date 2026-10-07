# 🥇 Guía VPS + pm2 — Bot de WhatsApp 24/7 (que NUNCA se detiene)

Esta es la forma **más confiable** de tener el bot encendido siempre: un servidor
propio (VPS) con `pm2`, que **reinicia el bot solo** si se cae o si el servidor
se reinicia. **No se duerme** (a diferencia de Render gratis) y **la sesión se
conserva** (no hay que volver a vincular).

> ⏱️ Tiempo total: ~20 minutos. Nivel: principiante (copiar y pegar).

---

## 📋 Qué necesitas

- Un **VPS** (servidor) con Ubuntu 22.04 o 24.04, **1 GB de RAM** o más.
- El **ZIP del bot** (`bot-whatsapp-corregido-v3.zip`) que ya te entregué.
- (Opcional pero recomendado) Un **dominio** para acceder con HTTPS.

### Proveedores recomendados (de más barato a más cómodo)

| Proveedor | Precio aprox. | Nota |
|---|---|---|
| **Oracle Cloud Free Tier** | **Gratis** | Muy generoso, pero el registro puede ser difícil. |
| **Hetzner** | ~€4/mes | **Mejor relación precio/calidad.** |
| **Contabo** | ~€4/mes | Mucha RAM barata. |
| **DigitalOcean / Vultr / Linode** | ~$6/mes | Sencillos y confiables. |
| **AWS Lightsail** | ~$5/mes | Fácil si ya usas AWS. |

> Elige **Ubuntu 22.04 o 24.04 LTS** al crear el servidor. Guarda la **IP pública**
> y la **contraseña** (o la clave SSH) que te den.

---

## 🚀 Camino rápido (script automático)

Una vez tengas el VPS, conectado por SSH, el script hace casi todo:

```bash
# 1. Sube el bot al servidor (desde TU computadora, no desde el VPS)
scp bot-whatsapp-corregido-v3.zip root@TU_IP:/root/

# 2. Conéctate al servidor
ssh root@TU_IP

# 3. Descomprime y entra
apt update && apt install -y unzip git
unzip bot-whatsapp-corregido-v3.zip
cd bot-whatsapp

# 4. Ejecuta el instalador automático
bash deploy-vps.sh
```

Al terminar, abre `http://TU_IP:10000/pair` y vincula. **Listo.**

> Si prefieres hacerlo **paso a paso a mano** (para entenderlo), sigue las
> secciones de abajo. Hacen lo mismo que el script.

---

## 🧩 Paso a paso manual

### Paso 1 — Conéctate al servidor
```bash
ssh root@TU_IP
```
(En Windows usa **PowerShell** o **PuTTY**; en Mac/Linux, la Terminal.)

### Paso 2 — Actualiza e instala Node.js 20 + git
```bash
apt update && apt upgrade -y
apt install -y curl git
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v   # debe mostrar v20.x o superior
```

### Paso 3 — Sube el bot
Desde **tu computadora**:
```bash
scp bot-whatsapp-corregido-v3.zip root@TU_IP:/root/
```
Luego, **en el servidor**:
```bash
cd /root
unzip bot-whatsapp-corregido-v3.zip
cd bot-whatsapp
```

### Paso 4 — Crea el archivo `.env`
Copia el ejemplo y edítalo con tus datos:
```bash
cp .env.example .env
nano .env
```
Rellena (mínimo lo marcado):
```ini
PORT=10000
BOT_NAME=Gestion - Venezuela
PAIRING_PHONE=573226662517
ADMIN_PHONE=573226662517
GROQ_API_KEY=tu_clave_de_groq
CEDULA_APP_ID=9496
CEDULA_TOKEN=13a4fd65ee46de0ec286ec47aac3ce9e
```
> Guarda con `Ctrl+O`, `Enter`, y sal con `Ctrl+X`.

### Paso 5 — Instala las dependencias
```bash
npm install
```
> Si aparece un error de dependencias de Git: `npm install --allow-git=all`

### Paso 6 — Instala pm2 y arranca el bot (24/7)
```bash
npm install -g pm2
pm2 start server.js --name bot-whatsapp-2
pm2 save
pm2 startup
```
El comando `pm2 startup` **imprime una línea** que empieza con `sudo env ...`.
**Cópiala y ejecútala** (es para que el bot arranque solo cuando el servidor
se reinicie). Luego:
```bash
pm2 save
```

✅ **Ya está corriendo 24/7.** Verifica con:
```bash
pm2 status
pm2 logs bot-whatsapp-2
```

### Paso 7 — Vincula WhatsApp
Abre en el navegador: **`http://TU_IP:10000/pair`**
(o `http://TU_IP:10000/qr`). Sigue las instrucciones para vincular.

> ⚠️ Si no carga, revisa el **firewall** (Paso 8).

### Paso 8 — Abre el puerto en el firewall
Si usas `ufw`:
```bash
ufw allow OpenSSH
ufw allow 10000
ufw enable
```
> En el panel del proveedor (Hetzner/DigitalOcean/etc.) también puede haber un
> **firewall externo**: abre ahí el puerto **10000** (o usa Nginx, Paso 9).

---

## 🔒 Paso 9 (RECOMENDADO) — Nginx + dominio + HTTPS

Para no exponer el puerto 10000 y tener una URL bonita con candado (HTTPS):

```bash
apt install -y nginx
```

Crea el sitio:
```bash
nano /etc/nginx/sites-available/bot
```
Pega (cambia `tudominio.com`):
```nginx
server {
    listen 80;
    server_name tudominio.com;

    location / {
        proxy_pass http://localhost:10000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```
Actívalo y recarga:
```bash
ln -s /etc/nginx/sites-available/bot /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

Instala el certificado SSL gratis (Let's Encrypt):
```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d tudominio.com
```

Ahora vincula en: **`https://tudominio.com/pair`** 🎉

> Apunta el dominio a la IP del VPS en tu proveedor de DNS (registro **A**).

---

## 🔄 Cómo actualizar el bot (cuando cambies el código)

```bash
cd /root/bot-whatsapp
# (sube el nuevo código o haz git pull)
npm install
pm2 restart bot-whatsapp-2
```
La sesión **se conserva**: no hay que volver a vincular.

---

## 🧰 Comandos útiles de pm2

| Comando | Qué hace |
|---|---|
| `pm2 status` | Ver si el bot está corriendo |
| `pm2 logs bot-whatsapp-2` | Ver los mensajes en vivo |
| `pm2 restart bot-whatsapp-2` | Reiniciar el bot |
| `pm2 stop bot-whatsapp-2` | Detenerlo |
| `pm2 delete bot-whatsapp-2` | Quitarlo de pm2 |
| `pm2 monit` | Panel de recursos en vivo |

---

## 🩺 Diagnóstico: ¿por qué no responde?

```bash
curl http://localhost:10000/health
```
Mira `status`:

| `status` | Significado | Qué hacer |
|---|---|---|
| `conectado` | Todo bien | — |
| `esperando_qr` | Falta vincular | Abre `/pair` o `/qr` |
| `desconectado` | Se cayó y reconecta solo | Espera; se recupera |
| `iniciando` | Arrancando | Espera unos segundos |

Otros chequeos:
```bash
pm2 logs bot-whatsapp-2 --lines 50   # ver errores
curl http://localhost:10000/selftest # probar envío de mensajes
```

---

## ⛔ MUY IMPORTANTE

- **Apaga cualquier otra copia del bot** (Render, tu PC, este entorno) antes de
  arrancar el del VPS. WhatsApp solo permite **una conexión activa** por sesión;
  si hay dos, una se desconecta (error 440) y el bot deja de responder.
- **Guarda el `.env`** en un lugar seguro: tiene tus claves.
- **No compartas** la carpeta `auth_baileys/`: permite entrar a tu WhatsApp.

---

## ✅ Checklist final

- [ ] VPS creado con Ubuntu 22.04/24.04.
- [ ] Node.js 20+ instalado (`node -v`).
- [ ] Bot subido y `.env` configurado.
- [ ] `npm install` sin errores.
- [ ] `pm2 start` + `pm2 save` + `pm2 startup` hechos.
- [ ] Firewall abierto (puerto 10000) o Nginx configurado.
- [ ] WhatsApp vinculado en `/pair` o `/qr`.
- [ ] `curl localhost:10000/health` → `"status":"conectado"`.
- [ ] Probado enviando *"hola"* al número del bot.

---

## Resumen en una frase

Con un **VPS + `pm2`**, el bot queda **encendido 24/7**, **se reinicia solo** si
algo falla, **no se duerme** y **conserva la vinculación** de WhatsApp. Es la
opción más confiable para que el bot **nunca deje de responder**.
