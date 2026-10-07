const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  Browsers,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
require("dotenv").config();

// ============================================================
// RED DE SEGURIDAD: el bot NUNCA debe morir por un error puntual.
// Si algo falla (una excepción o una promesa rechazada), se registra
// y el bot SIGUE funcionando. Así no se queda "sin responder" de repente.
// ============================================================
process.on("uncaughtException", (err) => {
  console.error("💥 Excepción no controlada (el bot continúa):", err?.stack || err?.message || err);
  try {
    avisarErrorAdmin(`Excepción no controlada: ${err?.message || err}`);
  } catch (_) {}
});

process.on("unhandledRejection", (reason) => {
  console.error(
    "💥 Promesa rechazada no controlada (el bot continúa):",
    reason?.stack || reason?.message || reason
  );
});

const app = express();
app.use(express.json({ limit: "4mb" }));

// CORS: permite que la PWA de Habla'App (otro dominio) pueda llamar a este servidor.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, x-dev-key");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ============================================================
// CONFIGURACIÓN
// ============================================================

const PORT = process.env.PORT || 10000;
// Baileys: conexión por CÓDIGO QR (sin API de Meta).
const BOT_NAME = process.env.BOT_NAME || "Bot Tramites";
const AUTH_DIR = process.env.AUTH_DIR || path.join(__dirname, "auth_baileys");

const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
// Llama 3.3 fue retirado de Groq; se usa un modelo actual configurable.
// Si la variable de entorno GROQ_MODEL apunta a un modelo retirado
// (llama-3, llama-3.1, llama-3.3), se ignora automáticamente y el bot
// usa el modelo vigente sin que haya que cambiar nada en Render.
const MODELO_GROQ_POR_DEFECTO = "openai/gpt-oss-120b";
const MODELO_RETIRADO = /llama-?3(\.\d)?(-|\b)/i;
const GROQ_MODEL_RAW = String(process.env.GROQ_MODEL || "");
const GROQ_MODEL = MODELO_RETIRADO.test(GROQ_MODEL_RAW)
  ? MODELO_GROQ_POR_DEFECTO
  : GROQ_MODEL_RAW || MODELO_GROQ_POR_DEFECTO;
// URL de la API de Groq (configurable solo para pruebas locales con un servidor simulado).
const GROQ_CHAT_URL = process.env.GROQ_CHAT_URL || "https://api.groq.com/openai/v1/chat/completions";
// Modelo con VISIÓN (para analizar fotos de diseños/modelos que envía el dueño).
// Groq usa qwen/qwen3.8-27b como modelo multimodal vigente.
const GROQ_VISION_MODEL = String(process.env.GROQ_VISION_MODEL || "qwen/qwen3.8-27b");

const ADMIN_NUMBER = String(process.env.ADMIN_PHONE || "").replace(/\D/g, "");
const ADMIN_NUMBERS = Array.from(new Set([
  ADMIN_NUMBER,
  ...String(process.env.ADDITIONAL_CONTACT || "")
    .split(/[,;\s]+/)
    .map((v) => String(v).replace(/\D/g, ""))
    .filter(Boolean),
].filter(Boolean)));

// Número (con código de país, SIN "+" y SIN ceros iniciales) que se usa para
// vincular por CÓDIGO de 8 dígitos — la opción "Vincular con el número del
// teléfono" de WhatsApp. Es MÁS CONFIABLE que el QR porque no depende de la
// cámara ni de escanear a tiempo. Por defecto se usa el número del admin.
const PAIRING_PHONE = String(process.env.PAIRING_PHONE || ADMIN_NUMBER || "").replace(/\D/g, "");

// Avisos automáticos al administrador por WhatsApp (copia de cada aviso:
// primer mensaje, alta prioridad, solicitud de asesor, errores, bloqueos).
// Por defecto DESACTIVADOS: si el bot responde desde el mismo número donde
// llega toda la información, no hace falta reenviar copias al administrador.
// Actívalos con ADMIN_NOTIFICATIONS_ENABLED=true si algún día los quieres.
const ADMIN_NOTIFICATIONS_ENABLED =
  String(process.env.ADMIN_NOTIFICATIONS_ENABLED || "false").toLowerCase() === "true";

// Instrucciones enviadas por el administrador desde WhatsApp.
// Se mantienen activas durante toda la vida de la instancia de Render.
// También se pueden precargar con ADMIN_INSTRUCTIONS (separadas por |).
const instruccionesAdministrador = String(process.env.ADMIN_INSTRUCTIONS || "")
  .split("|")
  .map((v) => v.trim())
  .filter(Boolean)
  .slice(-20);

const CEDULA_API_URL =
  process.env.CEDULA_API_URL || "https://api.cedula.com.ve/api/v1";
const CEDULA_APP_ID =
  process.env.CEDULA_API_APP_ID || process.env.CEDULA_APP_ID || "";
const CEDULA_TOKEN =
  process.env.CEDULA_API_TOKEN || process.env.CEDULA_TOKEN || "";
const CEDULA_NACIONALIDAD = process.env.CEDULA_NACIONALIDAD || "V";

// Por seguridad queda desactivado por defecto.
// Actívalo únicamente si la actividad y las tarifas corresponden a un
// servicio legítimo y autorizado.
const PRICE_QUOTES_ENABLED =
  String(process.env.PRICE_QUOTES_ENABLED || "true").toLowerCase() === "true";

const PREGUNTA_LICENCIA = "🚗 ¿En qué grado de licencia estás interesado/a y si es por primera vez o renovación:\n2°, 3°, 4° o 5°?";
// Respaldo durable de sesiones en Supabase (tabla habla_state).
// Si no está configurado, el bot sigue usando solo el respaldo local.
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;

// Las sesiones viven en memoria y se respaldan cada minuto en sesiones.json,
// para que el bot recuerde en qué iba cada cliente incluso tras un reinicio.
const ARCHIVO_SESIONES = path.join(__dirname, "sesiones.json");
const sesiones = new Map();
const bloqueados = new Set();

// IDs de mensajes ya procesados: Meta a veces entrega el mismo mensaje dos veces.
const mensajesProcesados = new Map();

function sesionRespaldable(s) {
  return {
    estado: s.estado || null,
    nombre: s.nombre || "",
    pais: s.pais || null,
    procedimiento: s.procedimiento || null,
    motivo: s.motivo || null,
    grado: s.grado || null,
    cerrada: Boolean(s.cerrada),
    lastActivity: s.lastActivity || Date.now(),
    historial: (s.historial || []).slice(-20),
  };
}

// Supabase: respaldo durable de las sesiones (sobrevive a reinicios de Render).
async function guardarSesionesSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;

  const filas = [];
  for (const [numero, s] of sesiones) {
    filas.push({
      id: numero,
      data: sesionRespaldable(s),
      updated_at: new Date().toISOString(),
    });
  }

  // Solo las últimas 500 conversaciones para no crecer sin control.
  const lote = filas.slice(-500);

  await axios.post(`${SUPABASE_URL}/rest/v1/habla_state`, lote, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      // Upsert: inserta o actualiza según la clave primaria (id = número).
      Prefer: "resolution=merge-duplicates",
    },
  });
}

async function cargarSesionesSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;

  const { data } = await axios.get(
    `${SUPABASE_URL}/rest/v1/habla_state?select=id,data&order=updated_at.desc&limit=500`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }
  );

  let recuperadas = 0;
  for (const fila of data || []) {
    if (!fila?.id || !fila.data) continue;
    sesiones.set(fila.id, { ...fila.data, historial: fila.data.historial || [] });
    recuperadas++;
  }

  if (recuperadas) {
    console.log(`Sesiones recuperadas de Supabase: ${recuperadas}`);
  }
}

function guardarSesionesEnDisco() {
  try {
    const datos = [];
    for (const [numero, s] of sesiones) {
      datos.push([numero, sesionRespaldable(s)]);
    }
    // Solo las últimas 500 conversaciones para no crecer sin control.
    const recientes = Object.fromEntries(datos.slice(-500));
    fs.writeFileSync(ARCHIVO_SESIONES, JSON.stringify(recientes));
  } catch (e) {
    console.error("No se pudo guardar sesiones.json:", e.message);
  }

  // Respaldo durable en Supabase; si falla, queda el respaldo local.
  guardarSesionesSupabase().catch((e) => {
    console.error("No se pudo guardar en Supabase:", e.message);
  });
}

function cargarSesionesDesdeDisco() {
  try {
    if (!fs.existsSync(ARCHIVO_SESIONES)) return;
    const datos = JSON.parse(fs.readFileSync(ARCHIVO_SESIONES, "utf-8"));
    for (const [numero, s] of Object.entries(datos || {})) {
      sesiones.set(numero, { ...s, historial: s.historial || [] });
    }
    if (sesiones.size) console.log(`Sesiones recuperadas del respaldo: ${sesiones.size}`);
  } catch (e) {
    console.error("No se pudo leer sesiones.json:", e.message);
  }
}

// ============================================================
// TABLA DE CLIENTES: registro persistente de cada cliente y su etapa
// ============================================================
const ARCHIVO_CLIENTES = path.join(__dirname, "clientes.json");
const clientes = new Map();

function cargarClientesDesdeDisco() {
  try {
    if (!fs.existsSync(ARCHIVO_CLIENTES)) return;
    const datos = JSON.parse(fs.readFileSync(ARCHIVO_CLIENTES, "utf-8"));
    for (const [numero, c] of Object.entries(datos || {})) {
      clientes.set(numero, { etapa: "NUEVO", creado: Date.now(), ...c, numero });
    }
    if (clientes.size) console.log(`Clientes recuperados del respaldo: ${clientes.size}`);
  } catch (e) {
    console.error("No se pudo leer clientes.json:", e.message);
  }
}

function guardarClientesEnDisco() {
  try {
    const datos = {};
    for (const [numero, c] of clientes) datos[numero] = c;
    fs.writeFileSync(ARCHIVO_CLIENTES, JSON.stringify(datos));
  } catch (e) {
    console.error("No se pudo guardar clientes.json:", e.message);
  }
}

// Trámite legible a partir de la sesión del cliente.
function tramiteTexto(s) {
  if (!s?.procedimiento) return "";
  if (s.procedimiento === "cedula") return `Cédula${s.motivo ? ` (${s.motivo})` : ""}`;
  if (s.procedimiento === "licencia") return `Licencia${s.grado ? ` ${s.grado}°` : ""}`;
  if (s.procedimiento === "antecedentes") return "Antecedentes penales";
  return s.procedimiento;
}

// Registra o actualiza un cliente en la tabla con su etapa del flujo.
function registrarEtapaCliente(numero, etapa, extra = {}) {
  const n = String(numero || "").replace(/\D/g, "");
  if (!n) return;
  const s = sesiones.get(n);
  const c = clientes.get(n) || {
    numero: n,
    nombre: "",
    pais: null,
    tramite: "",
    etapa: "NUEVO",
    creado: Date.now(),
    actualizado: Date.now(),
  };
  Object.assign(c, extra, {
    numero: n,
    nombre: s?.nombre || c.nombre || "",
    pais: s?.pais || c.pais || null,
    tramite: tramiteTexto(s) || c.tramite || "",
    etapa: etapa || c.etapa || "NUEVO",
    actualizado: Date.now(),
  });
  clientes.set(n, c);
  guardarClientesEnDisco();
}

function fechaCliente(ts) {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ts));
}

// Resumen de la tabla para el administrador.
function tablaClientesTexto() {
  if (!clientes.size) return "📋 Todavía no hay clientes registrados.";
  const lista = [...clientes.values()]
    .sort((a, b) => b.actualizado - a.actualizado)
    .slice(0, 30);
  let out = `📋 *TABLA DE CLIENTES* (${clientes.size} registrados)\n\n`;
  for (const c of lista) {
    out += `*+${c.numero}* · ${c.nombre || "Sin nombre"}\n`;
    out += `${c.tramite || "Trámite sin definir"} · ${c.pais || "País sin confirmar"} → *${c.etapa}* · ${fechaCliente(c.actualizado)}\n\n`;
  }
  return out.trim();
}

function detalleClienteTexto(c) {
  return `👤 *CLIENTE +${c.numero}*

👤 Nombre: ${c.nombre || "Sin nombre"}
🌎 País: ${c.pais || "Sin confirmar"}
📌 Trámite: ${c.tramite || "Sin definir"}
📍 Etapa: *${c.etapa}*
📅 Registrado: ${fechaCliente(c.creado)}
🔄 Última actualización: ${fechaCliente(c.actualizado)}

Para cambiar su etapa escribe: cliente ${c.numero} nueva etapa`;
}

// ============================================================
// PAÍSES Y TARIFAS CONFIGURADAS
// ============================================================

const PRECIOS_PAIS = {
  Colombia: {
    prefijo: "57",
    timezone: "America/Bogota",
    cedula: { renovacion: 35000, extravio: 30000, hurto: 27000, deterioro: 25000 },
    licencia2: 37000,
    licencia3: 48000,
    licencia4: 58000,
    licencia5: 68000,
    antecedentes: 28000,
    moneda: "COP",
  },
  Chile: {
    prefijo: "56",
    timezone: "America/Santiago",
    cedula: { renovacion: 26000, extravio: 24000, hurto: 22000, deterioro: 20000 },
    licencia2: 30000,
    licencia3: 35000,
    licencia4: 40000,
    licencia5: 45000,
    antecedentes: 28000,
    moneda: "CLP",
  },
  Ecuador: {
    prefijo: "593",
    timezone: "America/Guayaquil",
    cedula: { renovacion: 25, extravio: 23, hurto: 22, deterioro: 20 },
    licencia2: 30,
    licencia3: 35,
    licencia4: 45,
    licencia5: 50,
    antecedentes: null,
    moneda: "USD",
  },
};

function normalizar(v) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function limpiarTelefono(v) {
  return String(v || "").replace(/\D/g, "");
}

// Precio de cédula según el motivo (renovación, extravío, hurto o deterioro).
function precioCedula(datos, motivo) {
  const tabla = datos && typeof datos.cedula === "object" ? datos.cedula : null;
  if (!tabla) return null;
  const m = normalizar(motivo);
  const clave = { renovacion: "renovacion", extravio: "extravio", hurto: "hurto", deterioro: "deterioro" }[m] || "renovacion";
  return tabla[clave] !== undefined ? tabla[clave] : tabla.renovacion;
}

function precio(valor, moneda) {
  if (valor === null || valor === undefined) return "No disponible";
  const numero = Number(valor);

  if (moneda === "USD") return `$${numero.toLocaleString("en-US")} dólares`;
  if (moneda === "COP") return `${numero.toLocaleString("es-CO")} pesos colombianos`;
  if (moneda === "CLP") return `${numero.toLocaleString("es-CL")} pesos chilenos`;

  return `${numero.toLocaleString("es-CO")} ${moneda}`;
}

function esAdministrador(numero) {
  const n = String(numero || "").replace(/\D/g, "");
  return ADMIN_NUMBERS.includes(n);
}

function guardarInstruccionAdministrador(texto) {
  const instruccion = String(texto || "").trim();
  if (!instruccion) return;
  instruccionesAdministrador.push(instruccion.slice(0, 1200));
  if (instruccionesAdministrador.length > 20) instruccionesAdministrador.shift();
}

function instruccionesAdminTexto() {
  if (!instruccionesAdministrador.length) return "No hay instrucciones temporales del administrador registradas.";
  return instruccionesAdministrador.map((x, i) => `${i + 1}. ${x}`).join("\n");
}

function limpiarInstruccionesAdministrador() {
  instruccionesAdministrador.length = 0;
}

