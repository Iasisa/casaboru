// Lógica pura de pedidos y reservas: sin DOM, se prueba con `node pedido-core.test.mjs`.

export function dinero(n, moneda) {
  const { simbolo = "$", decimales = 2, locale = "es" } = moneda || {};
  const entero = Number.isInteger(n);
  const num = n.toLocaleString(locale, { minimumFractionDigits: entero ? 0 : decimales, maximumFractionDigits: decimales });
  return `${simbolo} ${num}`.trim();
}

// Grupos de opciones: { nombre, valores: ["Atún", { nombre: "Grande 1300 ml", precio: 4 }], min, max }.
// max 1 = elige uno (por defecto, obligatorio); max > 1 = "hasta N" (min 0 salvo que se diga).
export const valorOpcion = (v) => (typeof v === "string" ? { nombre: v, precio: 0 } : { precio: 0, ...v });
export const limitesGrupo = (g) => { const max = g.max ?? 1; return { max, min: g.min ?? (max === 1 ? 1 : 0) }; };
const elegidos = (sel) => (Array.isArray(sel) ? sel : sel ? [sel] : []);

// null si la elección cumple los mínimos y máximos; si no, el mensaje para la persona.
export function validarOpciones(item, opciones = {}) {
  for (const g of item.opciones || []) {
    const n = elegidos(opciones[g.nombre]).length;
    const { min, max } = limitesGrupo(g);
    if (n < min) return min === 1 && max === 1 ? `Elige ${g.nombre.toLowerCase()}` : `Elige al menos ${min} en ${g.nombre.toLowerCase()}`;
    if (n > max) return `Máximo ${max} en ${g.nombre.toLowerCase()}`;
  }
  return null;
}

export function precioLinea(item, linea) {
  const extras = (linea.extras || []).reduce((s, nombre) => s + ((item.extras || []).find((e) => e.nombre === nombre)?.precio || 0), 0);
  const opciones = (item.opciones || []).reduce((s, g) => s + elegidos(linea.opciones?.[g.nombre])
    .reduce((t, nombre) => t + (g.valores.map(valorOpcion).find((v) => v.nombre === nombre)?.precio || 0), 0), 0);
  return (item.precio + opciones + extras) * linea.cantidad;
}

export function buscarItem(carta, id) {
  for (const seccion of carta) {
    const item = seccion.items.find((i) => i.id === id);
    if (item) return item;
  }
  return null;
}

// {negocio} en saludos se reemplaza por el nombre: «Hola {negocio} 🌿» → «Hola Bruselas 🌿»
const saludo = (texto, negocio, porDefecto) => (texto || porDefecto).replaceAll("{negocio}", negocio.nombre);

// Una línea por producto: «🥪 2x Sandwich Bruselas (Avena) — S/ 50» (emoji opcional por producto)
export function armarMensajePedido(negocio, lineas, datos = {}) {
  const { moneda, pedidos = {} } = negocio;
  let total = 0;
  const filas = lineas.map((l) => {
    const item = buscarItem(negocio.carta, l.id);
    if (!item) throw new Error(`Producto no existe en la carta: ${l.id}`);
    const sub = precioLinea(item, l);
    total += sub;
    const cabeza = `${item.emoji ? `${item.emoji} ` : ""}${l.cantidad}x ${item.nombre}`;
    // Productos que se arman (grupos "hasta N"): una sublínea por grupo. Los simples: detalle entre paréntesis.
    if ((item.opciones || []).some((g) => limitesGrupo(g).max > 1)) {
      const grupos = (item.opciones || []).map((g) => [g.nombre, elegidos(l.opciones?.[g.nombre])]).filter(([, v]) => v.length);
      if (l.extras?.length) grupos.push(["Extras", l.extras]);
      return [`${cabeza} — ${dinero(sub, moneda)}`, ...grupos.map(([n, v]) => `   ${n}: ${v.join(", ")}`)].join("\n");
    }
    const detalle = [...Object.values(l.opciones || {}).flatMap(elegidos), ...(l.extras || [])].filter(Boolean);
    return `${cabeza}${detalle.length ? ` (${detalle.join(", ")})` : ""} — ${dinero(sub, moneda)}`;
  });
  return [
    saludo(pedidos.saludo, negocio, "Hola, quiero hacer un pedido:"),
    "",
    ...filas,
    "",
    `Total: ${dinero(total, moneda)}`,
    ...camposPedidos(pedidos.pide, datos, negocio),
    ...(pedidos.cierre ? ["", pedidos.cierre] : []), // «¿A qué hora lo puedo recoger?»
  ].join("\n");
}

// Campos condicionales: `si_modo: "Delivery"` (atajo) o `si: { campo: "comprobante", valor: "Factura" }`.
export function campoAplica(c, datos) {
  if (c.si_modo && datos.modo !== c.si_modo) return false;
  if (c.si && datos[c.si.campo] !== c.si.valor) return false;
  return true;
}

