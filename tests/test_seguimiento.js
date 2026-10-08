/**
 * PRUEBA — Seguimiento automático con guarda de estado.
 *
 * Verifica que el bot:
 *   1) SÍ escribe un recordatorio a un cliente INTERESADO que queda en silencio.
 *   2) NO escribe recordatorio cuando la persona CIERRA UN ACUERDO.
 *   3) NO escribe recordatorio cuando la persona muestra DESINTERÉS.
 *   4) SÍ vuelve a escribir (reactiva) cuando la persona pregunta algo nuevo.
 *
 * Se ejecuta la lógica REAL del bot con Baileys simulado. El seguimiento se
 * acelera con SEGUIMIENTO_MINUTOS=0.05 (3 segundos) para no esperar 30 minutos.
 *
 * Uso:  node tests/test_seguimiento.js
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
process.env.PORT = process.env.TEST_PORT || "10066";
process.env.ADMIN_PHONE = "";
process.env.ADMIN_NOTIFICATIONS_ENABLED = "false";
process.env.AUTH_DIR = path.join(__dirname, "auth_test_seg");
process.env.SELF_URL = "";
process.env.PRICE_QUOTES_ENABLED = "true";
process.env.SEGUIMIENTO_MINUTOS = "0.05"; // 3 segundos

// ------------------------------------------------------------
// 3) Cargar el bot
// ------------------------------------------------------------
require("../server.js");

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function msg(numero, texto) {
  return {
    key: { remoteJid: `${numero}@s.whatsapp.net`, fromMe: false, id: "m" + Math.random() },
    pushName: "Cliente Prueba",
    message: { conversation: texto },
  };
}

// Envía un mensaje y devuelve SOLO las respuestas inmediatas al cliente.
async function enviarMensaje(numero, texto, timeoutMs = 12000) {
  const antes = enviados.length;
  mockSock.ev.emit("messages.upsert", { type: "notify", messages: [msg(numero, texto)] });
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs && enviados.length === antes) await esperar(150);
  await esperar(300);
  return enviados
    .slice(antes)
    .filter((e) => String(e.jid).startsWith(numero))
    .map((e) => e.text)
    .filter(Boolean);
}

// Espera una ventana y devuelve los mensajes NUEVOS dirigidos al cliente
// (aquí es donde aparecería un recordatorio automático).
async function ventana(numero, ms = 4500) {
  const antes = enviados.length;
  await esperar(ms);
  return enviados
    .slice(antes)
    .filter((e) => String(e.jid).startsWith(numero))
    .map((e) => e.text)
    .filter(Boolean);
}

const esRecordatorio = (textos) => textos.some((t) => /Sigo aquí/.test(t));

const resultados = [];
function comprobar(nombre, condicion, detalle) {
  resultados.push({ nombre, ok: !!condicion, detalle });
  console.log(`${condicion ? "✅ PASS" : "❌ FAIL"} — ${nombre}${detalle ? `  (${detalle})` : ""}`);
}

(async () => {
  console.log("\n=========== PRUEBA DE SEGUIMIENTO ===========\n");
  await esperar(3500); // arranque del servidor + Baileys

  if (!mockSock) {
    console.log("❌ No se creó el socket de Baileys.");
    process.exit(1);
  }
  mockSock.ev.emit("connection.update", { connection: "open" });
  await esperar(500);

  // -------- CASO 1: cliente INTERESADO -> SÍ recibe recordatorio --------
  const nA = "573000000101";
  await enviarMensaje(nA, "hola");
  await enviarMensaje(nA, "1"); // cédula -> pide motivo
  await enviarMensaje(nA, "1"); // motivo renovación -> precio (confirmar_continuar)
  const recA = await ventana(nA);
  comprobar("Interesado en silencio SÍ recibe recordatorio", esRecordatorio(recA), recA.length ? recA.join(" | ").slice(0, 60) : "sin mensajes");

  // -------- CASO 2: ACUERDO CERRADO -> NO recibe recordatorio --------
  const nB = "573000000102";
  await enviarMensaje(nB, "hola");
  await enviarMensaje(nB, "1");
  await enviarMensaje(nB, "1"); // confirmar_continuar
  await enviarMensaje(nB, "si"); // confirmar_muestra
  await enviarMensaje(nB, "si"); // cierre_pendiente
  await enviarMensaje(nB, "si"); // cierre_gestor_avisado
  await enviarMensaje(nB, "ok"); // post_cierre_atento (ACUERDO CERRADO)
  const recB = await ventana(nB);
  comprobar("Tras cerrar acuerdo NO recibe recordatorio", !esRecordatorio(recB), `mensajes: ${recB.length}`);

  // -------- CASO 3: DESINTERÉS -> NO recibe recordatorio --------
  const nC = "573000000103";
  await enviarMensaje(nC, "hola");
  await enviarMensaje(nC, "1");
  await enviarMensaje(nC, "1"); // confirmar_continuar
  await enviarMensaje(nC, "no"); // -> NO INTERESADO
  const recC = await ventana(nC);
  comprobar("Tras mostrar desinterés NO recibe recordatorio", !esRecordatorio(recC), `mensajes: ${recC.length}`);

  // -------- CASO 4: REACTIVACIÓN tras desinterés -> SÍ recibe --------
  await enviarMensaje(nC, "5"); // pregunta real (licencia) -> reactiva
  const recD = await ventana(nC);
  comprobar("Al volver a preguntar SÍ se reactiva el recordatorio", esRecordatorio(recD), recD.length ? recD.join(" | ").slice(0, 60) : "sin mensajes");

  // -------- CASO 5: tras acuerdo, un "toque" no reactiva; una pregunta sí --------
  await enviarMensaje(nB, "ok"); // toque genérico -> NO debe reactivar
  const recE1 = await ventana(nB);
  comprobar("Tras acuerdo, un 'ok' genérico NO reactiva", !esRecordatorio(recE1), `mensajes: ${recE1.length}`);

  await enviarMensaje(nB, "5"); // pregunta real -> SÍ reactiva
  const recE2 = await ventana(nB);
  comprobar("Tras acuerdo, una pregunta nueva SÍ reactiva", esRecordatorio(recE2), recE2.length ? recE2.join(" | ").slice(0, 60) : "sin mensajes");

  // -------- RESUMEN --------
  const fallos = resultados.filter((r) => !r.ok);
  console.log("\n================ RESUMEN ================");
  console.log(`Total: ${resultados.length} · PASS: ${resultados.length - fallos.length} · FAIL: ${fallos.length}`);
  console.log("========================================\n");
  process.exit(fallos.length ? 1 : 0);
})();