async function procesarMensajeAdministrador(numero, texto) {
  const original = String(texto || "").trim();
  const t = normalizar(original);

  if (/^(ver|mostrar|listar) instrucciones?( del administrador)?$/.test(t)) {
    return `👨🏻‍💻 ADMINISTRADOR RECONOCIDO\n\nINSTRUCCIONES ACTIVAS:\n${instruccionesAdminTexto()}`;
  }

  if (/^(borrar|limpiar|eliminar) instrucciones?( del administrador)?$/.test(t)) {
    limpiarInstruccionesAdministrador();
    return "✅ He borrado las instrucciones temporales del administrador.";
  }

  if (/^(clientes|tabla|tabla de clientes|listado de clientes)$/.test(t)) {
    return tablaClientesTexto();
  }

  const mCliente = original.match(/^cliente\s*(\+?[\d][\d\s.-]{5,20})\s*(.*)$/i);
  if (mCliente) {
    const nCli = mCliente[1].replace(/\D/g, "");
    const c = clientes.get(nCli);
    const nuevaEtapa = mCliente[2].trim();

    if (!c) return `⚠️ No tengo registrado el cliente +${nCli}. Pídele que escriba al bot primero.`;

    if (!nuevaEtapa) return detalleClienteTexto(c);

    registrarEtapaCliente(nCli, nuevaEtapa.slice(0, 40).toUpperCase());
    return `✅ Cliente +${nCli}: etapa actualizada a *${nuevaEtapa.slice(0, 40).toUpperCase()}*.`;
  }

  if (/^(estado|estado del bot|status|salud|health)$/.test(t)) {
    return `✅ BOT ACTIVO\n\n👨🏻‍💻 Administrador: reconocido\n🤖 Modelo: ${GROQ_MODEL}\n🔍 Consulta de cédula: ACTIVA (${CEDULA_APP_ID && CEDULA_TOKEN ? "API oficial" : "consulta web gratuita"})\n📋 Requisitos automáticos: DESACTIVADOS (los informa el gestor)`;
  }

  const prueba = original.match(/^(?:probar|test|consultar)\s+cedula\s*[:#-]?\s*([vVeE]?[-\s.]?\d[\d\s.-]{4,12})$/i);
  if (prueba) {
    const cedula = soloDigitos(prueba[1]);
    const consulta = await consultarCedula(cedula);
    if (!consulta.ok) return `⚠️ Consulta de cédula: ${consulta.mensaje}`;
    return respuestaCedula(consulta.data);
  }

  let instruccion = original.replace(/^(instruccion|instrucción|regla|orden)\s*[:=-]?\s*/i, "").trim();
  if (!instruccion) {
    return "👨🏻‍💻 Administrador reconocido. Envíame la instrucción que quieres que siga el bot.";
  }

  guardarInstruccionAdministrador(instruccion);
  return "✅ Instrucción del administrador registrada y activa para las conversaciones. Las reglas de seguridad y las funciones técnicas del bot se mantienen intactas.";
}

// ============================================================
// BIENVENIDA / MENÚ
// ============================================================

const BIENVENIDA =
  "¡Hola! 👋😊 Bienvenido/a.\nEstamos aquí para orientarte y acompañarte en tus trámites. ¡Será un gusto ayudarte! 🇻🇪🤝";

const MENU = `${BIENVENIDA}

Escribe el número de la opción que necesitas:

1️⃣ Renovación de cédula
2️⃣ Duplicado por extravío
3️⃣ Duplicado por hurto
4️⃣ Duplicado por deterioro
5️⃣ Licencia de conducir
6️⃣ Antecedentes penales
7️⃣ Verifica tu C.I`;

// Las opciones de asesor y preguntas frecuentes NO figuran en el menú,
// pero siguen activas solas: si el cliente menciona "asesor" o hace una
// pregunta, el bot las responde automáticamente.

const PEDIR_CEDULA =
  "🔍 CONSULTA DE CÉDULA\n\nEnvíame únicamente el número de tu cédula, usando solo dígitos.\n\nEjemplo:\n12345678";

// ============================================================
// SESIONES
// ============================================================

function crearSesion(numero, datos = {}) {
  const existente = sesiones.get(numero);
  const ahora = Date.now();

  const s = {
    estado: null,
    nombre: existente?.nombre || "",
    pais: existente?.pais || null,
    procedimiento: existente?.procedimiento || null,
    motivo: existente?.motivo || null,
    grado: existente?.grado || null,
    cerrada: false,
    lastActivity: ahora,
    historial: existente?.historial || [],
    ...datos,
    lastActivity: ahora,
    cerrada: false,
  };

  sesiones.set(numero, s);
  return s;
}

function obtenerSesion(numero) {
  return sesiones.get(numero);
}

function actualizarSesion(numero, datos = {}) {
  const s = sesiones.get(numero) || crearSesion(numero);
  Object.assign(s, datos, { lastActivity: Date.now() });
  s.cerrada = false;
  sesiones.set(numero, s);
  return s;
}

function registrarHistorial(numero, role, text) {
  const s = sesiones.get(numero) || crearSesion(numero);
  s.historial.push({ role, text: String(text).slice(0, 1500), at: Date.now() });
  if (s.historial.length > 20) s.historial = s.historial.slice(-20);
  s.lastActivity = Date.now();
  sesiones.set(numero, s);
}

function cerrarPorInactividad(numero) {
  const s = sesiones.get(numero);
  if (!s || s.cerrada) return false;

  if (Date.now() - s.lastActivity >= SESSION_TIMEOUT_MS) {
    s.cerrada = true;
    s.estado = s.estado || null;
    sesiones.set(numero, s);
    return true;
  }

  return false;
}

// ============================================================
// PAÍS: PRIMERO LO QUE DIGA EL CLIENTE; TELÉFONO SOLO COMO APOYO
// ============================================================

function detectarPaisTexto(texto) {
  const t = normalizar(texto);

  if (/\b(chile|chileno|chilena|santiago)\b/.test(t)) return "Chile";
  if (/\b(ecuador|ecuatoriano|ecuatoriana|quito|guayaquil)\b/.test(t))
    return "Ecuador";
  if (/\b(colombia|colombiano|colombiana|bogota|medellin|cali)\b/.test(t))
    return "Colombia";

  return null;
}

function detectarPaisTelefono(numero) {
  const n = limpiarTelefono(numero);

  for (const [pais, datos] of Object.entries(PRECIOS_PAIS)) {
    if (n.startsWith(datos.prefijo)) return pais;
  }

  return null;
}

function obtenerPais(numero, texto = "") {
  const porTexto = detectarPaisTexto(texto);
  if (porTexto) return porTexto;

  const s = obtenerSesion(numero);
  if (s?.pais) return s.pais;

  return detectarPaisTelefono(numero) || null;
}

function datosPais(numero, texto = "") {
  const pais = obtenerPais(numero, texto);
  return pais ? { pais, ...PRECIOS_PAIS[pais] } : null;
}

// ============================================================
// HORARIO: LUNES A SÁBADO 8:00 A.M. - 8:00 P.M.
// ============================================================

function saludoPorHora(numero, texto = "") {
  const datos = datosPais(numero, texto);
  const timezone = datos?.timezone || "America/Bogota";

  const hour = Number(
    new Intl.DateTimeFormat("es-CO", { timeZone: timezone, hour: "2-digit", hour12: false }).format(new Date())
  );

  if (hour < 12) return "buen día";
  if (hour < 19) return "buenas tardes";
  return "buenas noches";
}

function estadoHorario(numero, texto = "") {
  const datos = datosPais(numero, texto);
  const timezone = datos?.timezone || "America/Bogota";

  const partes = new Intl.DateTimeFormat("es-CO", {
    timeZone: timezone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const get = (tipo) => partes.find((p) => p.type === tipo)?.value || "";

  const weekday = get("weekday");
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const minutos = hour * 60 + minute;

  const domingo = normalizar(weekday) === "domingo";
  const abierto = !domingo && minutos >= 8 * 60 && minutos < 20 * 60;

  return {
    abierto,
    timezone,
    texto: abierto
      ? "🟢 En este momento estamos dentro del horario de atención."
      : "🔴 En este momento estamos fuera del horario de atención. Nuestro horario es de lunes a sábado, de 8:00 a. m. a 8:00 p. m. El domingo no atendemos.",
  };
}

// ============================================================
// SERVICIOS NO DISPONIBLES / RESTRICCIONES
// ============================================================

function esPrimeraCedula(texto) {
  const t = normalizar(texto);

  return (
    /primera vez|por primera vez|primera cedula|sacar cedula por primera vez|cedula por primera vez/.test(
      t
    ) &&
    /cedula/.test(t)
  );
}

function esPasaporte(texto) {
  return /\bpasaporte(s)?\b/.test(normalizar(texto));
}

function esConsuladoCerrado(texto) {
  const t = normalizar(texto);
  return (
    /(consulado|consulado venezolano)/.test(t) &&
    /(cerrado|no abre|no ha abierto|no abrio|no esta abierto|todavia no abre)/.test(
      t
    )
  );
}

function respuestaRestriccion(texto) {
  const t = normalizar(texto);

  if (esPasaporte(texto)) {
    return `❌ Los pasaportes no forman parte de nuestros servicios.

Para ese trámite debes utilizar el canal oficial correspondiente.`;
  }

  if (esPrimeraCedula(texto)) {
    return `❌ La primera cédula venezolana solicitada desde el exterior no la gestionamos por este medio.

Ese proceso debe realizarse por el canal oficial que corresponda.`;
  }

  if (esConsuladoCerrado(texto)) {
    return `Si el consulado todavía está cerrado o aún no ha iniciado atención, debes esperar a que abra para realizar el proceso correspondiente.

No sustituimos al consulado en ese trámite.`;
  }

  if (
    /\b(partida|partidas|acta|actas) de nacimiento\b/.test(t) ||
    /\bcertificado(s)?\b/.test(t) ||
    /\bconstancia(s)?\b/.test(t)
  ) {
    if (!t.includes("antecedente")) {
      return "❌ Ese documento no está incluido entre los servicios disponibles.";
    }
  }

  // Solo se atienden documentos venezolanos, independientemente del país de residencia.
  if (/cedula colombiana|cedula de colombia|documento colombiano|dni colombiano|cedula chilena|cedula de chile|documento chileno|cedula ecuatoriana|cedula de ecuador|documento ecuatoriano/.test(t)) {
    return "Bueno, te comento: solo gestionamos documentos venezolanos. Lo siento, no tramitamos cédulas colombianas, chilenas ni ecuatorianas.";
  }

  return null;
}

// ============================================================
// DETECCIÓN DE MOTIVO / PROCEDIMIENTO
// ============================================================

function detectarMotivo(texto) {
  const t = normalizar(texto);

  if (/hurto|robo|robaron|me la robaron|me lo robaron|atraco/.test(t))
    return "hurto";

  if (
    /extravio|extravie|perdi|perdida|se me perdio|la perdi|lo perdi/.test(t)
  )
    return "extravío";

  if (
    /deterioro|deteriorada|danada|dano|rota|roto|ilegible|borrosa|maltratada/.test(
      t
    )
  )
    return "deterioro";

  if (/vencida|vencido|se me vencio|caducada|caducado|renovar|renovacion/.test(t))
    return "renovación";

  return null;
}

function detectarGrado(texto) {
  const t = normalizar(texto);

  if (/\b(?:grado\s*2|licencia\s*2|2do|2da|segundo)\b/.test(t)) return 2;
  if (/\b(?:grado\s*3|licencia\s*3|3ro|3ra|tercer)\b/.test(t)) return 3;
  if (/\b(?:grado\s*4|licencia\s*4|4to|4ta|cuarto)\b/.test(t)) return 4;
  if (/\b(?:grado\s*5|licencia\s*5|5to|5ta|quinto)\b/.test(t)) return 5;

  return null;
}

function detectarProcedimiento(texto) {
  const t = normalizar(texto);

  if (/antecedente(s)?|record policial/.test(t)) return "antecedentes";
  if (/licencia|conducir|manejar|carnet de conducir/.test(t)) return "licencia";
  if (/cedula|documento de identidad/.test(t)) {
    const motivo = detectarMotivo(texto);
    if (motivo) return motivo;
    return "cedula";
  }

  return null;
}

// ============================================================
// INTENCIONES DIRECTAS
// ============================================================

function esIntencionTramite(texto) {
  const t = normalizar(texto);

  return (
    /quiero realizar(?: el)? tramite/.test(t) ||
    /quiero hacer(?: el)? tramite/.test(t) ||
    /quiero iniciar(?: el)? tramite/.test(t) ||
    /quiero solicitar(?: el)? tramite/.test(t) ||
    /deseo realizar(?: el)? tramite/.test(t) ||
    /necesito realizar(?: el)? tramite/.test(t) ||
    /quiero tramitar/.test(t) ||
    /quiero iniciar (?:el |mi |un )?(?:tramite|proceso|solicitud)/.test(t) ||
    /quiero renovar/.test(t) ||
    /quiero sacar/.test(t)
  );
}

function esPreguntaPrecio(texto) {
  const t = normalizar(texto);
  return /cuanto cuesta|cuanto vale|precio|costo|tarifa|cuanto debo pagar|valor/.test(
    t
  );
}

function esPreguntaHorario(texto) {
  const t = normalizar(texto);
  return /horario|hora de atencion|estan atendiendo|estan abiertos|abren|cierran|hasta que hora/.test(
    t
  );
}

function esPreguntaNombre(texto) {
  const t = normalizar(texto);
  return /como te llamas|cual es tu nombre|quien eres|eres un bot|eres un robot|eres humano|tu nombre/.test(t);
}

function esPreguntaLlamada(texto) {
  const t = normalizar(texto);
  return /me puedo llamar|puedo llamar|puedo llamarlos|llamada telefonica|llamar por telefono/.test(
    t
  );
}

function esPreguntaOficina(texto) {
  const t = normalizar(texto);
  return /tienen oficina|donde puedo ir|donde estan|donde quedan|donde se encuentran|donde se ubican|donde se ubica|donde ubicados|donde estan ubicados|cual es su ubicacion|direccion fisica|oficina fisica|ubicacion fisica|tienen sede|tienen local/.test(
    t
  );
}

function esPreguntaLegal(texto) {
  const t = normalizar(texto);
  return /es legal|son legales|totalmente legales/.test(t);
}

function esPreguntaSeguridad(texto) {
  const t = normalizar(texto);
  return /es seguro|es totalmente seguro|mis datos|datos protegidos|confidencial/.test(
    t
  );
}

function esPreguntaOriginal(texto) {
  const t = normalizar(texto);
  return /es original|es copia|son originales|son copias|documento original/.test(
    t
  );
}

function esPreguntaTiempo(texto) {
  const t = normalizar(texto);
  return /cuanto tarda|cuanto tiempo|cuanto demora|cuanto se demora|cuando estara listo|en cuanto tiempo/.test(
    t
  );
}

function esPreguntaDocumentos(texto) {
  const t = normalizar(texto);
  return /que documentos puedo gestionar|que documentos hacen|que tramites hacen|que puedo gestionar/.test(
    t
  );
}

function esPreguntaMultiple(texto) {
  const t = normalizar(texto);
  return /varios documentos|mas de un documento|varios tramites|dos documentos|varios a la vez/.test(
    t
  );
}

function esPreguntaPaises(texto) {
  const t = normalizar(texto);
  return /en que paises|que paises atienden|que paises realizan|que paises hacen|realizan tramites en|atienden en colombia|atienden en chile|atienden en ecuador|atienden fuera/.test(
    t
  );
}

function esPreguntaRequisitos(texto) {
  const t = normalizar(texto);
  return /que necesito|requisitos|que debo enviar|que documentos necesito para/.test(
    t
  );
}

function esPreguntaPago(texto) {
  const t = normalizar(texto);
  return /como pago|donde pago|metodos de pago|formas de pago|como puedo pagar|se puede pagar/.test(
    t
  );
}

function esPreguntaDescuento(texto) {
  const t = normalizar(texto);
  return /descuento|rebaja|mas barato|algo mas economico|un poco menos|baja(?:r|le|ndole)?\s+(?:[\w]+\s+){0,2}(?:el\s+)?precio|lo menos|lo minimo|precio minimo|precio mas bajo|en cuanto me lo (?:dejas|deje|dejas)|cuanto es lo (?:menos|minimo|minimo que me puedes cobrar)/.test(
    t
  );
}

// Detecta cuando el cliente menciona quién lo recomendó, para poder
// avisarle al gestor y aplicarle el descuento a quien refirió.
function detectarReferidoPor(texto) {
  const original = String(texto || "").trim();
  const m = original.match(
    /(?:me\s+recomend[oó]|recomendad[oa]\s+por|por\s+recomendaci[oó]n\s+de|me\s+refiri[oó])\s+(.+)/i
  );
  if (!m) return null;

  let nombre = m[1].trim().replace(/^(mi|el|la|un|una|de)\s+/i, "");
  nombre = nombre.split(/[.,;!?\n]/)[0].trim();

  if (!nombre || nombre.length > 60 || nombre.split(" ").length > 5) return null;
  return nombre;
}

// Agradecimiento o frase de cierre tras la muestra (gracias, dale, ya, esta bien, etc.)
// Distinto de esRespuestaSi porque aquí no se está confirmando un paso del flujo,
// solo se está cerrando amablemente la conversación.
function esAgradecimientoCierre(texto) {
  const t = normalizar(texto).replace(/[.!?,;:]+$/g, "").trim();
  if (/^no\b/.test(t)) return false;
  if (/gracias/.test(t)) return true;
  return /^(si esta bien|esta bien|vale perfecto|dale|ya|perfecto|genial|muy bien|todo bien|vale)$/.test(t);
}

// "Ok" / "Okay" / "Okey" solos: es la señal de que el cliente ya no tiene
// más dudas y la conversación puede darse por finalizada.
function esCierreFinal(texto) {
  const t = normalizar(texto).replace(/[.!?,;:]+$/g, "").trim();
  return /^(ok|okay|okey)$/.test(t);
}

function esAcuerdoContinuidad(texto) {
  const t = normalizar(texto).replace(/[.!?,;:]+$/g, "").trim();

  if (esRespuestaSi(texto)) return true;
  if (esAgradecimientoCierre(texto)) return true;
  if (esCierreFinal(texto)) return true;

  return /^(ok si claro|si esta bien|si|si gracias|si por favor|si claro|si si quiero|claro me interesa|si me interesa|estare al pendiente|estare pendiente|ok gracias)$/.test(
    t
  );
}

// Mensaje genérico de "toque" tras el cierre (sin contenido de pregunta real):
// ok, hola, si, "una pregunta", etc. En estos casos el bot solo debe quedar
// atento, sin reabrir el menú completo ni responder algo que no preguntaron.
function esToqueAtencionPostCierre(texto) {
  const t = normalizar(texto).replace(/[.!?,;:]+$/g, "").trim();
  return /^(ok|okay|okey|hola+|ola+|hey|buenas|buenos dias|buenas tardes|buenas noches|si|si|una pregunta|tengo una pregunta|una duda|tengo una duda|disculpa|oye|amigo|hermano)$/.test(
    t
  );
}

function esObjecionPrecio(texto) {
  const t = normalizar(texto);
  return /muy caro|demasiado caro|no puedo pagar|no tengo dinero|esta caro|no me alcanza|no puedo costear/.test(
    t
  );
}

function esDesconfianza(texto) {
  const t = normalizar(texto);
  return /no confio|desconfio|desconfianza|me da miedo|no estoy seguro|no estoy segura|como se que no es una estafa|es una estafa|me van a estafar/.test(t);
}

function esPreguntaCedulaPosterior(texto) {
  const t = normalizar(texto);
  return (
    /parte posterior/.test(t) ||
    /parte de atras/.test(t) ||
    /codigo de la parte de atras/.test(t) ||
    /codigo atras/.test(t)
  );
}

function esPreguntaQuienes(texto) {
  const t = normalizar(texto);
  return /quienes son|quien es ustedes|que son ustedes|ustedes quienes|me hablan de ustedes|que empresa son|de donde son/.test(t);
}

function esPreguntaOficinaFisica(texto) {
  const t = normalizar(texto);
  return /oficina fisica|son una oficina|es una oficina|son fisicos|atienden en oficina/.test(t);
}

function esPreguntaEstafadores(texto) {
  const t = normalizar(texto);
  return /estafador|estafadora|timadores|ladrones/.test(t);
}

function esPreguntaEstafadoAntes(texto) {
  const t = normalizar(texto);
  return /me estafaron|estafado antes|estafada antes/.test(t);
}

function esPreguntaVerdadEstafa(texto) {
  const t = normalizar(texto);
  return /como se que esto es verdad|esto es verdad|no es una estafa|es verdad o no|es real o falso|como se que es real/.test(t);
}

function esPreguntaComoFunciona(texto) {
  const t = normalizar(texto);
  return /como funciona|como es el proceso|como es el tramite|como trabajan|como hacen el/.test(t);
}

function esPreguntaFacil(texto) {
  const t = normalizar(texto);
  return /es facil|que tan facil|es dificil|es complicado/.test(t);
}

function esPreguntaPorQueMedio(texto) {
  const t = normalizar(texto);
  return /por (?:que|cual) medio|por whatsapp|en que medio|que medio se/.test(t);
}

function esPreguntaSalirCasa(texto) {
  const t = normalizar(texto);
  return /salir de (?:mi )?casa|desde mi casa|moverme|ir en persona|ir a algun lugar|presencialmente/.test(t);
}

function esPreguntaSerie(texto) {
  const t = normalizar(texto);
  return /numero de serie|trae serie|serie atras|parte posterior|parte de atras|codigo de la parte de atras|codigo atras/.test(t);
}

function esPreguntaPlastificar(texto) {
  const t = normalizar(texto);
  return /plastific/.test(t);
}

function esPreguntaViajar(texto) {
  const t = normalizar(texto);
  return /para viajar|puedo viajar|viajar con (?:el|la|este|mi)/.test(t);
}

function esPreguntaSirveTramites(texto) {
  const t = normalizar(texto);
  return /sirve para (?:hacer )?tramite|sirve para gestiones|usarlo para tramites/.test(t);
}

function esPreguntaSeVeIgual(texto) {
  const t = normalizar(texto);
  return /se ve igual|identico al original|igual al original|igualito al original/.test(t);
}

function esPreguntaFotoDatos(texto) {
  const t = normalizar(texto);
  return /tiene foto|trae foto|foto y datos|datos correctos|sale mi foto/.test(t);
}

function esPreguntaVigente(texto) {
  const t = normalizar(texto);
  return /esta vigente|vigente y activa|cedula activa|esta activa|la vigencia/.test(t);
}

function esPreguntaDiferenciaMotivos(texto) {
  const t = normalizar(texto);
  return /diferencia (?:hay )?entre|cual es la diferencia|renovacion o duplicado|extravio o hurto|que tipo de duplicado/.test(t);
}

function esPreguntaVencido(texto) {
  const t = normalizar(texto);
  return /esta vencid|se me vencio|mi cedula vencid|documento vencid|vencio mi/.test(t);
}

function esPreguntaTiempoRecibo(texto) {
  const t = normalizar(texto);
  return /cuando lo recibo|en cuanto tiempo lo recibo|me lo entregan cuando|cuando lo tengo/.test(t);
}

function esPreguntaEnvioCasa(texto) {
  const t = normalizar(texto);
  return /a mi casa|envio a domicilio|entrega a domicilio|me lo llevan/.test(t);
}

function esPreguntaComoLlega(texto) {
  const t = normalizar(texto);
  return /como me llega|como me lo envian|como llega|como lo recibo|como me lo hacen llegar/.test(t);
}

function esPreguntaFisicoDigital(texto) {
  const t = normalizar(texto);
  return (
    /fisico o digital|fisico o pdf|es fisico|digital o pdf|entregan fisico/.test(t) ||
    /entregan? (?:los? )?documentos? (?:en )?fisico|lo (?:entregan|entrega|hacen) (?:en )?fisico|entrega fisica|entrega en fisico|lo entregan personal|en persona/.test(
      t
    )
  );
}

function esPreguntaOtroPais(texto) {
  const t = normalizar(texto);
  return /otro pais|cualquier pais|todo el mundo/.test(t);
}

function esPreguntaPagarAntes(texto) {
  const t = normalizar(texto);
  return /pagar antes|por adelantado|antes de ver el documento|pagar sin ver|pagar primero/.test(t);
}

function esPreguntaNoMeGusta(texto) {
  const t = normalizar(texto);
  return /(?:que pasa )?si no me gusta|no me gusta el resultado|no quedo satisfech|quedo mal hecho/.test(t);
}

function esPreguntaDevolucion(texto) {
  const t = normalizar(texto);
  return /me devuelven|devolucion|reembolso|dinero de vuelta|garantia/.test(t);
}

function esPreguntaHablarAlguien(texto) {
  const t = normalizar(texto);
  return /hablar con alguien|hablar con una persona|alguien que me atienda|hablar con ustedes/.test(t);
}

function esPreguntaDatosPersonales(texto) {
  const t = normalizar(texto);
  return /tengo que enviar (?:mis )?datos|debo enviar (?:mis )?datos|enviar mis datos|que datos (?:piden|necesitan|piden ustedes)/.test(t);
}

function esPreguntaSeguroEnviar(texto) {
  const t = normalizar(texto);
  return /es seguro enviar|es seguro dar|seguro enviar (?:mis|los)/.test(t);
}

function esPreguntaExtranjero(texto) {
  const t = normalizar(texto);
  return /extranjero|fuera de venezuela|vivo afuera|estoy afuera|desde afuera|estoy en otro pais/.test(t);
}

function esPreguntaDocsNo(texto) {
  const t = normalizar(texto);
  return /no realizan|no hacen|no gestionan|que documentos no|documentos que no|no tramitan|no pueden hacer/.test(t);
}

function esPreguntaConsultarCedula(texto) {
  const t = normalizar(texto);
  return /consultar mi cedula|puedo consultar|verificar mi cedula|consultar primero|verificar primero|revisar mi cedula|consultar la cedula primero/.test(t);
}

function esPreguntaPapelImpresion(texto) {
  const t = normalizar(texto);
  return /en que papel|que papel (?:se usa|usamos|debo usar|es|recomiendan)|papel de impresion|tipo de papel|papel opalina|que es opalina|cartulina|en que tamano|que tamano/.test(t);
}

// ============================================================
// RESPUESTAS FIJAS: UNA PREGUNTA = UNA RESPUESTA
// ============================================================

function respuestaFAQ(texto) {
  if (esPreguntaNombre(texto))
    return "Soy Anderson Díaz, tu asistente virtual 😊 ¿Qué trámite necesitas?";

  if (esPreguntaLlamada(texto))
    return "En este momento la solicitud o atención se hace por audio o por texto.";

  if (esPreguntaConsultarCedula(texto))
    return "¡Sí! Con gusto te ayudamos a verificar tu información. Solo coloca tu número de cédula aquí y lo revisamos por ti. ✅";

  if (esPreguntaSerie(texto))
    return "Sí, el documento cuenta con todos los elementos de identificación correspondientes, incluyendo número de serie y demás detalles que lo identifican. ✅";

  if (esPreguntaVigente(texto))
    return "La cédula se emite con tus datos actualizados según tu información registrada. Puedes verificarla tú mismo con el número de cédula antes de confirmar. ✅";

  if (esPreguntaDiferenciaMotivos(texto))
    return "✅ Renovación: Cuando tu documento está vencido o necesitas actualizar tus datos\n✅ Duplicado por Extravío: Cuando perdiste tu documento y no logras encontrarlo\n✅ Duplicado por Hurto: Cuando te robaron tu documento\n✅ Duplicado por Deterioro: Cuando tienes tu documento pero está dañado, roto o ilegible";

  if (esPreguntaVencido(texto))
    return "No hay problema, realizamos la renovación por ti. Solo necesitamos tus datos y nos encargamos de todo el proceso. ✅";

  if (esPreguntaTiempoRecibo(texto))
    return "Una vez listo y confirmado, por ti te lo enviamos de inmediato. Lo recibes en tu celular en formato PDF, listo para que lo guardes o lo imprimas cuando lo necesites. 📱";

  if (esPreguntaTiempo(texto))
    return "El trámite se completa en aproximadamente 30 a 40 minutos una vez que contamos con todos tus datos. Te avisamos en cuanto esté listo para que lo revises. ⏱️";

  if (esPreguntaEnvioCasa(texto))
    return "Te lo enviamos en formato digital PDF de alta calidad, así lo recibes al instante donde estés y puedes imprimirlo las veces que lo necesites. 📄";

  if (esPreguntaComoLlega(texto))
    return "Te lo enviamos por este medio en formato PDF. Es de muy alta calidad, así se ve perfecto al imprimirlo. ✅";

  if (esPreguntaFisicoDigital(texto))
    return "Lo siento amiga/o, pero esto es una plataforma virtual de trámites venezolanos, por lo tanto los documentos realizados se entregan por correo o WhatsApp, listo para imprimirlo y plastificarlo. 😊";

  if (esPreguntaPlastificar(texto))
    return "¡Claro que sí! Te lo entregamos en formato PDF de alta calidad, listo para imprimir y plastificar. Quedará igual que tu documento original. ✅";

  if (esPreguntaPapelImpresion(texto))
    return "El papel de impresión se llama OPALINA ✅ En este caso lo tienes fácil: la cédula ya viene con sus medidas.";

  if (esPreguntaViajar(texto))
    return "Sí, el documento cuenta con toda tu información oficial y tus datos actualizados, por lo que te sirve para tus trámites y gestiones personales. ✅";

  if (esPreguntaSirveTramites(texto))
    return "¡Por supuesto! Está diseñado precisamente para eso: para que puedas realizar tus gestiones cuando no tienes tu documento físico o necesitas renovarlo. ✅";

  if (esPreguntaSeVeIgual(texto))
    return "Sí, idéntico. Mismos datos, misma foto, mismos detalles. Cuando lo imprimas y lo plastifiques, no notarás ninguna diferencia. ✅";

  if (esPreguntaFotoDatos(texto))
    return "¡Por supuesto! Usamos tu foto y tus datos reales y verificados. Todo debe coincidir perfectamente. ✅";

  if (esPreguntaOriginal(texto))
    return "Es un documento con validez oficial, elaborado con los mismos datos y características que el documento original. Tiene toda la información correcta, tu foto, tus datos personales y se ve idéntico al que te entregaron originalmente. ✅";

  if (esPreguntaComoFunciona(texto))
    return "Es muy sencillo:\n📌 Paso 1 → Nos envías tus datos y nos confirmas qué trámite necesitas\n📌 Paso 2 → Realizamos todo el proceso por ti\n📌 Paso 3 → Te enviamos una muestra para que lo revises bien\n📌 Paso 4 → Si estás conforme, realizas el pago\n📌 Paso 5 → Recibes tu documento listo en formato PDF";

  if (esPreguntaFacil(texto))
    return "¡Muy fácil! Solo necesitas tu información básica y comunicarte con nosotros por este medio. Te guiamos en todo el proceso paso a paso. 😊";

  if (esPreguntaPorQueMedio(texto))
    return "Todo lo realizamos por este medio de comunicación, de forma virtual. No necesitas ir a ningún lado ni hacer filas. ✅";

  if (esPreguntaSalirCasa(texto))
    return "¡Para nada! Todo el trámite lo puedes hacer desde tu casa, tu trabajo o donde te encuentres. 🏠";

  if (esPreguntaPagarAntes(texto))
    return "¡Para nada! Primero te mostramos una muestra del documento, lo revisas con calma, verificas que todo esté correcto, y solo cuando estés totalmente conforme realizas el pago. Así de simple y seguro. ✅";

  if (esPreguntaNoMeGusta(texto))
    return "Trabajamos hasta que estés satisfecho. Si algo no está como debe ser, lo ajustamos sin problema. Tu tranquilidad es lo más importante. 😊";

  if (esPreguntaDevolucion(texto))
    return "Si no estás conforme con el resultado, no pagas. Así de simple. No hay riesgo para ti. ✅";

  if (esPreguntaHablarAlguien(texto))
    return "¡Claro que sí! Estamos aquí para atenderte. Cuéntanos cualquier duda que tengas, estamos para ayudarte. 😊";

  if (esPreguntaEstafadores(texto))
    return "Entendemos tu preocupación, lamentablemente hay personas que no cumplen bien. Por eso trabajamos con transparencia: te mostramos el documento antes de pagar, tú pagas solo cuando estés completamente conforme. Así tienes la seguridad de recibir lo que necesitas. ✅";

  if (esPreguntaEstafadoAntes(texto))
    return "Entendemos perfectamente. Por eso nuestro principio es claro: ves primero, pagas después. No te pedimos dinero por adelantado. Revisas todo con calma, y si te gusta, continuamos. Sin presión, sin riesgo. ✅";

  if (esPreguntaVerdadEstafa(texto) || esDesconfianza(texto))
    return "Porque tú ves el documento primero antes de pagar. No te pedimos dinero por adelantado. Revisas, verificas, y si estás conforme, continuamos. Así tú tienes el control en todo momento. ✅";

  if (esPreguntaQuienes(texto))
    return "Somos una plataforma 100% virtual especializada en gestión de trámites y documentos para venezolanos dentro y fuera del país. Contamos con personal capacitado y años de experiencia ayudando a personas de distintos países. 😊";

  if (esPreguntaOficinaFisica(texto))
    return "No, somos una plataforma 100% virtual. Esto nos permite atenderte estés donde estés, sin filas, sin viajes y sin perder tiempo. 💻";

  if (esPreguntaOficina(texto))
    return "Somos una plataforma virtual, por lo que no contamos con oficinas de atención al público. Todo nuestro servicio se realiza de forma remota, así puedes hacer tu trámite desde la comodidad de tu casa, sin moverte de donde estés. ✅";

  if (esPreguntaLegal(texto))
    return "Sí, totalmente. Trabajamos con transparencia y confidencialidad. Tu información está protegida y nunca es compartida con terceros. Nuestra prioridad es tu confianza y la calidad de nuestro servicio. 🔒";

  if (esPreguntaSeguroEnviar(texto))
    return "¡Totalmente! Tu información está protegida, nunca la compartimos con terceros ni la utilizamos para fines distintos a tu trámite. 🔒";

  if (esPreguntaDatosPersonales(texto))
    return "Sí, necesitamos tus datos reales para elaborar tu documento correctamente. Toda la información que compartes con nosotros es estrictamente confidencial y protegida. 🔒";

  if (esPreguntaSeguridad(texto))
    return "¡Totalmente! Tu información está protegida, nunca la compartimos con terceros ni la utilizamos para fines distintos a tu trámite. 🔒";

  if (esPreguntaExtranjero(texto))
    return "¡Por supuesto! De hecho, nuestro servicio está pensado especialmente para personas que están fuera de Venezuela y no pueden hacer el trámite presencialmente. Estés donde estés, te ayudamos. 🌍";

  if (esPreguntaOtroPais(texto))
    return "¡Por supuesto! Como es digital, te llega sin importar en qué parte del mundo te encuentres. Atendemos a personas en Colombia, Chile, Ecuador y todo el mundo. 🌍";

  if (esPreguntaPaises(texto))
    return "Atendemos a personas en Colombia, Chile, Ecuador y cualquier país del mundo. No importa dónde estés, te podemos ayudar. ✅";

  if (esPreguntaDocsNo(texto))
    return "No realizamos partidas de nacimiento, pasaportes, antecedentes penales de otros países, títulos universitarios ni documentos de vehículos. Si tienes alguna duda sobre otro tipo de trámite, pregúntanos con confianza. 😊";

  if (esPreguntaDocumentos(texto))
    return "Cédula de identidad, licencia de conducir y certificado de antecedentes penales.";

  if (esPreguntaMultiple(texto))
    return "Sí, puedes consultar varios trámites. Los revisamos uno por uno.";

  if (esPreguntaRequisitos(texto))
    return "Solo necesitamos que nos confirmes qué trámite necesitas y nos compartas tus datos personales. Te guiamos paso a paso, es muy sencillo. ✅";

  return null;
}

// ============================================================
// PRECIOS: DESACTIVADOS POR DEFECTO
// ============================================================

function respuestaPrecio(numero, texto) {
  if (!PRICE_QUOTES_ENABLED) {
    return "Para evitar darte una tarifa incorrecta, el precio no está habilitado en el asistente. Un asesor puede confirmarte el valor correspondiente a tu caso.";
  }

  const datos = datosPais(numero, texto);
  if (!datos) {
    // Guardar el trámite pendiente para poder responder cuando el cliente diga el país.
    const proc = detectarProcedimiento(texto);
    actualizarSesion(numero, {
      estado: "esperando_pais",
      ...(proc ? { procedimiento: proc } : {}),
    });
    return "Los precios varían según el país y el tipo de trámite que necesites. Dime en qué país te encuentras y qué documento necesitas, y con gusto te comparto el valor exacto. 😊";
  }

  const procedimiento = detectarProcedimiento(texto);
  const motivo = detectarMotivo(texto);
  const grado = detectarGrado(texto);

  if (/licencia/.test(normalizar(texto))) {
    if (!grado) {
      actualizarSesion(numero, { estado: "licencia_grado", procedimiento: "licencia" });
      return PREGUNTA_LICENCIA;
    }

    const valor = datos[`licencia${grado}`];
    return conMuestra(numero, `💰 Licencia Grado ${grado}°: ${precio(valor, datos.moneda)}.`);
  }

  if (/antecedente/.test(normalizar(texto))) {
    if (datos.antecedentes === null || datos.antecedentes === undefined) {
      return "El precio de antecedentes penales para Ecuador no está configurado. Si quieres, puedo comunicarte con un asesor.";
    }
    return conMuestra(numero, `💰 Antecedentes penales: ${precio(datos.antecedentes, datos.moneda)}.`);
  }

  if (/cedula|documento/.test(normalizar(texto))) {
    if (!motivo) {
      actualizarSesion(numero, { estado: "esperando_motivo", procedimiento: "cedula" });
      return "¿La cédula es por renovación/vencimiento, extravío, hurto o deterioro? (responde 1, 2, 3 o 4)";
    }

    return conMuestra(numero, `💰 Cédula por ${motivo}: ${precio(precioCedula(datos, motivo), datos.moneda)}.`);
  }

  if (procedimiento === "licencia" && !grado) {
    actualizarSesion(numero, { estado: "licencia_grado", procedimiento: "licencia" });
    return PREGUNTA_LICENCIA;
  }

  return "Dime qué documento necesitas y, si corresponde, el motivo o grado.";
}

// ============================================================
// MÉTODOS DE PAGO
// ============================================================

function respuestaPago(numero, texto) {
  return "🇨🇴 Colombia: Nequi, Bancolombia, transferencia\n🇨🇱 Chile: Transferencia bancaria, Caja Vecina\n🇪🇨 Ecuador: Banco Pichincha, transferencia\n\nPara otros países, nos avisas y buscamos la mejor opción para ti. 💳";
}

// ============================================================
// BLOQUEO LOCAL POR INSULTOS / ABUSO
// ============================================================

const PALABRAS_ABUSIVAS = [
  "hijo de puta",
  "hijueputa",
  "maricon",
  "marica",
  "malparido",
  "malparida",
  "imbecil",
  "idiota",
  "pendejo",
  "pendeja",
  "estupido",
  "estupida",
];

function detectarAbuso(texto) {
  const t = normalizar(texto);
  return PALABRAS_ABUSIVAS.some((p) => t.includes(p));
}

async function bloquearLocalmente(numero, texto) {
  bloqueados.add(numero);

  if (ADMIN_NOTIFICATIONS_ENABLED && ADMIN_NUMBERS.length && !esAdministrador(numero)) {
    for (const admin of ADMIN_NUMBERS) await enviar(
      admin,
      `🚫 BLOQUEO LOCAL DEL BOT\n\n📱 Cliente: +${numero}\n⚠️ Motivo: lenguaje abusivo/ofensivo.\n\nMensaje:\n${texto}`
    );
  }
}

// ============================================================
// WHATSAPP
// ============================================================

function dividirMensaje(texto, max = 3500) {
  const partes = [];
  let resto = String(texto || "");

  while (resto.length > max) {
    let corte = resto.lastIndexOf("\n", max);
    if (corte < 500) corte = resto.lastIndexOf(" ", max);
    if (corte < 1) corte = max;

    partes.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).trim();
  }

  if (resto) partes.push(resto);
  return partes.length ? partes : [""];
}

async function enviar(numero, texto) {
  const jid = jidDe(numero);
  if (!jid || !sock) {
    console.error("enviar: el bot todavía no está conectado a WhatsApp.");
    return false;
  }

  for (const parte of dividirMensaje(texto)) {
    // Se intenta dos veces: si falla puntualmente, el mensaje no se pierde.
    let enviado = false;
    for (let intento = 1; intento <= 2 && !enviado; intento++) {
      try {
        await sock.sendMessage(jid, { text: parte });
        enviado = true;
      } catch (e) {
        console.error(`Error enviando por WhatsApp (intento ${intento}/2):`, e.message);
        if (intento < 2) await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (!enviado) return false;
  }

  return true;
}

// Un único aviso al administrador en el primer mensaje de un cliente nuevo.
// El país que el cliente diga tiene prioridad sobre el prefijo telefónico.
async function avisarPrimerMensaje(numero, s, texto) {
  if (!ADMIN_NOTIFICATIONS_ENABLED || !ADMIN_NUMBERS.length || esAdministrador(numero)) return;
  const pais = detectarPaisTexto(texto) || s?.pais || detectarPaisTelefono(numero) || "Sin confirmar";
  const mensaje = `📩 ${s?.nombre || "Un cliente"} escribió por primera vez${pais === "Sin confirmar" ? " (país sin confirmar)" : ` desde ${pais}`}.`;
  for (const admin of ADMIN_NUMBERS) await enviar(admin, mensaje);
}

async function avisarAltaPrioridad(numero, s) {
  if (!ADMIN_NOTIFICATIONS_ENABLED) return;
  if (!ADMIN_NUMBERS.length || esAdministrador(numero)) {
    console.error("ADMIN_PHONE no está configurado.");
    return;
  }

  const nombre = s?.nombre || "No informado";
  const pais = s?.pais || "No informado";
  const procedimiento = s?.procedimiento || "No informado";
  const motivo = s?.motivo || "No informado";

  const mensaje = `🚨 SOLICITUD DE ALTA PRIORIDAD

📱 Cliente: +${numero}
👤 Nombre: ${nombre}
🌎 País: ${pais}
📌 Procedimiento: ${procedimiento}
📝 Motivo: ${motivo}

⭐ PRIORIDAD: ALTA

El cliente indicó que desea realizar el trámite.`;

  for (const admin of ADMIN_NUMBERS) await enviar(admin, mensaje);
}

async function avisarAsesor(numero, s, prioridad = "NORMAL") {
  if (!ADMIN_NOTIFICATIONS_ENABLED || !ADMIN_NUMBERS.length || esAdministrador(numero)) return;

  const mensaje = `📞 SOLICITUD DE ASESOR

📱 Cliente: +${numero}
👤 Nombre: ${s?.nombre || "No informado"}
🌎 País: ${s?.pais || "No informado"}
📌 Procedimiento: ${s?.procedimiento || "No informado"}
📝 Motivo: ${s?.motivo || "No informado"}
⭐ Prioridad: ${prioridad}${s?.referido ? `\n🎁 Recomendó a: ${s.referido} (aplicar descuento cuando ${s.referido} realice su trámite)` : ""}${s?.referidoPor ? `\n🙋 Llegó recomendado por: ${s.referidoPor} (aplicarle el descuento a quien lo recomendó)` : ""}`;

  for (const admin of ADMIN_NUMBERS) await enviar(admin, mensaje);
}

// ============================================================
// GROQ: SOLO COMO FALLBACK PARA PREGUNTAS NO CUBIERTAS
// ============================================================

// Avisa al administrador por WhatsApp cuando algo crítico falla.
// Máximo un aviso cada 15 minutos para no saturar al admin.
let ultimoAvisoError = 0;
async function avisarErrorAdmin(texto) {
  if (!ADMIN_NOTIFICATIONS_ENABLED || !ADMIN_NUMBERS.length) return;
  if (Date.now() - ultimoAvisoError < 15 * 60 * 1000) return;
  ultimoAvisoError = Date.now();
  const mensaje = `⚠️ *Alerta del bot:* ${String(texto).slice(0, 300)}`;
  for (const admin of ADMIN_NUMBERS) {
    try {
      await enviar(admin, mensaje);
    } catch {}
  }
}

const ETAPAS_GESTOR_YA_TOMO = new Set([
  "SOLICITÓ GESTOR",
  "ESPERA MUESTRA DEL GESTOR",
  "CONVERSACIÓN FINALIZADA",
]);

function solicitudYaTomadaPorGestor(numero) {
  const n = String(numero || "").replace(/\D/g, "");
  const c = clientes.get(n);
  return !!c && ETAPAS_GESTOR_YA_TOMO.has(c.etapa);
}

async function responderConIA(numero, texto) {
  if (!GROQ_API_KEY) return respuestaNoDisponible();

  const s = obtenerSesion(numero);

  const instruccionesVigentes = instruccionesAdminTexto();

  const system = `Eres Anderson Díaz, el asistente de atención de la plataforma. Si el cliente pregunta tu nombre o quién eres, preséntate como Anderson Díaz.

REGLA PRINCIPAL DE CONOCIMIENTO:
- Puedes entender preguntas escritas de cualquier manera y mantener una conversación natural.
- PERO SOLO PUEDES DAR INFORMACIÓN QUE ESTÉ RESPALDADA POR LAS INSTRUCCIONES VIGENTES DEL ADMINISTRADOR Y POR LOS DATOS OPERATIVOS DEL BOT QUE SE TE ENTREGAN EN ESTE MENSAJE.
- Las instrucciones son la fuente de verdad. No uses conocimiento general, memoria del modelo, suposiciones, internet ni información externa para completar respuestas.
- Puedes reformular, resumir o explicar con otras palabras algo que sí esté en las instrucciones, pero NO puedes agregar datos nuevos.
- Si la pregunta es sobre un trámite/servicio pero la respuesta exacta no está en las instrucciones, dilo claramente y ofrece comunicar al cliente con un asesor.
- Si la pregunta no tiene relación con los trámites o servicios configurados, responde EXACTAMENTE con este mensaje, sin agregar nada más: "Lo siento, pero solo atiendo gestiones de trámites y asesorías a venezolanos, está es una plataforma de trámites virtuales para venezolanos."
- Si la pregunta del cliente trata de alguno de los temas de la sección PREGUNTAS Y RESPUESTAS FRECUENTES OFICIALES, respóndela con esa información aunque esté escrita de otra forma. Nunca respondas que no entendiste si el tema está cubierto.
- Nunca inventes precios, requisitos, documentos, tiempos, oficinas, citas, procedimientos, disponibilidad o condiciones.
- Nunca conviertas una inferencia tuya en una instrucción del administrador.
- Si el cliente pide ver las opciones o el menú de trámites, O SI TÚ MISMO NECESITAS PREGUNTARLE QUÉ TRÁMITE QUIERE REALIZAR (por ejemplo responde "sí" a iniciar sin especificar cuál, o dice que quiere continuar/empezar sin decir el trámite), NUNCA redactes tu propia lista ni la parafrasees en un párrafo (ejemplo prohibido: "¿qué trámite necesitas realizar: renovación, duplicado por extravío..."). SIEMPRE usa EXACTAMENTE este texto, con este mismo formato de lista numerada con emojis, sin agregar ni quitar nada, sin poner "(grado 2°-5°)" ni cambiar ningún número o nombre:
1️⃣ Renovación de cédula
2️⃣ Duplicado por extravío
3️⃣ Duplicado por hurto
4️⃣ Duplicado por deterioro
5️⃣ Licencia de conducir
6️⃣ Antecedentes penales
7️⃣ Verifica tu C.I
- Si existe una instrucción específica del administrador que contradice una respuesta genérica, sigue la instrucción específica, siempre que no implique una acción insegura o ilegal.
- Los precios estructurados del sistema son datos exactos y no pueden ser modificados por la IA.
- Responde la pregunta concreta del cliente; no envíes todos los precios ni toda la información si no la pidió.
- Si el cliente pregunta de forma ambigua y faltan datos indispensables (por ejemplo, país o grado), pide únicamente ese dato.
- No inventes ni enumeres requisitos. Si las instrucciones dicen que los requisitos los informa un gestor, dilo así.
- NUNCA generes "pasos a seguir", listas de documentos, instrucciones de cómo agendar una cita, ni menciones oficinas o portales oficiales (ej. Registraduría). Eso siempre lo explica el gestor cuando contacte al cliente.
- Responde breve (ideal 3-4 líneas). Si el cliente pregunta cómo funciona el proceso, comparte el PROCESO OFICIAL tal cual.
- Interpreta prioritariamente el español venezolano, incluidos modismos, expresiones coloquiales y formas informales de preguntar. Identifica lo que el cliente quiere decir; si no está claro, pide una aclaración breve.
- Responde con un tono venezolano natural, cercano y respetuoso, sin forzar expresiones ni perder claridad. Mantén todas las restricciones del servicio: solo gestionamos documentos venezolanos. Respeta los mensajes que debas responder EXACTAMENTE.
- No afirmes que una copia es un documento oficial original ni que el servicio sustituye a una autoridad.
- No pidas contraseñas, códigos de seguridad, códigos 2FA ni datos bancarios sensibles.

DATOS OPERATIVOS ACTUALES:
País detectado: ${s?.pais || "desconocido"}
Procedimiento: ${s?.procedimiento || "no definido"}
Motivo: ${s?.motivo || "no definido"}
Saludo según la hora local del cliente en este momento: ${saludoPorHora(numero, texto)}
${solicitudYaTomadaPorGestor(numero) ? 'AVISO IMPORTANTE: este cliente YA TIENE UNA SOLICITUD TOMADA POR EL GESTOR (está en curso o ya finalizada). Si te hace preguntas por curiosidad o FAQ (ubicación, proceso, papel, tiempos, etc.), respóndelas normalmente con la información oficial, pero NUNCA le preguntes si desea iniciar el trámite, ni lo invites a comenzar, confirmar o continuar de nuevo. Su solicitud ya está siendo atendida, no hay nada que iniciar.' : ''}

PRECIOS OFICIALES CONFIGURADOS (datos exactos del sistema; puedes citarlos tal cual):
${JSON.stringify(PRECIOS_PAIS)}
Interpretación: "cedula" tiene precio POR MOTIVO: renovacion, extravio, hurto y deterioro. Cita el precio del motivo que el cliente indique. "licencia2" a "licencia5" son los grados 2° a 5°. "antecedentes" es el certificado de antecedentes penales. Si el país del cliente no está en la tabla, dile que un asesor le confirmará.

PROCESO OFICIAL DEL SERVICIO (información vigente; puedes compartirla tal cual):
Paso 1 → Nos envías tus datos y nos confirmas qué trámite necesitas
Paso 2 → Realizamos todo el proceso por ti
Paso 3 → Te enviamos una muestra para que lo revises bien
Paso 4 → Si estás conforme, realizas el pago
Paso 5 → Recibes tu documento listo en formato PDF

PREGUNTAS Y RESPUESTAS FRECUENTES OFICIALES (información vigente; úsala para responder de forma natural y breve):
- Quiénes somos: plataforma 100% virtual especializada en gestión de trámites y documentos para venezolanos dentro y fuera del país; personal capacitado y años de experiencia.
- Ubicación: no hay oficinas físicas de atención al público; todo el servicio es remoto, el cliente hace su trámite desde su casa, sin filas ni viajes.
- Legalidad y seguridad: trabajamos con transparencia y confidencialidad; la información del cliente está protegida y nunca se comparte con terceros.
- Confianza / anti-estafa: ves primero, pagas después; no se pide dinero por adelantado; el cliente revisa la muestra y paga solo cuando está conforme; si no está conforme, no paga; si algo no queda bien, se ajusta sin problema.
- Tiempo y entrega: el trámite se completa en aproximadamente 30 a 40 minutos una vez recibidos todos los datos; la entrega es inmediata al confirmarse: PDF digital de alta calidad por este medio, listo para imprimir y plastificar, sin importar el país donde esté el cliente.
- Entrega en físico: NO hay entrega física ni ningún otro tipo de entrega distinto a correo o WhatsApp (PDF digital); no existen alternativas que ofrecer ni "revisar opciones" porque no hay otra forma de entrega. Si el cliente pregunta si entregan los documentos en físico, responde EXACTAMENTE con este mensaje: "Lo siento amiga/o, pero esto es una plataforma virtual de trámites venezolanos, por lo tanto los documentos realizados se entregan por correo o WhatsApp, listo para imprimirlo y plastificarlo. 😊". Si después de eso el cliente dice que así no le sirve, que necesita algo físico o que se lo lleven, o que por eso no le interesa, NUNCA ofrezcas alternativas de entrega ni digas que puedes revisar otras opciones, ni ofrezcas contactarlo con un asesor por este motivo (no hay nada que resolver, la entrega es así). En ese caso despídete amablemente con un mensaje breve como: "Entiendo, con mucho gusto. Aquí estaremos cuando necesites tu documento. Que tengas [saludo según la hora local del cliente]. 😊" reemplazando [saludo según la hora local del cliente] por el saludo indicado arriba en DATOS OPERATIVOS ACTUALES.
- Papel de impresión: se llama OPALINA; la cédula ya viene con sus medidas.
- El documento: elaborado con los mismos datos y características que el documento original; incluye foto, datos personales y número de serie; se ve idéntico al original al imprimirlo y plastificarlo; sirve para los trámites y gestiones personales del cliente.
- Motivos de cédula: Renovación (documento vencido o actualizar datos); Duplicado por Extravío (documento perdido); Duplicado por Hurto (documento robado); Duplicado por Deterioro (documento dañado, roto o ilegible).
- Documentos que NO realizamos: partidas de nacimiento, pasaportes, antecedentes penales de otros países, títulos universitarios, documentos de vehículos.
- Países: Colombia, Chile, Ecuador y cualquier país del mundo; el servicio está pensado especialmente para venezolanos en el extranjero.
- País emisor del documento: solo gestionamos documentos venezolanos. Estar en Colombia, Chile o Ecuador, o ser venezolano, no significa que tramitemos cédulas emitidas por esos países. Si solicitan cédula colombiana, chilena o ecuatoriana, responde: "Bueno, te comento: solo gestionamos documentos venezolanos. Lo siento, no tramitamos cédulas colombianas, chilenas ni ecuatorianas."
- Métodos de pago: Colombia Nequi, Bancolombia o transferencia; Chile transferencia bancaria o Caja Vecina; Ecuador Banco Pichincha o transferencia; para otros países se coordina la mejor opción con el cliente.
- Requisitos para empezar: solo confirmar el trámite y compartir los datos personales; el detalle de los requisitos lo informa el gestor al contactar al cliente.
- Verificación de cédula: disponible; el cliente envía su número de cédula y se verifica en el sistema.

INSTRUCCIONES VIGENTES DEL ADMINISTRADOR:
${instruccionesVigentes}

IMPORTANTE:
Si las instrucciones anteriores no contienen la información necesaria para contestar, NO LA INVENTES. En ese caso responde EXACTAMENTE con este mensaje, sin agregar nada más: "Lo siento, pero solo atiendo gestiones de trámites y asesorías a venezolanos, está es una plataforma de trámites virtuales para venezolanos." Solo si la pregunta es sobre un trámite vigente pero falta un detalle, ofrece comunicarlo con un asesor.`;



  try {
    const r = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: GROQ_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: system + `\n\nINSTRUCCIONES VIGENTES DEL ADMINISTRADOR:\n${instruccionesAdminTexto()}\n` },
          ...(s?.historial || []).slice(-4).map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.text,
          })),
          { role: "user", content: texto },
        ],
        max_completion_tokens: 400,
        reasoning_effort: "low",
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 20000,
      }
    );

    const respuesta = r.data?.choices?.[0]?.message?.content?.trim() || "";
    return respuestaIAValida(respuesta) ? respuesta : respuestaNoDisponible();
  } catch (e) {
    console.error(
      "Error Groq:",
      e.response?.status,
      e.response?.data ? JSON.stringify(e.response.data) : e.message
    );
    return "No pude procesar esa pregunta en este momento. Si quieres, te comunico con un asesor.";
  }
}

