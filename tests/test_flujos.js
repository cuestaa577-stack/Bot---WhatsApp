// Prueba de flujos de varios pasos: menú, elección de documento y cambios a mitad de camino.
const Module = require("module");
const { EventEmitter } = require("events");
const path = require("path");
const enviados = [];
let mockSock = null;
const makeWASocket = () => {
  const ev = new EventEmitter();
  mockSock = { ev, sendMessage: async (jid, c) => { enviados.push({ jid, text: c && c.text }); } };
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
process.env.PORT = "10088";
process.env.ADMIN_NOTIFICATIONS_ENABLED = "false";
process.env.AUTH_DIR = path.join(__dirname, "auth_test_flujos");
process.env.SELF_URL = "";
require("../server.js");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const msg = (numero, texto) => ({
  key: { remoteJid: `${numero}@s.whatsapp.net`, fromMe: false, id: "m" + Math.random() },
  pushName: "Cliente",
  message: { conversation: texto },
});
async function cruda(numero, message) {
  enviados.length = 0;
  mockSock.ev.emit("messages.upsert", { type: "notify", messages: [{ key: { remoteJid: `${numero}@s.whatsapp.net`, fromMe: false, id: "c" + Math.random() }, pushName: "Cliente", message }] });
  for (let i = 0; i < 40 && enviados.length === 0; i++) await esperar(500);
  await esperar(400);
  return enviados.map((e) => e.text).filter(Boolean).join(" | ");
}
async function tanda(numero, textos) {
  const out = [];
  for (const texto of textos) {
    enviados.length = 0;
    mockSock.ev.emit("messages.upsert", { type: "notify", messages: [msg(numero, texto)] });
    for (let i = 0; i < 60 && enviados.length === 0; i++) await esperar(500);
    await esperar(300);
    out.push({ in: texto, out: enviados.map((e) => e.text).filter(Boolean).join(" | ") });
  }
  return out;
}
(async () => {
  await esperar(3500);
  mockSock.ev.emit("connection.update", { connection: "open" });
  await esperar(500);
  let ok = 0, fail = 0;
  const check = (cond, name, extra) => {
    console.log((cond ? "✅ " : "❌ ") + name + (cond ? "" : "  -> " + (extra || "")));
    cond ? ok++ : fail++;
  };
  // Flujo 1: menú -> 1 (cédula) -> extravío -> precio -> sí (muestra)
  const f1 = await tanda("573001110001", ["menu", "1", "extravio", "cuanto es", "si"]);
  check(/c[eé]dula|C[eé]dula|opciones/i.test(f1[1].out), "Menú opción 1 lleva a cédula", f1[1].out);
  check(/extrav/i.test(f1[2].out) || /24|30/.test(f1[2].out), "Extravío responde precio/motivo", f1[2].out);
  check(/muestra|MUESTRA/i.test(f1[4].out) || /datos/i.test(f1[4].out), "Sí continúa hacia muestra/datos", f1[4].out);
  // Flujo 2: cédula a mitad cambia a licencia
  const f2 = await tanda("573001110002", ["hola", "cuanto es la cedula", "mejor quiero la licencia"]);
  check(/licencia/i.test(f2[2].out) && !/No logr[eé]/.test(f2[2].out), "Cambio a licencia a mitad de camino", f2[2].out);
  // Flujo 3: licencia -> grado 3 -> precio
  const f3 = await tanda("573001110003", ["cuanto es la licencia", "3"]);
  check(/48|precio|grado/i.test(f3[1].out), "Grado 3 responde con precio/continúa", f3[1].out);
  // Flujo 4: "olvidalo" / "mejor deja" -> cierre amable
  const f4 = await tanda("573001110004", ["cuanto es la cedula", "mejor olvidalo"]);
  check(/sin problema|Entiendo|aqu[ií]/i.test(f4[1].out) && !/No logr[eé]/.test(f4[1].out), "'Mejor olvídalo' cierra amable", f4[1].out);
  // Flujo 5: Chile (número chileno) precios en CLP tras elegir motivo
  const f5 = await tanda("56911110005", ["cuanto es la cedula", "extravio"]);
  check(/chilen/i.test(f5[1].out), "Número chileno ve precios en CLP", f5[1].out);
  // Flujo 6: cambiar de documento a mitad del estado grado
  const f6 = await tanda("573001110006", ["cuanto es la licencia", "cuanto es la cedula"]);
  check(/renovaci|extrav|hurto|deterioro|c[eé]dula es por/i.test(f6[1].out) && !/grado de licencia/i.test(f6[1].out), "Cede el paso a la cédula desde el estado grado", f6[1].out);
  // Flujo 7: cancelar en mitad del descuento ("mejor no quiero el descuento")
  const f7 = await tanda("573001110007", ["cuanto es la licencia", "3", "me sale descuento?", "mejor no quiero el descuento"]);
  check(!/nombre de la persona que nos recomiendas/i.test(f7[3].out) || /MUESTRA|SÍ o NO/i.test(f7[3].out), "Arrepentirse del descuento no registra basura", f7[3].out);
  // Flujo 8: cancelación global desde confirmar_muestra
  const f8 = await tanda("573001110008", ["cuanto es la licencia", "3", "si", "mejor olvidalo"]);
  check(/Sin problema/i.test(f8[3].out), "'Mejor olvídelo' en confirmar muestra cierra amable", f8[3].out);
  // Flujo 9: "sep" vale como sí en confirmar muestra
  const f9 = await tanda("573001110009", ["cuanto es la licencia", "3", "si", "sep"]);
  check(/MUESTRA|gestor/i.test(f9[3].out) || /MUESTRA/i.test(f9[2].out), "'sep' funciona como sí", f9[3].out || f9[2].out);
  // Flujo 10: cotizar en Ecuador mid-conversación (número colombiano)
  const f10 = await tanda("573001110010", ["hola", "cuanto es la cedula en ecuador", "extravio"]);
  check(/d[oó]lar|USD|23|americano/i.test(f10[2].out), "Cotiza en USD al mencionar Ecuador", f10[2].out);
  // Flujo 11: selección múltiple del menú (captura real "1y5")
  for (const [i, entrada] of ["1y5", "1 y 5", "1,5", "la 1 y la 5"].entries()) {
    const fm = await tanda("57300111" + (2000 + i), [entrada]);
    check(/Perfecto/.test(fm[0].out) && /renovaci/i.test(fm[0].out) && /licencia/i.test(fm[0].out) && !/No logr[eé]/.test(fm[0].out), `Selección múltiple "${entrada}"`, fm[0].out);
  }
  // Flujo 12: mensajes envueltos de WhatsApp (anuncio, temporal, botón, reacción)
  const e1 = await cruda("573001113001", { ephemeralMessage: { message: { extendedTextMessage: { text: "Hola quiero más información" } } } });
  check(/Bienvenido/i.test(e1) && !/Solo puedo atenderte/.test(e1), "Mensaje temporal se lee", e1);
  const e2 = await cruda("573001113002", { viewOnceMessage: { message: { conversation: "cuanto es la licencia" } } });
  check(/grado/i.test(e2), "Mensaje 'ver una vez' se lee", e2);
  const e3 = await cruda("573001113003", { buttonsResponseMessage: { selectedDisplayText: "Quiero más información" } });
  check(/Bienvenido/i.test(e3) && !/Solo puedo atenderte/.test(e3), "Respuesta de botón se lee", e3);
  const e4 = await cruda("573001113004", { someUnknownAdMessage: { foo: 1 } });
  check(/Bienvenido/i.test(e4) && !/Solo puedo atenderte/.test(e4), "Tipo desconocido da bienvenida y no rechaza", e4);
  enviados.length = 0;
  mockSock.ev.emit("messages.upsert", { type: "notify", messages: [{ key: { remoteJid: "573001113005@s.whatsapp.net", fromMe: false, id: "r1" }, message: { reactionMessage: { text: "👍" } } }] });
  await esperar(1500);
  check(enviados.length === 0, "Reacción 👍 no genera respuesta", enviados.map((e) => e.text).join("|"));
  console.log(`Total: ${ok + fail} · PASS: ${ok} · FAIL: ${fail}`);
  process.exit(fail ? 1 : 0);
})();
