#!/usr/bin/env bash
# ============================================================
#  deploy-vps.sh — Instalador automático del bot de WhatsApp
#  para un VPS con Ubuntu (22.04 / 24.04).
#
#  Qué hace:
#   1. Instala Node.js 20 y git (si faltan).
#   2. Instala pm2.
#   3. Instala las dependencias del bot.
#   4. Arranca el bot con pm2 (reinicio automático 24/7).
#   5. Configura el arranque automático al reiniciar el servidor.
#   6. Abre el puerto en el firewall (ufw), si está disponible.
#
#  Uso:
#     cd bot-whatsapp
#     bash deploy-vps.sh
# ============================================================

set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
log(){  echo -e "${GREEN}==>${NC} $1"; }
warn(){ echo -e "${YELLOW}!! ${NC} $1"; }
err(){  echo -e "${RED}xx ${NC} $1"; }
info(){ echo -e "${CYAN}   ${NC} $1"; }

APP_NAME="bot-whatsapp-2"
PORT="${PORT:-10000}"

echo -e "${CYAN}"
echo "============================================"
echo "  Instalador del bot de WhatsApp (VPS+pm2)"
echo "============================================"
echo -e "${NC}"

# --- Comprobaciones básicas ---
if [ ! -f "server.js" ]; then
  err "No encuentro server.js. Ejecuta este script DENTRO de la carpeta del bot."
  exit 1
fi

if [ "$(id -u)" -ne 0 ] && ! command -v sudo >/dev/null 2>&1; then
  err "Necesitas permisos de root o sudo."
  exit 1
fi
SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

# --- 1) Node.js 20+ ---
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  MAJOR="$(node -v | sed 's/v//' | cut -d. -f1)"
  [ "$MAJOR" -ge 20 ] 2>/dev/null && NEED_NODE=0
fi
if [ "$NEED_NODE" -eq 1 ]; then
  log "Instalando Node.js 20..."
  $SUDO apt-get update -y
  $SUDO apt-get install -y curl git ca-certificates
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
else
  log "Node.js ya instalado: $(node -v)"
fi
# git es necesario para algunas dependencias del bot.
command -v git >/dev/null 2>&1 || { log "Instalando git..."; $SUDO apt-get install -y git; }

# --- 2) pm2 ---
if ! command -v pm2 >/dev/null 2>&1; then
  log "Instalando pm2..."
  $SUDO npm install -g pm2
else
  log "pm2 ya instalado: $(pm2 -v)"
fi

# --- 3) Dependencias del bot ---
log "Instalando dependencias del bot (puede tardar un poco)..."
npm install || {
  warn "Reintentando con --allow-git=all (dependencias de Git)..."
  npm install --allow-git=all
}

# --- 4) Archivo .env ---
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
    warn "Creado .env desde .env.example. ÁBRELO y rellena tus claves:"
    info "nano .env   (mínimo: PAIRING_PHONE, ADMIN_PHONE, GROQ_API_KEY)"
  else
    warn "No hay .env ni .env.example. Crea un .env con tus variables."
  fi
else
  log "Archivo .env encontrado."
fi

# --- 5) Arrancar con pm2 ---
log "Arrancando el bot con pm2..."
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
pm2 start server.js --name "$APP_NAME"
pm2 save

# --- 6) Arranque automático al reiniciar ---
log "Configurando arranque automático al reiniciar el servidor..."
STARTUP_CMD="$(pm2 startup systemd -u "$(whoami)" --hp "$HOME" 2>/dev/null | grep -E '^sudo' | tail -1 || true)"
if [ -n "$STARTUP_CMD" ]; then
  info "Ejecutando: $STARTUP_CMD"
  eval "$STARTUP_CMD" || warn "Ejecuta manualmente: $STARTUP_CMD"
  pm2 save
else
  warn "Si 'pm2 startup' mostró un comando 'sudo env ...', cópialo y ejecútalo."
fi

# --- 7) Firewall (ufw), si está disponible ---
if command -v ufw >/dev/null 2>&1; then
  log "Abriendo puerto $PORT en el firewall (ufw)..."
  $SUDO ufw allow OpenSSH >/dev/null 2>&1 || true
  $SUDO ufw allow "$PORT"/tcp >/dev/null 2>&1 || true
  info "Puerto $PORT abierto (si ufw estaba activo)."
else
  warn "ufw no está instalado. Si usas firewall del proveedor, abre el puerto $PORT."
fi

# --- Resumen ---
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  ✅ ¡Bot instalado y corriendo 24/7!${NC}"
echo -e "${GREEN}============================================${NC}"
echo
pm2 status || true
echo
echo -e "${CYAN}👉 Vincula WhatsApp aquí:${NC}"
echo -e "   http://${IP:-TU_IP}:${PORT}/pair   (código por número)"
echo -e "   http://${IP:-TU_IP}:${PORT}/qr     (código QR)"
echo
echo -e "${CYAN}Comandos útiles:${NC}"
echo "   pm2 logs $APP_NAME      # ver mensajes en vivo"
echo "   pm2 restart $APP_NAME   # reiniciar"
echo "   pm2 status              # estado"
echo
echo -e "${YELLOW}⚠️  Recuerda: apaga cualquier otra copia del bot (Render, PC, etc.)${NC}"
echo -e "${YELLOW}    para evitar el error 440 (una sola conexión por sesión).${NC}"
echo