// ============================================================
// CONSULTA DE CÉDULA
// ============================================================

function soloDigitos(v) {
  return String(v || "").replace(/\D/g, "");
}

function fechaNacimiento(data) {
  const nombres = [
    "fechanacimiento",
    "fechanac",
    "nacimiento",
    "birthdate",
    "dateofbirth",
    "dob",
    "fecha_de_nacimiento",
    "fecha_nacimiento",
  ];

  function buscar(obj) {
    if (!obj || typeof obj !== "object") return null;

    for (const [clave, valor] of Object.entries(obj)) {
      const k = normalizar(clave).replace(/[^a-z0-9]/g, "");

      if (
        nombres.includes(k) ||
        k.includes("nacimiento") ||
        k.includes("fechanac") ||
        k.includes("birthdate") ||
        k.includes("dateofbirth")
      ) {
        if (valor !== null && valor !== "") return valor;
      }

      const encontrado = buscar(valor);
      if (encontrado !== null) return encontrado;
    }

    return null;
  }

  return buscar(data);
}

function fechaTexto(v) {
  if (!v) return "No disponible";

  const s = String(v).trim();
  let d = new Date(s);

  if (Number.isNaN(d.getTime())) {
    const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (m) d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  }

  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleDateString("es-VE");
}

// Fecha y hora legibles (para "Fecha de consulta").
function fechaHoraTexto(v) {
  if (!v) return "No disponible";

  const d = new Date(v);

  return Number.isNaN(d.getTime())
    ? String(v)
    : d.toLocaleString("es-VE", {
        day: "numeric",
        month: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
}

function nombreCompleto(data) {
  return (
    [
      data?.primer_nombre,
      data?.segundo_nombre,
      data?.primer_apellido,
      data?.segundo_apellido,
    ]
      .filter(Boolean)
      .join(" ") ||
    data?.nombre_completo ||
    data?.nombre ||
    data?.full_name ||
    "No disponible"
  );
}

// Consulta GRATUITA de cédula (sin credenciales) usando la web pública de
// cedula.com.ve. Devuelve cédula, RIF y nombre completo.
async function consultarCedulaWeb(cedula, nacionalidad) {
  const nac = String(nacionalidad || "V").toUpperCase();
  try {
    const r = await axios.post(
      "https://cedula.com.ve/web/test.php",
      `vat=${encodeURIComponent(cedula)}&nacionalidad=${encodeURIComponent(nac)}`,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (compatible; BotTramites/1.0)",
        },
        timeout: 20000,
        validateStatus: () => true,
      }
    );

    if (r.status < 200 || r.status >= 300) {
      return { ok: false, mensaje: `La consulta respondió con HTTP ${r.status}.` };
    }

    const html = String(r.data || "");

    if (/No se encontr[oó]/i.test(html)) {
      return { ok: false, mensaje: "No se encontró la cédula en el sistema." };
    }

    const campos = {};
    const re =
      /<div class="col-md-6"><b>([^<]+)<\/b><\/div>\s*<div class="col-md-5">([^<]*)<\/div>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      campos[m[1].trim().toLowerCase()] = m[2].trim();
    }

    const nombre = campos["nombre"] || "";
    const rif = campos["r.i.f."] || campos["rif"] || "";
    const ced = campos["cedula"] || cedula;

    if (!nombre && !rif) {
      return { ok: false, mensaje: "La consulta no devolvió datos para esa cédula." };
    }

    return {
      ok: true,
      data: {
        nacionalidad: nac,
        cedula: ced,
        rif,
        nombre_completo: nombre,
        request_date: new Date().toLocaleString("es-VE"),
      },
    };
  } catch (e) {
    console.error("Error consulta cédula web:", e.message);
    return {
      ok: false,
      mensaje:
        e.code === "ECONNABORTED"
          ? "La consulta tardó demasiado en responder."
          : "No fue posible conectar con el servicio de consulta de cédula.",
    };
  }
}

