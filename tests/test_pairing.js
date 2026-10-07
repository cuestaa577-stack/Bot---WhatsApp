// Test aislado: ¿pedir el código de vinculación por número cancela el flujo de QR?
// Crea un socket Baileys real, cuenta los QR recibidos, pide el código de
// vinculación tras el primer QR y observa si siguen llegando QR y si el código
// se genera correctamente. No toca la sesión real del bot (usa otra carpeta).
const path = require("path");
const fs = require("fs");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const pino = require("pino");

const PHONE = process.env.PAIRING_PHONE || "573226662517";
const AUTH_DIR = path.join(__dirname, "auth_pairing_test");

(async () => {
  // Limpia cualquier sesión previa del test.
  try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch (_) {}

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const signalKeyStore =
    typeof makeCacheableSignalKeyStore === "function"
      ? makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }))
      : state.keys;

  let version = null;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch (_) {}

  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: { creds: state.creds, keys: signalKeyStore },
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["Test Pairing", "Chrome", "1.0.0"],
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  sock.ev.on("creds.update", saveCreds);

  let qrCount = 0;
  let codeRequested = false;
  let pairingCode = null;
  const qrAfterCode = [];

  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      qrCount++;
      console.log(`[QR #${qrCount}] recibido a los ${Math.round(process.uptime())}s`);
      if (qrCount >= 1 && !codeRequested) {
        codeRequested = true;
        try {
          pairingCode = await sock.requestPairingCode(PHONE);
          console.log(`[PAIRING] Código solicitado: ${pairingCode}`);
        } catch (e) {
          console.log(`[PAIRING] ERROR al pedir código: ${e.message}`);
        }
      } else if (codeRequested) {
        qrAfterCode.push(qrCount);
      }
    }
    if (connection === "open") {
      console.log("[OPEN] conectado");
      finish(0);
    }
    if (connection === "close") {
      const sc = lastDisconnect?.error?.output?.statusCode;
      console.log(`[CLOSE] código ${sc}`);
      if (sc === DisconnectReason.loggedOut) finish(0);
    }
  });

  function finish(exit) {
    console.log("\n===== RESUMEN =====");
    console.log("QR recibidos en total:", qrCount);
    console.log("Código de vinculación:", pairingCode || "(no generado)");
    console.log("QR recibidos DESPUÉS de pedir el código:", qrAfterCode.length);
    console.log("=> El QR sigue vivo tras pedir el código:", qrAfterCode.length > 0);
    console.log("=> El código se generó correctamente:", !!pairingCode);
    try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch (_) {}
    process.exit(exit);
  }

  // Corta a los 70s para no colgarse.
  setTimeout(() => finish(0), 70000);
})().catch((e) => {
  console.error("Fallo del test:", e);
  process.exit(1);
});
