# 🛠️ Corrección: el bot ya no insiste tras un acuerdo o un desinterés

## ¿Qué estaba pasando?

El bot programa un **seguimiento automático** (un "recordatorio") cuando el
cliente escribe y luego queda en silencio. El problema era que ese seguimiento
se programaba **después de casi cualquier mensaje, sin mirar el estado de la
conversación**. Como consecuencia:

- Aunque el cliente ya hubiera **cerrado un acuerdo** (por ejemplo, quedó en que
  un gestor lo atendería), el bot le volvía a escribir a los 30 minutos.
- Aunque el cliente hubiera **dicho que no le interesaba**, el bot seguía
  insistiendo.
- El bot solo dejaba de escribir si el cliente respondía, pero no respetaba el
  hecho de que la conversación ya estuviera **finalizada**.

## ¿Cuál era la causa exacta?

En `server.js`, al final del manejo de cada mensaje, se hacía:

```js
if (!soloMenuOSaludo) programarSeguimiento(numero);
```

Esa condición **no consultaba** ni el estado de la sesión (`s.estado`) ni la
etapa del cliente (`clientes[numero].etapa`). Por eso el temporizador de 30
minutos se armaba incluso en conversaciones ya cerradas.

## ¿Qué se corrigió?

Se añadió una **guarda de estado** que se evalúa antes de programar cualquier
seguimiento, y una **reactivación** cuando la persona vuelve a preguntar.

### 1. Estados y etapas que bloquean el seguimiento

```js
const ESTADOS_SIN_SEGUIMIENTO = new Set([
  "cierre_pendiente",       // ya se avisó al gestor
  "cierre_gestor_avisado",  // el gestor atenderá la solicitud
  "post_cierre_atento",     // conversación finalizada (acuerdo cerrado)
]);

const ETAPAS_SIN_SEGUIMIENTO = new Set([
  "NO INTERESADO",
  "CONVERSACIÓN FINALIZADA",
  "SOLICITÓ GESTOR",
  "ESPERA MUESTRA DEL GESTOR",
]);
```

### 2. La guarda central

`conversacionSinSeguimiento(numero)` devuelve `true` si la sesión está en un
estado de cierre **o** el cliente está en una etapa terminal. En ese caso **no
se programa ningún recordatorio**.

### 3. Detección de desinterés en texto libre

`esDesinteresCliente(texto)` reconoce rechazos como *"no"*, *"no gracias"*,
*"no me interesa"*, *"no por ahora"*, *"ya no quiero"*, *"no insistas"*, etc.
Cuando se detecta, el cliente se marca como **NO INTERESADO** y se cancela
cualquier seguimiento pendiente.

### 4. Reactivación cuando la persona vuelve a preguntar

`reactivarSeguimiento(numero)` limpia la etapa terminal cuando el cliente envía
una **consulta real** (no un simple "ok"/"hola"). Así el flujo se reactiva y, si
la persona vuelve a quedar en silencio, recibe **un** nuevo recordatorio. Si solo
envía un "toque" genérico tras el cierre, **no** se le escribe.

### 5. Doble verificación dentro del temporizador

Además de la guarda al programar, el propio temporizador vuelve a comprobar el
estado justo antes de enviar. Es una red de seguridad: aunque algo hubiera
programado un recordatorio, si la conversación ya se cerró, **no se envía**.

## Comportamiento resultante

| Situación | ¿El bot vuelve a escribir solo? |
|---|---|
| Cliente interesado que queda en silencio | **Sí**, un recordatorio |
| Cliente que **cerró un acuerdo** | **No** |
| Cliente que dijo **"no me interesa"** | **No** |
| Cliente que pidió un gestor / espera muestra | **No** |
| Cliente que, tras cerrar, envía un "ok" genérico | **No** |
| Cliente que, tras cerrar, **vuelve a preguntar algo** | **Sí** (se reactiva) |

En resumen: **el bot no le vuelve a escribir hasta que la persona pregunte algo
de nuevo**, tal como se pidió.

## Archivos modificados

- **`server.js`** — guarda de estado, detección de desinterés, reactivación y
  doble verificación en el temporizador.
- **`tests/test_seguimiento.js`** — prueba automática nueva (6 casos).
- **`CORRECCION-SEGUIMIENTO.md`** — este documento.

## Pruebas realizadas (verificadas)

Con Baileys simulado y el seguimiento acelerado (`SEGUIMIENTO_MINUTOS=0.05`):

- ✅ **Interesado en silencio** → **SÍ** recibe recordatorio.
- ✅ **Tras cerrar acuerdo** → **NO** recibe recordatorio.
- ✅ **Tras mostrar desinterés** → **NO** recibe recordatorio.
- ✅ **Al volver a preguntar** (tras desinterés) → **SÍ** se reactiva.
- ✅ **Tras acuerdo, un "ok" genérico** → **NO** reactiva.
- ✅ **Tras acuerdo, una pregunta nueva** → **SÍ** reactiva.

Resultado: **6/6 pruebas en verde.**

Para ejecutarlas:

```bash
node tests/test_seguimiento.js
```

## Cómo ajustar el tiempo del recordatorio

El tiempo por defecto sigue siendo **30 minutos**. Ahora es configurable con la
variable de entorno `SEGUIMIENTO_MINUTOS` (útil para pruebas):

```bash
SEGUIMIENTO_MINUTOS=30   # valor por defecto
```