// Traduce los códigos de error de la API oficial a mensajes claros.
function mensajeErrorCedula(codigo) {
  switch (String(codigo || "").trim().toUpperCase()) {
    case "RECORD_NOT_FOUND":
      return "No se encontró la cédula en el sistema.";
    case "MAX_NUM_REQUEST":
      return "Se alcanzó el límite de consultas por ahora. Intenta de nuevo más tarde.";
    case "INVALID_TOKEN":
      return "La API de cédula no está configurada correctamente.";
    case "URL_ERROR":
      return "La consulta tiene un formato inválido.";
    case "DB_ERROR":
      return "Hubo un error temporal en el sistema. Intenta de nuevo.";
    default:
      return codigo || "La API rechazó la consulta.";
  }
}

// Consulta con la API OFICIAL (trae fecha de nacimiento + datos electorales).
async function consultarCedulaOficial(cedula) {
  try {
    const r = await axios.get(CEDULA_API_URL, {
      params: {
        app_id: CEDULA_APP_ID,
        token: CEDULA_TOKEN,
        nacionalidad: CEDULA_NACIONALIDAD,
        cedula,
      },
      headers: { Accept: "application/json" },
      timeout: 15000,
      validateStatus: () => true,
    });

    console.log("API CÉDULA HTTP:", r.status);

    if (r.status < 200 || r.status >= 300) {
      return {
        ok: false,
        codigo: `HTTP_${r.status}`,
        mensaje: `La API respondió con HTTP ${r.status}.`,
      };
    }

    if (!r.data) {
      return { ok: false, codigo: "SIN_RESPUESTA", mensaje: "La API no devolvió respuesta." };
    }

    if (r.data.error === true) {
      const codigo = String(r.data.error_str || "").trim().toUpperCase();
      return { ok: false, codigo, mensaje: mensajeErrorCedula(codigo) };
    }

    if (!r.data.data || typeof r.data.data !== "object") {
      return {
        ok: false,
        codigo: "RECORD_NOT_FOUND",
        mensaje: "No se encontró la cédula en el sistema.",
      };
    }

    return { ok: true, data: r.data.data };
  } catch (e) {
    console.error("Error API cédula:", e.message);

    return {
      ok: false,
      codigo: e.code === "ECONNABORTED" ? "TIMEOUT" : "RED",
      mensaje:
        e.code === "ECONNABORTED"
          ? "La API tardó demasiado en responder."
          : "No fue posible conectar con la API de cédula.",
    };
  }
}

