/**
 * PRUEBA: cuando el cliente pregunta por requisitos, el bot NO debe listarlos;
 * debe responder que le dirá a un gestor que se los envíe.
 *   node tests/test_requisitos.js
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
      return { key: { id: "mock-" + enviados.length } };
    },
    logout: async () => {},
  };
  return mockSock;
}

const mockBaileys = {
  default: makeWASocket,
  makeWASocket,
  makeCacheableSignalKeyStore: (keys) => keys,
  Browsers: { ubuntu: () => ["Ubuntu", "Chrome", "1.0.0"] },
  useMultiFileAuthState: async () => ({ state: { creds: {}, keys: {} }, saveCreds: async () => {} }),
  DisconnectReason: { loggedOut: 401, connectionClosed: 428, restartRequired: 515 },
  downloadMediaMessage: async () => Buffer.from("x"),
  fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 0] }),
};

const origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "@whiskeysockets/baileys") return mockBaileys;
  return origRequire.apply(this, arguments);
};

process.env.PORT = process.env.TEST_PORT || "10058";
process.env.ADMIN_PHONE = "573226662517";
process.env.ADMIN_NOTIFICATIONS_ENABLED = "false";
process.env.AUTH_DIR = path.join(__dirname, "auth_test_req");
process.env.SELF_URL = "";

require("../server.js");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function msg(numero, texto) {
  return {
    key: { remoteJid: `${numero}@s.whatsapp.net`, fromMe: false, id: "m" + Math.random() },
    pushName: "Cliente Prueba",
    message: { conversation: texto },
  };
}

async function enviarMensaje(numero, texto) {
  enviados.length = 0;
  mockSock.ev.emit("messages.upsert", { type: "notify", messages: [msg(numero, texto)] });
  for (let i = 0; i < 40 && enviados.length === 0; i++) await esperar(500);
  await esperar(500);
  return enviados.map((e) => e.text).filter(Boolean);
}

const ESPERADO = /ya le digo a un gestor/i;

(async () => {
  console.log("\n=========== PRUEBA DE REQUISITOS ===========\n");
  await esperar(3500);
  if (!mockSock) { console.log("❌ No se creó el socket."); process.exit(1); }
  mockSock.ev.emit("connection.update", { connection: "open" });
  await esperar(500);

  const preguntas = [
    "Que tengo que mandar",
    "que necesito para la cedula",
    "cuales son los requisitos",
    "que debo enviar",
    "que papeles necesito",
    "que documentos necesito",
    "que datos debo dar",
  ];

  let numero = 573009990001;
  let ok = 0;
  for (const p of preguntas) {
    const resp = await enviarMensaje(numero++, p);
    const texto = resp.join(" | ");
    const paso = ESPERADO.test(texto);
    if (paso) ok++;
    console.log(`${paso ? "✅" : "❌"} "${p}"`);
    console.log(`   → ${texto || "(sin respuesta)"}`);
  }

  console.log(`\nResultado: ${ok}/${preguntas.length} correctas`);
  console.log(ok === preguntas.length ? "\n✅ TODAS CORRECTAS" : "\n⚠️ ALGUNAS FALLARON");
  console.log("\n=========== FIN ===========\n");
  process.exit(0);
})();
