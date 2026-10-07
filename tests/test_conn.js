/**
 * PRUEBAS DE CONEXIÓN — simula caídas de Baileys y verifica la auto-recuperación.
 *   node test_conn.js
 */
const Module = require("module");
const { EventEmitter } = require("events");
const path = require("path");

const sockets = [];
function makeWASocket() {
  const ev = new EventEmitter();
  const sock = {
    ev,
    ws: { isOpen: true },
    updateMediaMessage: async () => {},
    sendMessage: async () => ({ key: { id: "x" } }),
    logout: async () => {},
  };
  sockets.push(sock);
  return sock;
}

const mockBaileys = {
  default: makeWASocket,
  makeWASocket,
  makeCacheableSignalKeyStore: (keys) => keys,
  Browsers: { ubuntu: () => ["Ubuntu", "Chrome", "1.0.0"] },
  useMultiFileAuthState: async () => ({ state: {}, saveCreds: async () => {} }),
  DisconnectReason: { loggedOut: 401, connectionClosed: 428, restartRequired: 515 },
  downloadMediaMessage: async () => Buffer.from("x"),
  fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 0] }),
};

const origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "@whiskeysockets/baileys") return mockBaileys;
  return origRequire.apply(this, arguments);
};

process.env.PORT = "10056";
process.env.ADMIN_PHONE = "573226662517";
process.env.AUTH_DIR = path.join(__dirname, "auth_test_conn");
process.env.SELF_URL = "";

require("../server.js");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await esperar(3000);
  console.log("\n=========== PRUEBAS DE CONEXIÓN ===========\n");
  console.log("Sockets creados al inicio:", sockets.length);

  const s1 = sockets[sockets.length - 1];

  // --- PRUEBA 1: cierre de conexión (código 428) -> debe reconectar ---
  console.log("\n[1] Simulando cierre de conexión (código 428)...");
  s1.ev.emit("connection.update", {
    connection: "close",
    lastDisconnect: { error: { output: { statusCode: 428 }, message: "Connection Closed" } },
  });
  await esperar(6500); // backoff de 5s
  console.log("   Sockets ahora:", sockets.length, sockets.length > 1 ? "✅ RECONECTÓ" : "❌ NO RECONECTÓ");

  // --- PRUEBA 2: logout (código 401) -> debe borrar sesión y generar QR nuevo ---
  const s2 = sockets[sockets.length - 1];
  console.log("\n[2] Simulando logout (código 401)...");
  s2.ev.emit("connection.update", {
    connection: "close",
    lastDisconnect: { error: { output: { statusCode: 401 }, message: "Logged Out" } },
  });
  await esperar(4500); // reinicio tras 3s
  console.log("   Sockets ahora:", sockets.length, sockets.length > 2 ? "✅ GENERÓ NUEVO ARRANQUE (QR nuevo)" : "❌ NO REARRANCÓ");

  // --- PRUEBA 3: socket "colgado" -> el vigilante debe reconectar ---
  const s3 = sockets[sockets.length - 1];
  s3.ev.emit("connection.update", { connection: "open" });
  await esperar(300);
  s3.ws.isOpen = false; // simula socket colgado sin evento de cierre
  console.log("\n[3] Simulando socket colgado (isOpen=false)... esperando al vigilante (~65s)");
  const antes = sockets.length;
  await esperar(66000);
  console.log("   Sockets ahora:", sockets.length, sockets.length > antes ? "✅ EL VIGILANTE RECONECTÓ" : "❌ EL VIGILANTE NO ACTUÓ");

  console.log("\n=========== FIN PRUEBAS DE CONEXIÓN ===========\n");
  process.exit(0);
})();