async function consultarCedula(cedula) {
  if (!/^\d{5,10}$/.test(cedula)) {
    return {
      ok: false,
      mensaje: "La cédula debe contener entre 5 y 10 dígitos.",
    };
  }

  let errorOficial = null;

  // 1) API OFICIAL (si hay credenciales): trae fecha de nacimiento y datos
  //    electorales completos (estado, municipio, parroquia, centro).
  if (CEDULA_APP_ID && CEDULA_TOKEN) {
    const oficial = await consultarCedulaOficial(cedula);
    if (oficial.ok) return oficial;
    errorOficial = oficial;
    console.warn(
      "API oficial de cédula sin resultado:",
      oficial.codigo || oficial.mensaje
    );
  }

  // 2) RESPALDO GRATUITO por la web pública (cédula, RIF, nombre y estado).
  const web = await consultarCedulaWeb(cedula, CEDULA_NACIONALIDAD);
  if (web.ok) return web;

  // 3) Si ambos fallan, se muestra el mensaje más claro posible.
  if (errorOficial && errorOficial.codigo === "RECORD_NOT_FOUND") {
    return { ok: false, mensaje: "No se encontró la cédula en el sistema." };
  }

  return {
    ok: false,
    mensaje:
      web.mensaje ||
      errorOficial?.mensaje ||
      "No se pudo consultar la cédula en este momento.",
  };
}

function respuestaCedula(data) {
  const cne = data.cne || {};
  const nacimiento =
    data.fecha_nacimiento ||
    data.fechaNacimiento ||
    data.fecha_nac ||
    data.nacimiento ||
    fechaNacimiento(data);

  return `✅ CONSULTA REALIZADA

🪪 Nacionalidad: ${data.nacionalidad || "No disponible"}
🪪 Cédula: ${data.cedula || "No disponible"}

📅 Fecha de nacimiento:
${nacimiento ? fechaTexto(nacimiento) : "No disponible"}

👤 Nombre completo:
${nombreCompleto(data)}

📄 RIF:
${data.rif || "No disponible"}

🗳️ INFORMACIÓN ELECTORAL
Estado: ${cne.estado || "No disponible"}
Municipio: ${cne.municipio || "No disponible"}
Parroquia: ${cne.parroquia || "No disponible"}
Centro electoral: ${cne.centro_electoral || "No disponible"}

📅 Fecha de consulta:
${fechaHoraTexto(data.request_date)}`;
}

// ============================================================
// RESPUESTA PRINCIPAL
// ============================================================

// Tras entregar el precio, se pregunta al cliente si desea una MUESTRA.
// Si responde SÍ, se le comunica con un gestor para que atienda su solicitud.
// Proceso oficial del servicio. El paso 7 (medio de pago) cambia según el país.
const PAGOS_PAIS = {
  Colombia: "Nequi",
  Chile: "transferencia bancaria o Caja Vecina",
  Ecuador: "Banco Pichincha",
};

function textoProceso(numero) {
  const datos = datosPais(numero);
  const medioPago = datos
    ? PAGOS_PAIS[datos.pais] || "te lo confirma el gestor"
    : "te lo confirmo cuando me digas tu país";

  return `📋 *Proceso:* nos envías los requisitos, validamos en el sistema que eres venezolano, se te realiza el trámite te enviamos una muestra del documento, verificas que esté correcto y cancelas, recibes el documento en PDF listo para imprimir y plastificar.
💳 *Pago:* ${medioPago}`;
}

function conMuestra(numero, textoPrecio) {
  actualizarSesion(numero, { estado: "confirmar_continuar" });
  registrarEtapaCliente(numero, "PIDIÓ PRECIO");
  return `${textoPrecio}

${textoProceso(numero)}

¿Deseas continuar? Responde *SÍ* o *NO*.`;
}

// Cotización a partir de los datos ya guardados en la sesión.
// Permite cerrar el ciclo: el bot pregunta país/motivo/grado y,
// cuando el cliente responde, entrega el precio de inmediato.
function cotizacion(numero, s) {
  if (!PRICE_QUOTES_ENABLED) {
    return "Un asesor puede confirmarte la información y tarifa correspondiente a tu caso.";
  }

  const datos = datosPais(numero);
  if (!datos) {
    actualizarSesion(numero, { estado: "esperando_pais" });
    return "Los precios varían según el país y el tipo de trámite que necesites. Dime en qué país te encuentras y qué documento necesitas, y con gusto te comparto el valor exacto. 😊";
  }

  const proc = s?.procedimiento;

  if (proc === "licencia") {
    if (!s?.grado) {
      actualizarSesion(numero, { estado: "licencia_grado", procedimiento: "licencia" });
      return PREGUNTA_LICENCIA;
    }
    return conMuestra(numero, `💰 Licencia Grado ${s.grado}°: ${precio(datos[`licencia${s.grado}`], datos.moneda)}.`);
  }

  if (proc === "antecedentes") {
    if (datos.antecedentes === null || datos.antecedentes === undefined) {
      return "El precio de antecedentes penales para Ecuador no está configurado. Si quieres, puedo comunicarte con un asesor.";
    }
    return conMuestra(numero, `💰 Antecedentes penales: ${precio(datos.antecedentes, datos.moneda)}.`);
  }

  if (proc === "cedula") {
    if (!s?.motivo) {
      actualizarSesion(numero, { estado: "esperando_motivo", procedimiento: "cedula" });
      return "¿La cédula es por renovación/vencimiento, extravío, hurto o deterioro? (responde 1, 2, 3 o 4)";
    }
    return conMuestra(numero, `💰 Cédula por ${s.motivo}: ${precio(precioCedula(datos, s.motivo), datos.moneda)}.`);
  }

  return "Dime qué documento necesitas (cédula, licencia o antecedentes) y te doy el precio.";
}

function esRespuestaSi(texto) {
  const t = normalizar(texto).replace(/[.!?,;:]+$/g, "").trim();
  return /^(si|si si quiero|si quiero|si claro|si estoy interesado|si estoy interesada|si mano|claro|dale|dale mi hermano|dale me gustaria|ok|okay|okey|esta bien|de acuerdo|vale|perfecto|genial|ya|confirmo|quiero|por supuesto)$/.test(
    t
  );
}

