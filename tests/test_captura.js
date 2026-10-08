/**
 * ARNÉS DE PRUEBAS — simula WhatsApp (Baileys) para ejecutar la lógica REAL
 * del bot sin necesidad de un teléfono. Verifica el flujo completo:
 *   conexión -> mensaje entrante -> respuesta enviada.
 *
 * Uso:  node test_harness.js
 */
const Module = require("module");
const { EventEmitter } = require("events");
const path = require("path");

// ------------------------------------------------------------
// 1) Mock de @whiskeysockets/baileys
// ------------------------------------------------------------
const enviados = []; // { jid, text }
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
  useMultiFileAuthState: async () => ({
    state: { creds: {}, keys: {} },
    saveCreds: async () => {},
  }),
  DisconnectReason: { loggedOut: 401, connectionClosed: 428, restartRequired: 515 },
  downloadMediaMessage: async () => Buffer.from("audio-falso"),
  fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 0] }),
};

const origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "@whiskeysockets/baileys") return mockBaileys;
  return origRequire.apply(this, arguments);
};

// ------------------------------------------------------------
// 2) Variables de entorno de prueba
// ------------------------------------------------------------
process.env.PORT = process.env.TEST_PORT || "10055";
process.env.ADMIN_PHONE = "573226662517";
process.env.ADMIN_NOTIFICATIONS_ENABLED = "false";
process.env.AUTH_DIR = path.join(__dirname, "auth_test");
process.env.SELF_URL = "";

// ------------------------------------------------------------
// 3) Cargar el bot
// ------------------------------------------------------------
require("../server.js");

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function msg(numero, texto, id) {
  return {
    key: { remoteJid: `${numero}@s.whatsapp.net`, fromMe: false, id: id || "m" + Math.random() },
    pushName: "Cliente Prueba",
    message: process.env.ADMODE ? { extendedTextMessage: { text: texto, contextInfo: { externalAdReply: { title: "Mas Informacion", sourceType: "ad", sourceUrl: "https://fb.me/x" } } } } : { conversation: texto },
  };
}

async function enviarMensaje(numero, texto) {
  enviados.length = 0;
  mockSock.ev.emit("messages.upsert", {
    type: "notify",
    messages: [msg(numero, texto)],
  });
  // Espera a que se procesen las respuestas (IA puede tardar).
  for (let i = 0; i < 60 && enviados.length === 0; i++) await esperar(500);
  await esperar(500);
  return enviados.map((e) => e.text).filter(Boolean);
}

(async () => {
  console.log("\n================ INICIO DE PRUEBAS ================\n");
  await esperar(3500); // deja que arranque el servidor y Baileys

  if (!mockSock) {
    console.log("❌ No se creó el socket de Baileys.");
    process.exit(1);
  }

  // Simular conexión abierta (como si se hubiese escaneado el QR).
  mockSock.ev.emit("connection.update", { connection: "open" });
  await esperar(500);

  const casos = [
    ["Como es la entrega","Como es la entrega"],
    ["y la entrega?","y la entrega?"],
    ["en fisico?","en fisico?"],
    ["lo imprimen?","lo imprimen?"],
    ["es confiable esto","es confiable esto"],
    ["sirve para trabajar","sirve para trabajar"],
    ["cuanto demora","cuanto demora"],
    ["donde estan","donde estan"],
    ["como pago","como pago"],
    ["puedo pagar despues","puedo pagar despues"],
    ["cuando pago","cuando pago"],
    ["perdi mi cedula","perdi mi cedula"],
    ["me la robaron","me la robaron"],
    ["se me vencio","se me vencio"],
    ["mi cedula esta rota","mi cedula esta rota"],
    ["quiero sacar licencia","quiero sacar licencia"],
    ["gracias","gracias"],
    ["ok","ok"],
    ["listo","listo"],
    ["¡Hola! Quiero más información","¡Hola! Quiero más información"],
    ["soy venezolano","soy venezolano"],
    ["buenas noches","buenas noches"],
    ["necesito ayuda","necesito ayuda"],
    ["me pueden ayudar","me pueden ayudar"],
    ["quiero saber mas","quiero saber mas"],
    ["a que hora atienden","a que hora atienden"],
    ["atienden los domingos","atienden los domingos"],
    ["¿Cómo funciona?","¿Cómo funciona?"],
    ["tienen descuento","tienen descuento"],
    ["hacen pasaporte","hacen pasaporte"],
    ["que servicios tienen","que servicios tienen"]
  ];

  let numero = 573001112233;
  for (const [texto, desc] of casos) {
    numero += 1; // cada caso con número nuevo para aislar el flujo
    const resp = await enviarMensaje(String(numero), texto);
    console.log(`📥 [${desc}]  "${texto}"`);
    if (!resp.length) {
      console.log("   ⚠️  SIN RESPUESTA\n");
    } else {
      resp.forEach((r) => console.log("   📤 " + r.replace(/\n/g, "\n      ")));
      console.log("");
    }
  }

  console.log("================ FIN DE PRUEBAS ================\n");
  process.exit(0);
})();