// Recojo lleva la dirección del local para que el cliente y el negocio la tengan en el chat.
function camposPedidos(pide = [], datos, negocio = {}) {
  return pide.filter((c) => campoAplica(c, datos) && String(datos[c.id] ?? "").trim())
    .map((c) => {
      const v = String(datos[c.id]).trim();
      const local = c.tipo === "modo" && /recojo|recoger|local/i.test(v) && negocio.direccion ? ` (${negocio.direccion})` : "";
      return `${c.etiqueta}: ${v}${local}`;
    });
}

const aMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

// Precio según su tarifa real: cada tramo de 30 min cobra la tarifa vigente a esa hora.
export function precioReserva(reservas, fechaISO, horaInicio, minutos) {
  const dia = new Date(`${fechaISO}T12:00:00`).getDay(); // 0 domingo
  let total = 0;
  for (let t = aMin(horaInicio); t < aMin(horaInicio) + minutos; t += 30) {
    const tarifa = reservas.tarifas.find((x) => x.dias.includes(dia) && aMin(x.desde) <= t && t < aMin(x.hasta));
    if (!tarifa) return null; // fuera de horario: no se puede reservar
    total += tarifa.precio_hora / 2;
  }
  return total;
}

export function armarMensajeReserva(negocio, r, datos = {}) {
  const { reservas, moneda } = negocio;
  if (reservas.tipo === "mesa") {
    const n = Number(r.personas);
    if (!(n >= 1) || (reservas.max_personas && n > reservas.max_personas)) throw new Error("Número de personas fuera de rango");
    // pedido adelantado: lo que ya está en el carrito viaja con la reserva, con total referencial
    const adelanto = (r.lineas || []).map((l) => {
      const item = buscarItem(negocio.carta, l.id);
      if (!item) throw new Error(`Producto no existe en la carta: ${l.id}`);
      return { texto: `${item.emoji ? `${item.emoji} ` : ""}${l.cantidad}x ${item.nombre} — ${dinero(precioLinea(item, l), moneda)}`, sub: precioLinea(item, l) };
    });
    const total = adelanto.reduce((t, x) => t + x.sub, 0);
    return [
      saludo(reservas.saludo, negocio, "Hola, quiero reservar:"),
      "",
      `Mesa para ${n}${r.opcion ? ` · ${r.opcion}` : ""}`,
      `Fecha: ${r.fecha} · ${r.hora}${r.turno ? ` (${r.turno})` : ""}`,
      ...camposPedidos(reservas.pide, datos, negocio),
      ...(adelanto.length ? ["", "Quiero adelantar:", ...adelanto.map((x) => x.texto), `Referencial: ${dinero(total, moneda)}`] : []),
    ].join("\n");
  }
  const precio = precioReserva(reservas, r.fecha, r.hora, r.minutos);
  if (precio === null) throw new Error("Horario fuera de tarifa");
  return [
    saludo(reservas.saludo, negocio, "Hola, quiero reservar:"),
    "",
    `${reservas.recurso}${r.opcion ? ` · ${r.opcion}` : ""}`,
    `Fecha: ${r.fecha} · ${r.hora} (${r.minutos} min)`,
    `Precio: ${dinero(precio, moneda)}`,
    ...camposPedidos(reservas.pide, datos, negocio),
  ].join("\n");
}

// Formulario de informes / inscripción (gimnasios, academias, clínicas, servicios): sin carta ni precios,
// solo los campos que el negocio ya pide, armados en un mensaje.
export function armarMensajeFormulario(negocio, form, datos = {}) {
  const faltan = (form.campos || []).filter((c) => c.requerido && campoAplica(c, datos) && !String(datos[c.id] ?? "").trim());
  if (faltan.length) throw new Error(`Faltan campos: ${faltan.map((c) => c.etiqueta).join(", ")}`);
  return [
    saludo(form.saludo, negocio, "Hola, quiero información:"),
    "",
    ...camposPedidos(form.campos, datos, negocio),
  ].join("\n");
}