function esRespuestaNo(texto) {
  const t = normalizar(texto).replace(/[.!?,;:]+$/g, "").trim();
  return /^(no|no gracias|cancelar|cancelo|mejor no)$/.test(t);
}

// FILTRO DE SEGURIDAD: el bot NUNCA debe listar pasos, documentos, requisitos
// ni indicar cómo agendar citas. Eso corresponde siempre al gestor.
// Si la respuesta (venga de la IA o de cualquier otra fuente) contiene ese
// tipo de contenido, se descarta y se reemplaza por un mensaje corto y seguro.
const PATRONES_PROHIBIDOS = [
  /pasos a seguir/i,
  /re[uú]ne la documentaci[oó]n/i,
  /agenda(?:r)?\s+(?:una\s+)?cita/i,
  /registradur[ií]a/i,
  /portal (?:de|del) tr[aá]mite/i,
  /documentos? requeridos?/i,
  /lista de documentos/i,
  /requisitos son/i,
  /debes (?:llevar|presentar|entregar)/i,
  /(?:^|\n)\s*1[.)]\s.*(?:\n|\r).*(?:^|\n)\s*2[.)]\s/is,
];

function contieneContenidoProhibido(texto) {
  const t = String(texto || "");
  // El proceso oficial del servicio siempre puede enviarse (texto propio del bot).
  if (/validamos en el sistema|nos envias los requisitos|nos env[ií]as los requisitos/i.test(t)) {
    return false;
  }
  return PATRONES_PROHIBIDOS.some((re) => re.test(t));
}

function respuestaSeguraGestor() {
  return "Los pasos y requisitos exactos te los confirma directamente el gestor al contactarte. ¿Quieres que te comunique con uno?";
}

function respuestaNoDisponible() {
  return "Lo siento, pero solo atiendo gestiones de trámites y asesorías a venezolanos, está es una plataforma de trámites virtuales para venezolanos.";
}

function respuestaIAValida(texto) {
  const r = normalizar(texto);
  if (!r) return false;

  // Este filtro NO decide de qué puede hablar la IA por una lista de palabras.
  // Solo bloquea patrones que el código considera inseguros/no configurables.
  const prohibidas = [
    "códigos de seguridad",
    "codigo de seguridad",
    "códigos 2fa",
    "codigo 2fa",
    "contraseña",
    "contrasena",
  ];

  if (prohibidas.some((x) => r.includes(normalizar(x)))) return false;
  if (contieneContenidoProhibido(texto)) return false;
  return true;
}

async function responder(numero, texto, esAdmin = false) {
  const original = String(texto || "").trim();
  const t = normalizar(original);

  let s = obtenerSesion(numero);

  // Recuperar una conversación que quedó inactiva.
  const regreso = cerrarPorInactividad(numero);

  if (regreso) {
    s = obtenerSesion(numero);

    await enviar(
      numero,
      "No te preocupes. Conservamos el historial de esta conversación y podemos retomarla donde la dejamos."
    );
  }

  s = actualizarSesion(numero);

  // País explícito tiene prioridad.
  const paisTexto = detectarPaisTexto(original);
  if (paisTexto) {
    s = actualizarSesion(numero, { pais: paisTexto });
  } else if (!s.pais) {
    const paisTelefono = detectarPaisTelefono(numero);
    if (paisTelefono) s = actualizarSesion(numero, { pais: paisTelefono });
  }

  // Nombre del perfil lo agrega el webhook antes de llamar aquí.

  registrarHistorial(numero, "user", original);

  // ADMIN: el número administrador tiene un canal propio por WhatsApp.
  // Sus mensajes se interpretan como instrucciones y no como consultas de cliente.
  if (esAdmin) {
    return await procesarMensajeAdministrador(numero, original);
  }

  // Bloqueo local.
  if (bloqueados.has(numero)) return null;

  // Abuso.
  if (detectarAbuso(original)) {
    await bloquearLocalmente(numero, original);
    return null;
  }


  if (s.estado === "ofrecer_descuento") {
    if (esRespuestaSi(original)) {
      actualizarSesion(numero, { estado: "pedir_nombre_referido" });
      return "¡Genial! ¿Cuál es el nombre de la persona que nos recomiendas?";
    }

    if (esRespuestaNo(original)) {
      const previo =
        s.estadoPrevio === "confirmar_muestra" || s.estadoPrevio === "confirmar_continuar"
          ? s.estadoPrevio
          : null;
      actualizarSesion(numero, { estado: previo, estadoPrevio: null });

      if (previo === "confirmar_muestra") {
        return "Entendido. ¿Te interesaría ver una *MUESTRA* del documento para así corroborar que sí deseas realizar el trámite? Responde *SÍ* o *NO*.";
      }
      if (previo === "confirmar_continuar") {
        return "Entendido. ¿Deseas continuar con tu trámite? Responde *SÍ* o *NO*.";
      }
      return "Entendido, sin problema. Dime qué trámite necesitas y con gusto te atiendo. 😊";
    }
  }

  if (s.estado === "pedir_nombre_referido") {
    const nombreReferido = original.replace(/[.,;!?]+$/g, "").trim();

    if (!nombreReferido || nombreReferido.length > 60 || /^(no|no se|no sé)$/i.test(normalizar(nombreReferido))) {
      return "Escríbeme el nombre de la persona que nos recomiendas para dejarlo registrado.";
    }

    const previo =
      s.estadoPrevio === "confirmar_muestra" || s.estadoPrevio === "confirmar_continuar"
        ? s.estadoPrevio
        : null;
    actualizarSesion(numero, { estado: previo, estadoPrevio: null, referido: nombreReferido });
    registrarEtapaCliente(numero, "PIDIÓ DESCUENTO POR REFERIDO", { referido: nombreReferido });
    await avisarAsesor(numero, obtenerSesion(numero), "DESCUENTO");

    const cierre =
      previo === "confirmar_muestra"
        ? "¿Te interesaría ver una *MUESTRA* del documento para así corroborar que sí deseas realizar el trámite? Responde *SÍ* o *NO*."
        : previo === "confirmar_continuar"
          ? "¿Deseas continuar con tu trámite? Responde *SÍ* o *NO*."
          : "Dime qué trámite necesitas y con gusto continúo atendiéndote. 😊";

    return `¡Listo! Anoté que nos recomiendas a *${nombreReferido}*. El descuento te lo confirma el gestor cuando te atienda.\n\n${cierre}`;
  }

  // Confirmación de gestor: solo SÍ/NO cuando el bot la haya solicitado.
  if (s.estado === "confirmar_gestor") {
    if (esRespuestaSi(original)) {
      actualizarSesion(numero, { estado: null });
      registrarEtapaCliente(numero, "SOLICITÓ GESTOR");
      await avisarAsesor(numero, obtenerSesion(numero), "NORMAL");
      return "Perfecto. Ya envié tu solicitud a un gestor. 😊";
    }

    if (esRespuestaNo(original)) {
      actualizarSesion(numero, { estado: null });
      return "De acuerdo. No enviaré la solicitud al gestor.";
    }
  }

  // CONTINUAR: tras dar el precio se preguntó si el cliente desea continuar.
  if (s.estado === "confirmar_continuar") {
    if (esRespuestaSi(original)) {
      actualizarSesion(numero, { estado: "confirmar_muestra" });
      registrarEtapaCliente(numero, "CONFIRMÓ TRÁMITE");
      return "Perfecto. ¿Te interesaría ver una *MUESTRA* del documento para así corroborar que sí deseas realizar el trámite? Responde *SÍ* si deseas continuar, responde *NO* si no deseas continuar.";
    }

    if (esRespuestaNo(original)) {
      actualizarSesion(numero, { estado: null });
      registrarEtapaCliente(numero, "NO INTERESADO");
      return "De acuerdo. Si más adelante quieres continuar con el trámite, escríbeme por aquí. 😊";
    }
  }

  // MUESTRA: tras dar el precio se preguntó si el cliente desea una muestra.
  if (s.estado === "confirmar_muestra") {
    if (esRespuestaSi(original)) {
      actualizarSesion(numero, { estado: "cierre_pendiente" });
      registrarEtapaCliente(numero, "ESPERA MUESTRA DEL GESTOR");
      await avisarAsesor(numero, obtenerSesion(numero), "MUESTRA");
      return "En un minuto te comunico con un gestor para que atienda tu solicitud y te envié la *MUESTRA* CORRESPONDIENTE para tu confirmación. 😊";
    }

    if (esRespuestaNo(original)) {
      actualizarSesion(numero, { estado: null });
      registrarEtapaCliente(numero, "NO INTERESADO");
      return "De acuerdo. Si más adelante quieres ver la muestra o iniciar el trámite, escríbeme por aquí. 😊";
    }
  }

  // CIERRE EN DOS PASOS: tras avisar al gestor de la muestra, el cliente confirma
  // que está de acuerdo (paso 1) y luego confirma que se queda al pendiente (paso 2).
  // Ahí el bot avisa que la solicitud ya fue atendida por el gestor y cierra la
  // conversación. Cualquier otra cosa (una pregunta nueva) libera el estado y sigue
  // el flujo normal, respetando el historial ya conversado.
  if (s.estado === "cierre_pendiente") {
    if (esAcuerdoContinuidad(original)) {
      actualizarSesion(numero, { estado: "cierre_gestor_avisado" });
      registrarEtapaCliente(numero, "ESPERA MUESTRA DEL GESTOR");
      return "Si claro, en seguida te paso con el gestor, quien te enviará la muestra del documento para que la revises y confirmes. 😊";
    }

    actualizarSesion(numero, { estado: null });
  }

  if (s.estado === "cierre_gestor_avisado") {
    if (esAcuerdoContinuidad(original)) {
      actualizarSesion(numero, { estado: "post_cierre_atento" });
      registrarEtapaCliente(numero, "CONVERSACIÓN FINALIZADA");
      const saludo = saludoPorHora(numero, original);
      return `Solicitud atendida por el gestor, por favor estar al pendiente de cuando te escriban. Que tengas ${saludo}. 😊`;
    }

    actualizarSesion(numero, { estado: null });
  }

  // POST-CIERRE: la conversación ya se dio por finalizada, pero si el cliente
  // vuelve a escribir algo genérico (ok, hola, si, "una pregunta"...) el bot
  // se queda atento sin reabrir el menú. Si en cambio hace una pregunta real,
  // se libera el estado y se responde con las instrucciones/FAQ normales.
  if (s.estado === "post_cierre_atento") {
    if (esToqueAtencionPostCierre(original)) {
      return "¡Si claro! ¿En qué te puedo ayudar o qué necesitas? 😊";
    }

    actualizarSesion(numero, { estado: null });
  }

  // PAÍS pendiente: el bot preguntó el país y el cliente respondió.
  if (s.estado === "esperando_pais") {
    const paisResp = detectarPaisTexto(original);
    if (paisResp) {
      actualizarSesion(numero, { estado: null, pais: paisResp });
      return cotizacion(numero, obtenerSesion(numero));
    }
    const palabras = t.split(" ").length;
    if (palabras <= 4 && !t.includes("?")) {
      return "¿En qué país estás? Actualmente atendemos Colombia 🇨🇴, Chile 🇨🇱 y Ecuador 🇪🇨.";
    }
    // Cambió de tema: liberar el estado y seguir el flujo normal.
    actualizarSesion(numero, { estado: null });
  }

  // MOTIVO pendiente: el bot preguntó el motivo de la cédula y el cliente respondió.
  if (s.estado === "esperando_motivo") {
    let motivoResp = detectarMotivo(original);
    if (!motivoResp) {
      const mapaMotivo = { "1": "renovación", "2": "extravío", "3": "hurto", "4": "deterioro" };
      motivoResp = mapaMotivo[t];
    }
    if (motivoResp) {
      actualizarSesion(numero, { estado: null, procedimiento: "cedula", motivo: motivoResp });
      return cotizacion(numero, obtenerSesion(numero));
    }
    const palabras = t.split(" ").length;
    if (palabras <= 4 && !t.includes("?")) {
      return "¿La cédula es por renovación/vencimiento, extravío, hurto o deterioro? (responde 1, 2, 3 o 4)";
    }
    actualizarSesion(numero, { estado: null });
  }

  // Referido: el cliente menciona quién lo recomendó (para el descuento de esa persona).
  if (!s.referidoPor) {
    const nombreReferidoPor = detectarReferidoPor(original);
    if (nombreReferidoPor) {
      actualizarSesion(numero, { referidoPor: nombreReferidoPor });
      registrarEtapaCliente(numero, s.estado ? null : "LLEGÓ POR REFERIDO", { referidoPor: nombreReferidoPor });
      await avisarAsesor(numero, obtenerSesion(numero), "REFERIDO");
    }
  }

  // DESCUENTO: si el cliente pide rebaja o pregunta por "lo mínimo" en cualquier
  // momento, se le ofrece el descuento a cambio de recomendar a alguien.
  if (
    s.estado !== "ofrecer_descuento" &&
    s.estado !== "pedir_nombre_referido" &&
    esPreguntaDescuento(original)
  ) {
    actualizarSesion(numero, { estado: "ofrecer_descuento", estadoPrevio: s.estado || null });
    return "¡Claro que sí! Podemos hacerte un descuento si nos recomiendas con algún familiar o amigo que esté necesitando el servicio. ¿Nos recomiendas a alguien? Responde *SÍ* o *NO*.";
  }

  // Restricciones primero.
  const restriccion = respuestaRestriccion(original);
  if (restriccion) return restriccion;

  // Horario.
  if (esPreguntaHorario(original)) return estadoHorario(numero, original).texto;

  // Precio: se verifica ANTES de las FAQ para que nada lo intercepte.
  if (esPreguntaPrecio(original)) {
    return respuestaPrecio(numero, original);
  }

  // Pago: métodos de pago disponibles.
  if (esPreguntaPago(original)) {
    return respuestaPago(numero, original);
  }

  // Respuestas FAQ directas.
  const faq = respuestaFAQ(original);
  if (faq) return faq;

  // Objeción de precio: respuesta única y sin presión.
  if (esObjecionPrecio(original)) {
    return "Entiendo. En ese caso, como alternativa, tendrías que realizar el proceso personalmente por el canal oficial correspondiente. Que tengas un buen día. 😊";
  }

  // Menú.
  if (/^(menu|menú|opciones|inicio|volver|atras|atrás)$/.test(t)) {
    actualizarSesion(numero, { estado: null });
    return MENU;
  }

  // Saludos: cualquier mensaje que empiece con un saludo (con o sin texto
  // adicional, como "hola quiero mas informacion") o que sea un pedido
  // genérico de información, muestra el menú directamente.
  if (
    /^(hola+|ola+|buenos? d[ií]as?|buenas tardes|buenas noches|buenas|saludos|hey|que tal)\b/.test(t) ||
    /^(quiero|necesito|deseo|me gustaria|quisiera)?\s*(mas )?informaci[oó]n$/.test(t)
  ) {
    return MENU;
  }

  // Solicitud directa de realizar el trámite.
  if (esIntencionTramite(original)) {
    const procedimiento = detectarProcedimiento(original);
    const motivo = detectarMotivo(original);
    const grado = detectarGrado(original);

    actualizarSesion(numero, {
      procedimiento: procedimiento || s.procedimiento,
      motivo: motivo || s.motivo,
      grado: grado || s.grado,
    });

    await avisarAltaPrioridad(numero, obtenerSesion(numero));

    return "Perfecto. Ya registré tu solicitud y la envié a un gestor con prioridad alta. No necesitas repetir la información que ya me diste. 😊";
  }

  // Cédula: opción 7 o número directo.
  if (
    s.estado === "esperando_cedula" ||
    /^(?:[vVeE][\s.-]*)?\d[\d\s.-]{4,12}$/.test(original)
  ) {
    const cedula = soloDigitos(original);

    if (!/^\d{5,10}$/.test(cedula)) {
      actualizarSesion(numero, { estado: "esperando_cedula" });
      return "⚠️ Por favor escribe únicamente los números de tu cédula.";
    }

    const consulta = await consultarCedula(cedula);

    if (!consulta.ok) {
      actualizarSesion(numero, { estado: null });

      if (ADMIN_NOTIFICATIONS_ENABLED) {
        for (const admin of ADMIN_NUMBERS) {
          await enviar(
            admin,
            `🔍 CONSULTA DE CÉDULA\n\n📱 Cliente: +${numero}\n🪪 Cédula: ${cedula}\n⚠️ ${consulta.mensaje}`
          );
        }
      }

      return `⚠️ ${consulta.mensaje}`;
    }

    actualizarSesion(numero, { estado: null });

    return respuestaCedula(consulta.data);
  }

  if (s.estado === "licencia_grado") {
    let grado = detectarGrado(original);
    if (!grado && /^[2-5]$/.test(original.trim())) {
      grado = Number(original.trim());
    }

    if (!grado) {
      return PREGUNTA_LICENCIA;
    }

    actualizarSesion(numero, {
      estado: null,
      procedimiento: "licencia",
      grado,
    });

    if (!PRICE_QUOTES_ENABLED) {
      return `Licencia de conducir, grado ${grado}°. Un asesor puede confirmarte la información y tarifa correspondiente.`;
    }

    return cotizacion(numero, obtenerSesion(numero));
  }

  if (/^7$/.test(t)) {
    actualizarSesion(numero, { estado: "esperando_cedula" });
    return PEDIR_CEDULA;
  }

  // Licencia.
  if (/^5$/.test(t) || /licencia|licencias|licencia de conducir/.test(t)) {
    const grado = detectarGrado(original);

    if (!grado) {
      actualizarSesion(numero, {
        estado: "licencia_grado",
        procedimiento: "licencia",
      });

      return PREGUNTA_LICENCIA;
    }

    actualizarSesion(numero, {
      procedimiento: "licencia",
      grado,
    });

    if (!PRICE_QUOTES_ENABLED) {
      return `Licencia de conducir, grado ${grado}°. Un asesor puede confirmarte la información y tarifa correspondiente.`;
    }

    return cotizacion(numero, obtenerSesion(numero));
  }

  // Antecedentes.
  if (/^6$/.test(t) || /antecedente(s)?|record policial/.test(t)) {
    actualizarSesion(numero, {
      procedimiento: "antecedentes",
    });

    if (!PRICE_QUOTES_ENABLED) {
      return "Antecedentes penales. Un asesor puede confirmarte la información y tarifa correspondiente.";
    }

    return cotizacion(numero, obtenerSesion(numero));
  }

  // Cédula: si hay motivo, conservarlo; si no, pedir solamente el motivo.
  const procedimiento = detectarProcedimiento(original);
  const motivo = detectarMotivo(original);

  if (
    /^1$/.test(t) ||
    /^2$/.test(t) ||
    /^3$/.test(t) ||
    /^4$/.test(t) ||
    procedimiento === "cedula" ||
    ["renovación", "extravío", "hurto", "deterioro"].includes(procedimiento)
  ) {
    const mapa = {
      "1": "renovación",
      "2": "extravío",
      "3": "hurto",
      "4": "deterioro",
    };

    const motivoFinal = motivo || mapa[t] || s.motivo;

    actualizarSesion(numero, {
      procedimiento: "cedula",
      motivo: motivoFinal || null,
    });

    if (!motivoFinal) {
      actualizarSesion(numero, { estado: "esperando_motivo", procedimiento: "cedula" });
      return "¿La cédula es por renovación/vencimiento, extravío, hurto o deterioro? (responde 1, 2, 3 o 4)";
    }

    if (!PRICE_QUOTES_ENABLED) {
      return `Entendido: cédula por ${motivoFinal}. Un asesor puede orientarte sobre el trámite correspondiente.`;
    }

    return cotizacion(numero, obtenerSesion(numero));
  }

  // Asesor.
  if (/^8$/.test(t) || /asesor|persona real|humano/.test(t)) {
    actualizarSesion(numero, {
      estado: null,
      procedimiento: procedimiento || s.procedimiento,
      motivo: motivo || s.motivo,
    });

    registrarEtapaCliente(numero, "SOLICITÓ GESTOR");
    await avisarAsesor(numero, obtenerSesion(numero), "NORMAL");
    return "Claro. Ya envié tu solicitud a un asesor. 😊";
  }

  // FAQ.
  if (/^9$/.test(t)) {
    return "📋 Pregúntame directamente lo que necesitas y te responderé solo esa pregunta.";
  }

  // Preguntas abiertas: Groq solo si hace falta.
  const respuestaIA = await responderConIA(numero, original);
  return respuestaIA;
}

