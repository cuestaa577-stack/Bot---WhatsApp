/**
 * PRUEBA @lid — verifica que el bot resuelve el número real desde senderPn
 * y responde al JID de origen (@lid).
 */
const Module = require("module");
const { EventEmitter } = require("events");
const path = require("path");

const enviados = [];
let mockSock = null;
function makeWASocket() {
  const ev = new EventEmitter();
  mockSock = {
    ev,
    ws: { isOpen: true },
    updateMediaMessage: async () => {},
    sendMessage: async (jid, content) => {
      enviados.push({ jid, text: content && content.text });
      return { key: { id: "m" } };
    },
    logout: async () => {},
  };
  return mockSock;
}
const mockBaileys = {
  default: makeWASocket,
  makeWASocket,
  makeCacheableSignalKeyStore: (k) => k,
  Browsers: { ubuntu: () => ["Ubuntu", "Chrome", "1.0.0"] },
  useMultiFileAuthState: async () => ({ state: { creds: {}, keys: {} }, saveCreds: async () => {} }),
  DisconnectReason: { loggedOut: 401, connectionClosed: 428 },
  downloadMediaMessage: async () => Buffer.from("x"),
  fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 0] }),
};
const origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "@whiskeysockets/baileys") return mockBaileys;
  return origRequire.apply(this, arguments);
};

process.env.PORT = "10057";
process.env.ADMIN_PHONE = "573226662517";
process.env.ADMIN_NOTIFICATIONS_ENABLED = "false";
process.env.AUTH_DIR = path.join(__dirname, "auth_test_lid");
process.env.SELF_URL = "";

require("../server.js");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await esperar(3000);
  mockSock.ev.emit("connection.update", { connection: "open" });
  await esperar(500);
  console.log("\n=========== PRUEBA JID @lid ===========\n");

  // Mensaje de un contacto identificado por @lid, con el número real en senderPn.
  enviados.length = 0;
  mockSock.ev.emit("messages.upsert", {
    type: "notify",
    messages: [
      {
        key: {
          remoteJid: "99887766554433@lid",
          senderPn: "573001119999@s.whatsapp.net",
          fromMe: false,
          id: "lid-1",
        },
        pushName: "Cliente LID",
        message: { conversation: "hola" },
      },
    ],
  });
  for (let i = 0; i < 30 && enviados.length === 0; i++) await esperar(500);
  await esperar(500);

  console.log("Respuestas enviadas:", enviados.length);
  enviados.forEach((e) => console.log("  → destino JID:", e.jid, "| texto:", (e.text || "").split("\n")[0]));
  const ok = enviados.length > 0 && enviados[0].jid === "99887766554433@lid";
  console.log(ok ? "\n✅ Resolvió el número y respondió al JID @lid correcto." : "\n❌ Falló la resolución del JID @lid.");

  // Mensaje del ADMIN identificado por @lid (debe reconocerlo por senderPn).
  enviados.length = 0;
  mockSock.ev.emit("messages.upsert", {
    type: "notify",
    messages: [
      {
        key: {
          remoteJid: "11122233344455@lid",
          senderPn: "573226662517@s.whatsapp.net",
          fromMe: false,
          id: "lid-admin",
        },
        pushName: "Admin",
        message: { conversation: "estado" },
      },
    ],
  });
  for (let i = 0; i < 30 && enviados.length === 0; i++) await esperar(500);
  await esperar(500);
  const adminOk = enviados.some((e) => /BOT ACTIVO|Administrador/i.test(e.text || ""));
  console.log("\nAdmin por @lid →", enviados.map((e) => (e.text || "").split("\n")[0]));
  console.log(adminOk ? "✅ Reconoció al administrador por senderPn." : "❌ No reconoció al administrador.");

  console.log("\n=========== FIN PRUEBA @lid ===========\n");
  process.exit(0);
})();