// Franjas para reservar mesa: cada `paso` min dentro del horario del día (sin la última media hora antes de cerrar).
// `desde` (min del día) quita las horas que ya pasaron cuando el día es hoy.
export function horasDelDia(horario, dia, paso = 30, margen = 30, desde = -1) {
  return horario.filter((f) => f.dias.includes(dia)).flatMap((f) => {
    const fin = aMin(f.cierra) + (aMin(f.cierra) <= aMin(f.abre) ? 1440 : 0) - margen;
    const out = [];
    for (let t = aMin(f.abre); t <= fin; t += paso) if (t > desde) out.push(`${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
    return out;
  });
}

// Búsqueda en cartas grandes: sin tildes ni mayúsculas, por nombre, descripción o sección.
const plano = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function buscarEnCarta(carta, q) {
  const palabras = plano(q).split(/\s+/).filter(Boolean);
  if (!palabras.length) return carta;
  return carta.map((sec) => ({
    ...sec,
    items: sec.items.filter((i) => palabras.every((p) => plano(`${i.nombre} ${i.descripcion} ${sec.seccion}`).includes(p))),
  })).filter((sec) => sec.items.length);
}

// Instagram no deja prellenar el DM: se copia el mensaje y se abre el chat (ig.me) para pegarlo.
export function urlInstagram(usuario) {
  const u = String(usuario || "").replace(/^@/, "").trim();
  if (!/^[\w.]{1,30}$/.test(u)) throw new Error("usuario_ig inválido en negocio.json");
  return `https://ig.me/m/${u}`;
}

export function urlWhatsApp(telefono, mensaje) {
  const num = String(telefono).replace(/\D/g, "");
  if (num.length < 8) throw new Error("WhatsApp del negocio sin número válido en negocio.json");
  return `https://wa.me/${num}?text=${encodeURIComponent(mensaje)}`;
}

// ---------- horario: «Abierto ahora · hasta la 1 pm» ----------
// horario: [{ dias: [1..5] (0 = domingo), abre: "08:00", cierra: "13:00" }]; cierra < abre = pasa la medianoche.
// La hora es la del negocio (negocio.zona, p. ej. "America/Lima"), no la de quien visita.
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export function hora12(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const h12 = h % 12 || 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

export function horaLocal(fecha, zona) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: zona, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(fecha).map((p) => [p.type, p.value]));
  return { dia: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(partes.weekday), min: Number(partes.hour) * 60 + Number(partes.minute) };
}

// «la 1 pm» pero «las 6 pm»
const art = (hhmm) => (/^1(:| )/.test(hora12(hhmm)) ? "la" : "las");

export function estadoAbierto(horario, ahora) {
  const SEM = 7 * 1440;
  const t = ahora.dia * 1440 + ahora.min;
  // cada franja como intervalo en minutos de la semana; las que cruzan la medianoche siguen al día siguiente
  const franjas = horario.flatMap((f) => f.dias.map((d) => {
    const ini = d * 1440 + aMin(f.abre);
    return { ini, fin: d * 1440 + aMin(f.cierra) + (aMin(f.cierra) <= aMin(f.abre) ? 1440 : 0), f };
  }));
  const actual = franjas.find((x) => [0, SEM].some((o) => x.ini <= t + o && t + o < x.fin));
  if (actual) return { abierto: true, texto: `Abierto ahora · hasta ${art(actual.f.cierra)} ${hora12(actual.f.cierra)}` };
  const prox = franjas.map((x) => ({ ...x, falta: (x.ini - t + SEM) % SEM })).sort((a, b) => a.falta - b.falta)[0];
  if (!prox) return { abierto: false, texto: "Cerrado" };
  const dia = Math.floor(prox.ini / 1440) % 7;
  const cuando = dia === ahora.dia && prox.falta < 1440 ? "hoy" : dia === (ahora.dia + 1) % 7 ? "mañana" : `el ${DIAS[dia]}`;
  return { abierto: false, texto: `Cerrado · abre ${cuando} a ${art(prox.f.abre)} ${hora12(prox.f.abre)}` };
}

// ---------- turnos: «de día o de noche» ----------
// negocio.turnos: [{ id: "dia", nombre: "Almuerzo", dias: [...], abre: "12:00", cierra: "15:30" }, { id: "noche", ... }]
// Devuelve el turno en curso o, si está cerrado, el próximo que abre. La web cambia de identidad y de carta con él.
export function turnoActual(turnos, ahora) {
  if (!turnos?.length) return null;
  const SEM = 7 * 1440;
  const t = ahora.dia * 1440 + ahora.min;
  let mejor = null;
  for (const turno of turnos) {
    for (const d of turno.dias) {
      const ini = d * 1440 + aMin(turno.abre);
      const fin = d * 1440 + aMin(turno.cierra) + (aMin(turno.cierra) <= aMin(turno.abre) ? 1440 : 0);
      if ([0, SEM].some((o) => ini <= t + o && t + o < fin)) return { ...turno, enCurso: true };
      const falta = (ini - t + SEM) % SEM;
      if (!mejor || falta < mejor.falta) mejor = { turno, falta };
    }
  }
  return { ...mejor.turno, enCurso: false };
}

// Carta del turno: secciones o productos con `turno` solo se muestran en ese turno; sin `turno`, siempre.
export function cartaDelTurno(carta, turnoId) {
  if (!turnoId) return carta;
  return carta.filter((s) => !s.turno || s.turno === turnoId)
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.turno || i.turno === turnoId) }))
    .filter((s) => s.items.length);
}