// ============================================================
// TRANSCRIPCIÓN DE NOTAS DE VOZ (Groq Whisper)
// ============================================================

async function transcribirAudio(msg) {
  if (!msg) return null;

  // 1. Descargar el audio recibido por WhatsApp (Baileys).
  let buffer;
  try {
    buffer = await downloadMediaMessage(
      msg,
      "buffer",
      {},
      { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage }
    );
  } catch (e) {
    console.error("Error descargando el audio:", e.message);
    return null;
  }
  if (!buffer) return null;

  // 2. Transcribir con Groq Whisper.
  try {
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: "audio/ogg" }), "audio.ogg");
    form.append("model", "whisper-large-v3");
    form.append("language", "es");
    form.append("response_format", "text");

    const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      body: form,
    });

    if (!r.ok) {
      const detalle = await r.text().catch(() => "");
      console.error("Groq Whisper respondió", r.status, detalle.slice(0, 300));
      return null;
    }

    const transcripcion = (await r.text()).trim();
    return transcripcion || null;
  } catch (e) {
    console.error("Error llamando a Groq Whisper:", e.message);
    return null;
  }
}

// ============================================================
// SEGUIMIENTO AUTOMÁTICO: 30 minutos por cliente
// Si el cliente pregunta y luego queda en silencio 30 minutos,
// el bot le escribe una vez para retomar la conversación.
// ============================================================

const SEGUIMIENTO_MINUTOS = 30;
const seguimientosPendientes = new Map();

function cancelarSeguimiento(numero) {
  const pendiente = seguimientosPendientes.get(numero);
  if (pendiente) {
    clearTimeout(pendiente.timer);
    seguimientosPendientes.delete(numero);
  }
}

function programarSeguimiento(numero) {
  cancelarSeguimiento(numero);

  const timer = setTimeout(async () => {
    seguimientosPendientes.delete(numero);
    try {
      await enviar(
        numero,
        "¡Hola! 😊 Sigo aquí para ayudarte con tu trámite. ¿Quieres que continuemos? Si quieres ver las opciones, escribe *menú*."
      );
      console.log("⏰ Seguimiento automático enviado a +" + numero);
    } catch (e) {
      console.error("Error enviando seguimiento:", e.message);
    }
  }, SEGUIMIENTO_MINUTOS * 60 * 1000);

  seguimientosPendientes.set(numero, { timer });
}

// ============================================================
// WEBHOOK POST
// ============================================================

// (El manejo de mensajes ahora lo hace Baileys: ver 'CONEXIÓN BAILEYS'.)

// ============================================================
// VERIFICACIÓN WEBHOOK META
// ============================================================

// ============================================================
// CONEXIÓN BAILEYS — WhatsApp por CÓDIGO QR (sin API de Meta)
// ============================================================

let sock = null;
let qrActual = null;
let estadoConexion = "iniciando";
let reconectando = false;
let intentosReconexion = 0;
let ultimaConexion = null; // timestamp de la última vez que quedó conectado
let ultimoMensajeRecibido = null; // timestamp del último mensaje entrante
let iniciando = false; // evita arranques simultáneos de Baileys
let pairingCodeActual = null; // código de vinculación por número (8 dígitos)
let pairingCodeSolicitado = false; // evita pedir el código varias veces por intento

// Mapa: número detectado -> JID real de WhatsApp del contacto.
// WhatsApp ahora usa JIDs "@lid" (identificadores de privacidad) en lugar de
// "@s.whatsapp.net". Para responder hay que usar EXACTAMENTE el JID de origen.
const jidPorNumero = new Map();

// ------------------------------------------------------------
// Respaldo de la SESIÓN de WhatsApp (carpeta auth_baileys) en Supabase.
// Sirve para que, si el servidor se reinicia o se vuelve a desplegar en un
// host sin disco persistente (p. ej. Render plan gratis), el bot recupere la
// sesión y NO haya que volver a escanear el QR.
// Requiere una tabla en Supabase:
//   create table if not exists baileys_auth (
//     id text primary key,
//     value text,
//     updated_at timestamptz default now()
//   );
// Si Supabase no está configurado, todo esto se ignora sin afectar al bot.
// ------------------------------------------------------------
const AUTH_BACKUP_TABLE = "baileys_auth";

async function respaldarSesionSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    if (!fs.existsSync(AUTH_DIR)) return;
    const archivos = fs.readdirSync(AUTH_DIR).filter((f) => f.endsWith(".json"));
    if (!archivos.length) return;
    const filas = archivos.map((f) => ({
      id: f,
      value: fs.readFileSync(path.join(AUTH_DIR, f), "utf-8"),
      updated_at: new Date().toISOString(),
    }));
    await axios.post(`${SUPABASE_URL}/rest/v1/${AUTH_BACKUP_TABLE}`, filas, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
    });
  } catch (e) {
    console.error("No se pudo respaldar la sesión en Supabase:", e.message);
  }
}

async function restaurarSesionSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    // Si ya hay una sesión local, no se toca.
    if (fs.existsSync(AUTH_DIR) && fs.readdirSync(AUTH_DIR).some((f) => f.endsWith(".json"))) {
      return;
    }
    const { data } = await axios.get(
      `${SUPABASE_URL}/rest/v1/${AUTH_BACKUP_TABLE}?select=id,value`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!Array.isArray(data) || !data.length) return;
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    for (const fila of data) {
      if (!fila?.id || typeof fila.value !== "string") continue;
      fs.writeFileSync(path.join(AUTH_DIR, fila.id), fila.value);
    }
    console.log(`🔑 Sesión de WhatsApp restaurada desde Supabase (${data.length} archivos).`);
  } catch (e) {
    console.error("No se pudo restaurar la sesión desde Supabase:", e.message);
  }
}

// Borra la sesión local para forzar un QR nuevo (se usa tras un logout real).
function borrarSesionLocal() {
  try {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    console.log("🧹 Sesión local borrada; se generará un QR nuevo para volver a vincular.");
  } catch (e) {
    console.error("No se pudo borrar la sesión local:", e.message);
  }
}

// Borra el respaldo de la sesión en Supabase (se usa tras un logout real, para
// no restaurar una sesión ya caducada en el siguiente reinicio).
async function borrarRespaldoSesionSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await axios.delete(`${SUPABASE_URL}/rest/v1/${AUTH_BACKUP_TABLE}?id=not.is.null`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    console.log("🧹 Respaldo de sesión en Supabase borrado.");
  } catch (e) {
    console.error("No se pudo borrar el respaldo de sesión en Supabase:", e.message);
  }
}

// Convierte un número (solo dígitos) en un JID de WhatsApp.
// Si ya conocemos el JID real del contacto (p. ej. "@lid"), se usa ese.
function jidDe(numero) {
  const n = String(numero || "").replace(/\D/g, "");
  if (!n) return null;
  if (jidPorNumero.has(n)) return jidPorNumero.get(n);
  return `${n}@s.whatsapp.net`;
}

// Extrae el número (solo dígitos) de un JID.
function numeroDeJid(jid) {
  return String(jid || "").split("@")[0].split(":")[0].replace(/\D/g, "");
}

// Caché en memoria para los reintentos de descifrado de Baileys.
// Evita que un mensaje se pierda si WhatsApp pide reenviarlo (reintento).
function crearCacheReintentos() {
  const store = new Map();
  return {
    get: (key) => store.get(key),
    set: (key, value) => {
      store.set(key, value);
    },
    del: (key) => {
      store.delete(key);
    },
    flushAll: () => store.clear(),
  };
}

// Programa una reconexión con backoff exponencial. NUNCA se rinde: el bot
// vuelve a intentarlo hasta recuperar la conexión. Así no se queda "muerto".
// Pide a WhatsApp un código de 8 dígitos para vincular el dispositivo usando
// el número de teléfono (opción "Vincular con el número del teléfono").
// Es el método más confiable: no depende de la cámara ni de escanear a tiempo.
async function solicitarCodigoVinculacion() {
  if (!PAIRING_PHONE) {
    return { ok: false, error: "Falta configurar PAIRING_PHONE (o ADMIN_PHONE)." };
  }
  if (!sock) {
    return { ok: false, error: "La conexión aún no está lista. Espera unos segundos." };
  }
  try {
    if (sock.authState?.creds?.registered) {
      return { ok: false, error: "El bot ya está vinculado." };
    }
  } catch (_) {}
  try {
    const codigo = await sock.requestPairingCode(PAIRING_PHONE);
    pairingCodeActual = codigo;
    console.log(
      `\n🔑 Código de vinculación por número: ${codigo}\n` +
        `   WhatsApp → Ajustes → Dispositivos vinculados → Vincular con el número del teléfono\n`
    );
    return { ok: true, codigo };
  } catch (e) {
    console.error("No se pudo generar el código de vinculación:", e.message);
    return { ok: false, error: e.message };
  }
}

function programarReconexion(motivo = "") {
  if (reconectando) return;
  reconectando = true;
  intentosReconexion += 1;
  // Backoff: 5s, 10s, 20s, 40s, 80s, 160s… máximo 5 minutos.
  const espera = Math.min(5000 * Math.pow(2, intentosReconexion - 1), 5 * 60 * 1000);
  console.log(
    `⚠️ ${motivo || "Conexión cerrada"}. Reintentando en ${Math.round(espera / 1000)}s (intento ${intentosReconexion})…`
  );
  setTimeout(() => {
    reconectando = false;
    iniciarBaileys().catch((e) => {
      console.error("Error al reconectar:", e.message);
      programarReconexion("Falló el arranque de Baileys");
    });
  }, espera);
}

async function iniciarBaileys() {
  if (iniciando) return;
  iniciando = true;
  try {
    // Cada intento de conexión empieza limpio: sin QR viejo ni código previo.
    qrActual = null;
    pairingCodeActual = null;
    pairingCodeSolicitado = false;
    // Versión de Baileys: si la consulta a la red falla, se usa la incluida
    // en el paquete (no se cae el arranque por esto).
    let version;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch (e) {
      console.error("No se pudo obtener la última versión de Baileys:", e.message);
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    // Caché de claves de señal: mejora estabilidad y rendimiento de la sesión.
    // Si la versión de Baileys no expone el helper, se usa el almacén normal.
    const signalKeyStore =
      typeof makeCacheableSignalKeyStore === "function"
        ? makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }))
        : state.keys;

    sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: { creds: state.creds, keys: signalKeyStore },
      logger: pino({ level: "silent" }),
      printQRInTerminal: false,
      // Navegador estándar reconocido por WhatsApp: máxima compatibilidad con
      // el código de vinculación por número y con el QR (evita rechazos).
      browser: Browsers.ubuntu("Chrome"),
      syncFullHistory: false,
      markOnlineOnConnect: false,
      // Mantiene viva la conexión y evita cortes silenciosos.
      keepAliveIntervalMs: 30000,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      retryRequestDelayMs: 2000,
      // Reintentos de descifrado: evita perder mensajes si falla la desencriptación.
      msgRetryCounterCache: crearCacheReintentos(),
      // Permite a Baileys re-solicitar un mensaje que no pudo descifrar.
      getMessage: async () => undefined,
    });

    // Guarda credenciales y, además, las respalda en Supabase (si está activo).
    sock.ev.on("creds.update", async () => {
      try {
        await saveCreds();
      } catch (e) {
        console.error("No se pudieron guardar las credenciales:", e.message);
      }
      respaldarSesionSupabase().catch(() => {});
    });

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrActual = qr;
        estadoConexion = "esperando_qr";
        console.log(`\n📱 Escanea el código QR en: http://localhost:${PORT}/qr`);
        console.log(`🔑 O vincula con el código por número en: http://localhost:${PORT}/pair\n`);
        // Pide el código de vinculación por número UNA vez por intento
        // (opción "Vincular con el número del teléfono"). Es más confiable
        // que el QR porque no depende de la cámara ni de escanear a tiempo.
        if (PAIRING_PHONE && !pairingCodeSolicitado) {
          pairingCodeSolicitado = true;
          solicitarCodigoVinculacion().catch(() => {});
        }
      }

      if (connection === "open") {
        qrActual = null;
        pairingCodeActual = null;
        reconectando = false;
        intentosReconexion = 0;
        estadoConexion = "conectado";
        ultimaConexion = Date.now();
        console.log("✅ Bot conectado a WhatsApp. Listo para responder.");
        respaldarSesionSupabase().catch(() => {});
      }

      if (connection === "close") {
        estadoConexion = "desconectado";
        // Limpia el QR y el código viejos: así la página NUNCA muestra un
        // código ya expirado (causa del error "No se pudo vincular").
        qrActual = null;
        pairingCodeActual = null;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const motivo = lastDisconnect?.error?.message || "";

        // Logout real: WhatsApp desvinculó el dispositivo. Se borra la sesión
        // y se arranca de nuevo para mostrar un QR NUEVO automáticamente.
        if (statusCode === DisconnectReason.loggedOut) {
          console.log(
            "⚠️ La sesión se cerró (logout). Se generará un QR nuevo para volver a vincular."
          );
          borrarSesionLocal();
          setTimeout(() => {
            iniciarBaileys().catch((e) => {
              console.error("Error al reiniciar tras logout:", e.message);
              programarReconexion("Reinicio tras logout");
            });
          }, 3000);
          return;
        }

        // Expiración del QR/código (408): NO es un error, solo que nadie lo
        // usó a tiempo. Se reinicia el contador y se reconecta en 2s para
        // ofrecer un QR/código NUEVO de inmediato (sin esperas largas).
        if (statusCode === DisconnectReason.timedOut) {
          intentosReconexion = 0;
          reconectando = true;
          console.log("⏳ El QR/código expiró sin usarse. Generando uno nuevo en 2s…");
          setTimeout(() => {
            reconectando = false;
            iniciarBaileys().catch((e) => {
              console.error("Error al regenerar tras expiración:", e.message);
              programarReconexion("Falló el arranque tras expiración");
            });
          }, 2000);
          return;
        }

        // Cualquier otro cierre (red, reinicio requerido, etc.): reconectar.
        programarReconexion(
          `Conexión cerrada${statusCode ? ` (código ${statusCode})` : ""}${motivo ? `: ${motivo}` : ""}`
        );
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const msg of messages) {
        try {
          ultimoMensajeRecibido = Date.now();
          await procesarMensajeEntrante(msg);
        } catch (e) {
          console.error("Error procesando mensaje:", e);
          await avisarErrorAdmin(`Error procesando un mensaje: ${e.message}`);
        }
      }
    });
  } finally {
    iniciando = false;
  }
}

