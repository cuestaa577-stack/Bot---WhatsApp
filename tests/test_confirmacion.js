// Prueba: "te confirmo el viernes" -> cesa recordatorios, escribe el día acordado.
const Module = require("module");
const { EventEmitter } = require("events");
const path = require("path");
const enviados = [];
let mockSock = null;
const makeWASocket = () => {
  const ev = new EventEmitter();
  mockSock = { ev, sendMessage: async (jid, c) => { enviados.push({ jid, text: c && c.text }); }, };
  return mockSock;
};
const mockBaileys = {
  default: makeWASocket, makeWASocket,
  makeCacheableSignalKeyStore: (k) => k,
  Browsers: { ubuntu: () => ["Ubuntu", "Chrome", "1.0.0"] },
  useMultiFileAuthState: async () => ({ state: { creds: {}, keys: {} }, saveCreds: async () => {} }),
  DisconnectReason: { loggedOut: 401 },
  downloadMediaMessage: async () => Buffer.from("x"),
  fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 0] }),
};
const orig = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "@whiskeysockets/baileys") return mockBaileys;
  return orig.apply(this, arguments);
};
process.env.PORT = "10077";
process.env.ADMIN_NOTIFICATIONS_ENABLED = "false";
process.env.AUTH_DIR = path.join(__dirname, "auth_test");
process.env.SELF_URL = "";
process.env.CONFIRMACION_TEST_MS = "3000";
require("../server.js");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const msg = (numero, texto) => ({
  key: { remoteJid: `${numero}@s.whatsapp.net`, fromMe: false, id: "m" + Math.random() },
  pushName: "Cliente Prueba",
  message: { conversation: texto },
});
async function enviar(numero, texto) {
  enviados.length = 0;
  mockSock.ev.emit("messages.upsert", { type: "notify", messages: [msg(numero, texto)] });
  for (let i = 0; i < 60 && enviados.length === 0; i++) await esperar(500);
  await esperar(400);
  return enviados.map((e) => e.text).filter(Boolean);
}
(async () => {
  await esperar(3500);
  mockSock.ev.emit("connection.update", { connection: "open" });
  await esperar(500);
  const N = "573005550011";
  let ok = 0, fail = 0;
  const check = (cond, name, extra) => {
    console.log((cond ? "✅ " : "❌ ") + name + (cond ? "" : "  -> " + (extra || "")));
    cond ? ok++ : fail++;
  };
  // 1) La persona queda en "te confirmo el viernes"
  const r1 = await enviar(N, "te confirmo el viernes");
  check(/Quedo pendiente/.test(r1[0] || ""), "Responde quedando a la espera del viernes", r1[0]);
  // 2) El mensaje del día acordado llega UNA vez (3s en modo test)
  enviados.length = 0;
  const r3 = [];
  for (let i = 0; i < 20 && r3.length === 0; i++) { await esperar(500); if (enviados.length) r3.push(...enviados.map(e=>e.text)); }
  check(/Como acordamos/.test(r3[0] || ""), "Escribe UNA vez el día acordado", r3[0]);
  // 3) Sigue respondiendo consultas normalmente
  const r2 = await enviar(N, "cuanto es la licencia");
  check(/grado de licencia/.test(r2[0] || ""), "Sigue respondiendo consultas", r2[0]);
  // 4) Reprograma a nueva fecha
  const r4 = await enviar(N, "te confirmo el lunes");
  check(/Quedo pendiente/.test(r4[0] || ""), "Reprograma a nueva fecha", r4[0]);
  enviados.length = 0;
  const r4b = [];
  for (let i = 0; i < 20 && r4b.length === 0; i++) { await esperar(500); if (enviados.length) r4b.push(...enviados.map(e=>e.text)); }
  check(/Como acordamos/.test(r4b[0] || ""), "Nueva fecha también dispara el mensaje", r4b[0]);
  // 5) Si la persona retoma, se cancela lo pendiente
  await enviar(N, "te confirmo el lunes");
  const r5 = await enviar(N, "si quiero seguir con la cedula");
  check(r5.length > 0, "Retoma el trámite al confirmar", r5[0]);
  const r6 = [];
  enviados.length = 0;
  for (let i = 0; i < 16 && r6.length === 0; i++) { await esperar(500); if (enviados.length) r6.push(...enviados.map(e=>e.text)); }
  check(r6.length === 0, "Canceló la confirmación pendiente (no llegó el mensaje programado)");
  console.log(`Total: ${ok + fail} · PASS: ${ok} · FAIL: ${fail}`);
  process.exit(fail ? 1 : 0);
})();