// Procesa un mensaje entrante de WhatsApp (equivalente al antiguo webhook).
async function procesarMensajeEntrante(msg) {
  try {
    const _jid = msg?.key?.remoteJid || "?";
    const _txt =
      msg?.message?.conversation ||
      msg?.message?.extendedTextMessage?.text ||
      (msg?.message?.audioMessage ? "[audio]" : "(sin texto)");
    console.log(`📥 Mensaje de ${_jid}: ${_txt}`);
  } catch (_) {}
  if (!msg?.message) return;
  if (msg.key?.fromMe) return;

  const jid = msg.key?.remoteJid || "";
  if (jid.endsWith("@g.us")) return; // ignorar grupos
  if (jid === "status@broadcast") return; // ignorar estados

  // WhatsApp puede identificar al contacto con un JID "@lid" (identificador de
  // privacidad) en lugar de "@s.whatsapp.net". El número de teléfono real viene
  // en senderPn / remoteJidAlt. Se usa ese para reconocer al administrador,
  // detectar el país y mostrar el contacto; pero SIEMPRE se responde al JID de
  // origen (el "@lid" o el "@s.whatsapp.net" que envió el mensaje).
  const jidTelefono = msg.key?.senderPn || msg.key?.remoteJidAlt || "";
  const numero = numeroDeJid(jidTelefono) || numeroDeJid(jid);
  if (!numero) return;

  // Guardamos el JID real del contacto para poder responderle correctamente
  // (soporta tanto "@s.whatsapp.net" como el nuevo formato "@lid").
  jidPorNumero.set(numero, jid);

  // Meta/WhatsApp a veces reenvía el mismo mensaje: se ignora el duplicado.
  const msgId = msg.key?.id;
  if (msgId) {
    if (mensajesProcesados.has(msgId)) return;
    mensajesProcesados.set(msgId, Date.now());
  }

  const m = msg.message;

  // Texto directo (texto, texto extendido, o pie de foto/video).
  const textoDirecto =
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    "";
  let texto = String(textoDirecto || "").trim();

  // Notas de voz: se transcriben y se procesan como texto.
  const esAudio = !!(m.audioMessage || m.voiceMessage);
  if (esAudio) {
    if (esAdministrador(numero)) return;

    const transcripcion = await transcribirAudio(msg);
    if (!transcripcion) {
      await enviar(
        numero,
        "No pude escuchar tu audio 🙈 Escríbeme tu consulta por texto y te respondo al instante."
      );
      return;
    }
    texto = transcripcion;
  } else if (!texto) {
    if (esAdministrador(numero)) return;
    await enviar(
      numero,
      "Solo puedo atenderte por texto o nota de voz 🙏 Escríbeme tu consulta y te respondo al instante."
    );
    return;
  }

  if (!texto) return;

  const esAdmin = esAdministrador(numero);

  // El cliente volvió a escribir: se reinicia su seguimiento.
  if (!esAdmin) cancelarSeguimiento(numero);

  // Nombre del perfil de WhatsApp.
  const nombrePerfil = msg.pushName || "";

  if (!esAdmin) {
    const s = obtenerSesion(numero) || crearSesion(numero);

    if (!s.nombre && nombrePerfil) {
      s.nombre = nombrePerfil;
      sesiones.set(numero, s);
    }

    // PRIMERA INTERACCIÓN:
    // Si el cliente ya hizo una pregunta, se procesa directamente.
    const primeraInteraccion = !s.historial || s.historial.length === 0;

    if (primeraInteraccion) {
      const pais = detectarPaisTexto(texto);
      if (pais) s.pais = pais;
      else if (!s.pais) s.pais = detectarPaisTelefono(numero);

      if (!clientes.has(numero)) {
        registrarEtapaCliente(numero, "NUEVO");
        await avisarPrimerMensaje(numero, s, texto);
      }
    }
  }

  let respuesta = await responder(numero, texto, esAdmin);

  if (respuesta && !esAdmin && contieneContenidoProhibido(respuesta)) {
    console.warn(
      "Respuesta bloqueada por contener pasos/requisitos/documentación:",
      respuesta.slice(0, 200)
    );
    respuesta = respuestaSeguraGestor();
  }

  if (respuesta) {
    await enviar(numero, respuesta);
    if (!esAdmin) registrarHistorial(numero, "assistant", respuesta);
  }

  // Seguimiento automático: 30 minutos de silencio tras una consulta real.
  if (!esAdmin) {
    const soloMenuOSaludo =
      /^(hola|holaa|buenas|buenos dias|buen dia|buenas tardes|buenas noches|saludos|hey|menu|menú|opciones|inicio|volver|atras|atrás)$/i.test(
        texto
      );
    if (!soloMenuOSaludo) programarSeguimiento(numero);
  }
}

// ============================================================
// SALUD DEL SERVIDOR + PÁGINA DEL QR
// ============================================================

app.get("/", (req, res) => {
  res.status(200).json({
    ok: true,
    bot: "WhatsApp (Baileys, conexión por QR)",
    status: estadoConexion,
    model: GROQ_MODEL,
    priceQuotesEnabled: PRICE_QUOTES_ENABLED,
    adminConfigured: ADMIN_NUMBERS.length > 0,
    cedulaConsultaConfigured: Boolean(CEDULA_APP_ID && CEDULA_TOKEN),
    activeAdminInstructions: instruccionesAdministrador.length,
    requirementsByGestorOnly: true,
    // --- Diagnóstico de conexión (útil para saber por qué "no responde") ---
    intentosReconexion,
    reconectando,
    ultimaConexion: ultimaConexion ? new Date(ultimaConexion).toISOString() : null,
    ultimoMensajeRecibido: ultimoMensajeRecibido
      ? new Date(ultimoMensajeRecibido).toISOString()
      : null,
    sesionGuardada: fs.existsSync(AUTH_DIR) && fs.readdirSync(AUTH_DIR).some((f) => f.endsWith(".json")),
    uptimeSegundos: Math.round(process.uptime()),
    time: new Date().toISOString(),
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    status: estadoConexion,
    reconectando,
    intentosReconexion,
    ultimaConexion: ultimaConexion ? new Date(ultimaConexion).toISOString() : null,
    uptimeSegundos: Math.round(process.uptime()),
  });
});

// Página para escanear el código QR desde el teléfono.
app.get("/qr", async (req, res) => {
  // Sin caché: el navegador SIEMPRE pide el QR más reciente (nunca uno viejo).
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  const estilo = "font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;padding:2.5rem;background:#0b1a3a;color:#fff;min-height:100vh;box-sizing:border-box";
  const botonPar = `<p style="margin-top:1.4rem"><a href="/pair" style="display:inline-block;background:#25D366;color:#062b14;font-weight:700;text-decoration:none;padding:.8rem 1.4rem;border-radius:12px">🔑 Vincular con el número del teléfono</a></p>`;

  if (estadoConexion === "conectado") {
    return res.send(
      `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Bot conectado</title></head><body style="${estilo}"><h1>✅ Bot conectado a WhatsApp</h1><p>Ya puedes cerrar esta página. El bot está respondiendo.</p></body></html>`
    );
  }

  if (!qrActual) {
    return res.send(
      `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>Generando QR</title></head><body style="${estilo}"><h1>⏳ Generando un código QR nuevo…</h1><p>Esta página se actualiza sola. Espera unos segundos.</p>${botonPar}</body></html>`
    );
  }

  let dataUrl = "";
  try {
    dataUrl = await QRCode.toDataURL(qrActual, { width: 340, margin: 2 });
  } catch (e) {
    return res.status(500).send("No se pudo generar el QR: " + e.message);
  }

  return res.send(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Escanea el QR</title></head><body style="${estilo}"><h1>📲 Escanea este código QR</h1><p>Abre <b>WhatsApp</b> → <b>Ajustes</b> → <b>Dispositivos vinculados</b> → <b>Vincular un dispositivo</b></p><img src="${dataUrl}" alt="Código QR" style="background:#fff;padding:16px;border-radius:16px;margin:1.2rem auto;display:block"/><p style="opacity:.7">El QR cambia cada ~20s; esta página se actualiza sola cada 5s.</p>${botonPar}<script>setTimeout(function(){location.reload();},5000);</script></body></html>`
  );
});

// Prueba de envío: verifica que el bot puede mandar mensajes de WhatsApp.
// Uso: /selftest  (manda al número del bot/admin)  o  /selftest?to=584141234567
app.get("/selftest", async (req, res) => {
  if (estadoConexion !== "conectado" || !sock) {
    return res.status(503).json({ ok: false, error: "El bot no está conectado." });
  }
  const destino = String(req.query.to || PAIRING_PHONE || ADMIN_NUMBER || "").replace(/\D/g, "");
  if (!destino) {
    return res.status(400).json({ ok: false, error: "Falta el número de destino." });
  }
  try {
    const jid = jidDe(destino);
    await sock.sendMessage(jid, {
      text: "✅ Prueba del bot: estoy conectado y puedo enviar mensajes correctamente.",
    });
    return res.json({ ok: true, enviadoA: destino, jid });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Página para vincular con el CÓDIGO por número (más confiable que el QR).
app.get("/pair", async (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  const estilo = "font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;padding:2.5rem;background:#0b1a3a;color:#fff;min-height:100vh;box-sizing:border-box";

  if (estadoConexion === "conectado") {
    return res.send(
      `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Bot conectado</title></head><body style="${estilo}"><h1>✅ Bot conectado a WhatsApp</h1><p>Ya puedes cerrar esta página. El bot está respondiendo.</p></body></html>`
    );
  }

  // Si aún no hay código, intenta pedirlo ahora mismo.
  if (!pairingCodeActual) {
    const r = await solicitarCodigoVinculacion();
    if (!r.ok) {
      return res.send(
        `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="refresh" content="4"><title>Generando código</title></head><body style="${estilo}"><h1>⏳ Generando el código de vinculación…</h1><p>Esta página se actualiza sola. Espera unos segundos.</p><p style="opacity:.6;font-size:.85rem">(${r.error})</p></body></html>`
      );
    }
  }

  const codigo = pairingCodeActual || "";
  const codigoBonito = codigo ? codigo.match(/.{1,4}/g).join(" ") : "";
  return res.send(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Código de vinculación</title></head><body style="${estilo}"><h1>🔑 Vincula con el número del teléfono</h1><ol style="text-align:left;max-width:520px;margin:1.2rem auto;line-height:1.8"><li>Abre <b>WhatsApp</b> en tu teléfono.</li><li>Ve a <b>Ajustes</b> → <b>Dispositivos vinculados</b> → <b>Vincular un dispositivo</b>.</li><li>Toca <b>Vincular con el número del teléfono</b>.</li><li>Escribe este código:</li></ol><div style="font-size:2.6rem;font-weight:800;letter-spacing:.35rem;background:#fff;color:#0b1a3a;border-radius:16px;padding:1.1rem 1.4rem;display:inline-block;margin:.4rem auto">${codigoBonito}</div><p style="opacity:.7">El código caduca en ~1 minuto. Si expira, esta página se actualiza sola cada 10s con uno nuevo.</p><p><a href="/qr" style="color:#7fd7ff">Prefiero escanear el código QR</a></p><script>setTimeout(function(){location.reload();},10000);</script></body></html>`
  );
});

// ============================================================
// ARRANQUE
// ============================================================

// Cada 10 minutos: cierra sesiones inactivas, borra las muy viejas
// y purga los IDs de mensajes ya procesados.
function limpiezaPeriodica() {
  const ahora = Date.now();
  for (const [numero, s] of sesiones) {
    if (!s.cerrada && ahora - s.lastActivity >= SESSION_TIMEOUT_MS) {
      s.cerrada = true;
    }
    if (s.cerrada && ahora - s.lastActivity >= 24 * 60 * 60 * 1000) {
      sesiones.delete(numero);
    }
  }
  for (const [id, ts] of mensajesProcesados) {
    if (ahora - ts > 5 * 60 * 1000) mensajesProcesados.delete(id);
  }
}
setInterval(limpiezaPeriodica, 10 * 60 * 1000);

// Respaldo de sesiones y clientes en disco cada minuto.
setInterval(guardarSesionesEnDisco, 60 * 1000);
setInterval(guardarClientesEnDisco, 60 * 1000);

// Respaldo de la SESIÓN de WhatsApp (auth_baileys) cada 5 minutos, para que
// sobreviva a reinicios/redeploys en hosts sin disco persistente.
setInterval(() => {
  respaldarSesionSupabase().catch(() => {});
}, 5 * 60 * 1000);

// ============================================================
// VIGILANTE (watchdog): si la conexión se cae o queda "colgada",
// fuerza la reconexión automáticamente. El bot nunca se queda muerto.
// ============================================================
setInterval(() => {
  try {
    if (estadoConexion === "conectado") {
      // Baileys expone sock.ws.isOpen (booleano). Si dice "conectado" pero el
      // socket no está abierto, la conexión quedó colgada: se reconecta.
      const abierto = sock?.ws?.isOpen;
      if (typeof abierto === "boolean" && !abierto) {
        console.log("🩺 Vigilante: el socket no está abierto. Reconectando…");
        estadoConexion = "desconectado";
        programarReconexion("Socket cerrado (detectado por el vigilante)");
      }
    } else if (!reconectando && !iniciando && estadoConexion !== "esperando_qr") {
      // Lleva tiempo desconectado y no hay reintento en curso: reconectar.
      console.log("🩺 Vigilante: el bot no está conectado. Reconectando…");
      programarReconexion("Vigilante: bot desconectado");
    }
  } catch (e) {
    console.error("Error en el vigilante:", e.message);
  }
}, 60 * 1000);

// Keep-alive: si se define SELF_URL (o Render lo aporta), se hace ping al
// propio /health cada 5 minutos para reducir que el host "duerma".
const SELF_URL = String(process.env.SELF_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");
if (SELF_URL) {
  setInterval(() => {
    axios.get(`${SELF_URL}/health`, { timeout: 15000 }).catch(() => {});
  }, 5 * 60 * 1000);
  console.log(`🫀 Keep-alive activo: ping a ${SELF_URL}/health cada 5 min`);
}

// Al apagarse el servidor se guarda todo.
process.on("SIGTERM", () => {
  guardarSesionesEnDisco();
  guardarClientesEnDisco();
  process.exit(0);
});

(async () => {
  cargarSesionesDesdeDisco();
  try {
    await cargarSesionesSupabase();
  } catch (e) {
    console.error("No se pudo cargar sesiones de Supabase:", e.message);
  }
  cargarClientesDesdeDisco();

  // Recupera la sesión de WhatsApp desde Supabase (si aplica) ANTES de conectar.
  try {
    await restaurarSesionSupabase();
  } catch (e) {
    console.error("No se pudo restaurar la sesión de WhatsApp:", e.message);
  }

  app.listen(PORT, () => {
    console.log("========================================");
    console.log(`✅ Servidor del bot activo en el puerto ${PORT}`);
    console.log(`🤖 Groq: ${GROQ_MODEL}`);
    console.log(`💬 Conexión: WhatsApp por QR (Baileys)`);
    console.log(`📲 Escanea el QR aquí: http://localhost:${PORT}/qr`);
    console.log(`🔑 O vincula con el código por número: http://localhost:${PORT}/pair`);
    console.log(
      `💠 Cotización automática: ${PRICE_QUOTES_ENABLED ? "ACTIVA" : "DESACTIVADA"}`
    );
    console.log(
      `👨🏻‍💻 Admin: ${ADMIN_NUMBERS.length ? "CONFIGURADO" : "FALTA ADMIN_PHONE"}`
    );
    console.log(
      `🔍 Consulta de cédula: ACTIVA (${CEDULA_APP_ID && CEDULA_TOKEN ? "API oficial" : "consulta web gratuita"})`
    );
    console.log(
      `🗄️ Supabase: ${SUPABASE_URL && SUPABASE_KEY ? "ACTIVO" : "SIN CONFIGURAR"}`
    );
    console.log("========================================");
  });

  iniciarBaileys().catch((e) => {
    console.error("Error al iniciar Baileys:", e);
  });
})();
