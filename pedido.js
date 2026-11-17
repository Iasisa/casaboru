// Capa de interfaz de pedidos y reservas. El diseño lo pone el concepto: este archivo solo
// pinta estructura semántica dentro de los contenedores [data-*] y emite eventos para animar.
//
//   <section data-carta></section>        carta con cantidades, opciones y extras
//   <div data-carrito></div>              barra del pedido (total + botón)
//   <section data-reservas></section>     formulario de reserva con precio en vivo
//   <span data-estado></span>             «Abierto ahora · hasta la 1 pm» (se actualiza cada minuto)
//   <form data-formulario="informes"></form>  informes / inscripción / cotización (negocio.formularios[], sin carta)
//   <button data-cambiar-turno></button>  cambia de turno a mano (negocio.turnos); <html data-turno="dia|noche"> cambia la identidad
//   <span data-turno-nombre></span>       nombre del turno en pantalla
//   <a data-dueno></a>                    «¿Eres el dueño? Quiero esta web» (solo si negocio.vendedor existe)
//
// Eventos en document: negocio:listo {negocio} · carrito:cambio {lineas, total, unidades, ultimo} (la taza se llena con `unidades`)
//   · reserva:cambio {datos, texto} (la tarjeta de mesa se arma en vivo) · turno:cambio {turno, anterior, manual}
//   · whatsapp:abriendo {mensaje, url, espera} (anima el cierre aquí: el brindis, el sello) · whatsapp:enviado {mensaje, url}
// ?prueba=1 muestra el mensaje en pantalla y NO abre WhatsApp (nunca le escribas al negocio en pruebas).
import { armarMensajePedido, armarMensajeReserva, precioLinea, precioReserva, buscarItem, dinero, urlWhatsApp, urlInstagram,
  campoAplica, estadoAbierto, horaLocal, horasDelDia, hora12, buscarEnCarta, armarMensajeFormulario,
  validarOpciones, valorOpcion, limitesGrupo, turnoActual, cartaDelTurno } from "./pedido-core.js";

const PRUEBA = new URLSearchParams(location.search).has("prueba");
const SIN_MOVIMIENTO = matchMedia("(prefers-reduced-motion: reduce)").matches;
const lineas = [];
let negocio;
let turno = null; // turno en curso (negocio.turnos), decide la carta y la identidad visible

function h(tag, attrs = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  el.append(...hijos.flat().filter((x) => x != null));
  return el;
}

const emitir = (nombre, detail) => document.dispatchEvent(new CustomEvent(nombre, { detail }));

// Muestra "Abriendo WhatsApp…" un momento (la animación del concepto corre en whatsapp:abriendo)
// y navega a wa.me. location.assign y no window.open: tras una espera, el navegador bloquearía el popup.
async function enviar(mensaje, canal = "whatsapp") {
  if (canal === "instagram") return enviarInstagram(mensaje);
  const url = urlWhatsApp(negocio.whatsapp, mensaje);
  const espera = SIN_MOVIMIENTO ? 0 : negocio.pedidos?.espera_ms ?? 900;
  window.__ultimoMensaje = mensaje;
  window.__ultimaUrl = url;
  emitir("whatsapp:abriendo", { mensaje, url, espera });
  const dlg = h("dialog", { class: PRUEBA ? "modo-prueba" : "abriendo", "data-abriendo": true, "aria-live": "polite" },
    h("p", {}, negocio.pedidos?.abriendo || "Abriendo WhatsApp…"),
    PRUEBA ? [h("p", {}, h("strong", {}, "Modo prueba: "), "esto llegaría a WhatsApp"),
      h("pre", { "data-mensaje": true }, mensaje),
      h("button", { type: "button", onclick: () => dlg.close() }, "Cerrar")] : null);
  document.body.append(dlg);
  dlg.showModal();
  if (PRUEBA) return; // nunca le escribas al negocio en pruebas
  setTimeout(() => {
    emitir("whatsapp:enviado", { mensaje, url });
    dlg.close();
    location.assign(url);
  }, espera);
}

// Instagram no deja prellenar el DM: copiamos el mensaje y el cliente lo pega en el chat que abre el botón.
async function enviarInstagram(mensaje) {
  const url = urlInstagram(negocio.usuario_ig);
  window.__ultimoMensaje = mensaje;
  window.__ultimaUrl = url;
  let copiado = false;
  try { await navigator.clipboard.writeText(mensaje); copiado = true; } catch { /* sin permiso: se muestra para copiar a mano */ }
  emitir("instagram:abriendo", { mensaje, url, copiado });
  const dlg = h("dialog", { class: "abriendo", "data-abriendo": true },
    h("p", {}, copiado ? "Copiamos tu pedido. Pégalo en el chat de Instagram:" : "Copia tu pedido y pégalo en el chat de Instagram:"),
    h("pre", { "data-mensaje": true }, mensaje),
    PRUEBA ? h("p", {}, h("strong", {}, "Modo prueba: "), "no se abre Instagram")
      : h("a", { href: url, target: "_blank", rel: "noopener", class: "cta", onclick: () => dlg.close() }, "Abrir Instagram"),
    h("button", { type: "button", onclick: () => dlg.close() }, "Cerrar"));
  document.body.append(dlg);
  dlg.showModal();
}

// ---------- carta ----------
function pintarSecciones(cont, carta) {
  cont.replaceChildren(...carta.map((seccion) => {
    const id = `sec-${seccion.seccion.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    return h("section", { class: "carta-seccion", "aria-labelledby": id },
      h("h3", { id }, seccion.seccion),
      h("ul", { class: "carta-items" }, seccion.items.map(pintarItem)));
  }));
  if (!carta.length) cont.append(h("p", { class: "carta-vacia" }, "No encontramos eso en la carta."));
}

// Cartas grandes (> 20 productos o carta_ui.buscador) llevan buscador y filtro por sección.
// Con turnos, solo se ve la carta del turno (y se vuelve a pintar al cambiarlo).
function pintarCarta(cont) {
  cont.replaceChildren();
  const carta = cartaDelTurno(negocio.carta, turno?.id);
  const total = carta.reduce((n, s) => n + s.items.length, 0);
  const ui = negocio.carta_ui || {};
  const lista = h("div", { class: "carta-lista" });
  if (!(ui.buscador ?? total > 20)) return void (cont.append(lista), pintarSecciones(lista, carta));
  let seccion = "", q = "";
  const filtrar = () => pintarSecciones(lista, buscarEnCarta(carta.filter((x) => !seccion || x.seccion === seccion), q));
  const filtros = h("div", { class: "carta-filtros", role: "radiogroup", "aria-label": "Secciones de la carta" },
    ["", ...carta.map((x) => x.seccion)].map((nombre, i) => h("label", { class: "chip" },
      h("input", { type: "radio", name: "carta-seccion", value: nombre, checked: i === 0, onchange: () => { seccion = nombre; filtrar(); } }),
      nombre || "Todo")));
  const buscador = h("input", { type: "search", class: "carta-buscar", placeholder: ui.placeholder || "Buscar en la carta",
    "aria-label": "Buscar en la carta", oninput: (e) => { q = e.target.value; filtrar(); } });
  cont.append(h("div", { class: "carta-herramientas" }, buscador, filtros), lista);
  filtrar();
}

// Grupos de opciones: "elige 1" = radios; "hasta N" = casillas que se bloquean al llegar al máximo.
// El precio se actualiza con lo elegido; si falta algo, se avisa en vez de agregar.
function pintarItem(item) {
  const sel = { opciones: {}, extras: [] };
  const precio = h("span", { class: "item-precio" }, dinero(item.precio, negocio.moneda));
  const aviso = h("span", { class: "item-aviso", role: "alert" });
  const refrescar = () => {
    precio.textContent = dinero(precioLinea(item, { cantidad: 1, ...sel }), negocio.moneda);
    aviso.textContent = "";
  };

  const grupos = (item.opciones || []).map((g) => {
    const { min, max } = limitesGrupo(g);
    const valores = g.valores.map(valorOpcion);
    const nombreCampo = `${item.id}-${g.nombre}`;
    if (max === 1) {
      if (min === 1) sel.opciones[g.nombre] = valores[0].nombre;
      return h("fieldset", { class: "item-opcion" }, h("legend", {}, g.nombre),
        valores.map((v, i) => h("label", { class: "chip" },
          h("input", { type: "radio", name: nombreCampo, value: v.nombre, checked: min === 1 && i === 0,
            onchange: () => { sel.opciones[g.nombre] = v.nombre; refrescar(); } }),
          v.precio ? `${v.nombre} +${dinero(v.precio, negocio.moneda)}` : v.nombre)));
    }
    sel.opciones[g.nombre] = [];
    const caja = h("fieldset", { class: "item-opcion item-opcion-multiple", "data-max": max },
      h("legend", {}, `${g.nombre} · ${min ? `elige ${min}${max > min ? ` a ${max}` : ""}` : `hasta ${max}`}`),
      valores.map((v) => h("label", { class: "chip" },
        h("input", { type: "checkbox", name: nombreCampo, value: v.nombre, onchange: (e) => {
          const actual = sel.opciones[g.nombre];
          sel.opciones[g.nombre] = e.target.checked ? [...actual, v.nombre] : actual.filter((x) => x !== v.nombre);
          const lleno = sel.opciones[g.nombre].length >= max;
          caja.querySelectorAll("input").forEach((i) => { i.disabled = lleno && !i.checked; });
          refrescar();
        } }),
        v.precio ? `${v.nombre} +${dinero(v.precio, negocio.moneda)}` : v.nombre)));
    return caja;
  });
  const extras = (item.extras || []).map((ex) => h("label", { class: "chip" },
    h("input", { type: "checkbox", value: ex.nombre,
      onchange: (e) => { sel.extras = e.target.checked ? [...sel.extras, ex.nombre] : sel.extras.filter((x) => x !== ex.nombre); refrescar(); } }),
    `${ex.nombre} +${dinero(ex.precio, negocio.moneda)}`));

  const copia = () => ({ opciones: Object.fromEntries(Object.entries(sel.opciones).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v])), extras: [...sel.extras] });
  return h("li", { class: "item", "data-item": item.id },
    h("span", { class: "item-nombre" }, item.nombre),
    item.descripcion ? h("span", { class: "item-desc" }, item.descripcion) : null,
    precio,
    grupos.length || extras.length ? h("div", { class: "item-variantes" }, grupos, extras) : null,
    negocio.pedidos?.activo ? h("button", { type: "button", class: "item-agregar", "data-agregar": item.id,
      "aria-label": `Agregar ${item.nombre}`,
      onclick: () => {
        const error = validarOpciones(item, sel.opciones);
        if (error) return void (aviso.textContent = error);
        agregar(item.id, copia());
      } }, "+") : null,
    aviso);
}

// misma combinación de opciones = misma línea
const clave = (l) => JSON.stringify([l.id, l.opciones, [...l.extras].sort()]);

function agregar(id, variante, delta = 1) {
  const nueva = { id, cantidad: delta, opciones: variante.opciones || {}, extras: variante.extras || [] };
  const i = lineas.findIndex((l) => clave(l) === clave(nueva));
  if (i === -1) lineas.push(nueva);
  else lineas[i] = { ...lineas[i], cantidad: lineas[i].cantidad + delta };
  const limpias = lineas.filter((l) => l.cantidad > 0);
  lineas.splice(0, lineas.length, ...limpias);
  const total = lineas.reduce((s, l) => s + precioLinea(buscarItem(negocio.carta, l.id), l), 0);
  const unidades = lineas.reduce((n, l) => n + l.cantidad, 0);
  emitir("carrito:cambio", { lineas: [...lineas], total, unidades, ultimo: nueva });
}

// ---------- barra del pedido ----------
function pintarCarrito(cont) {
  const cuenta = h("span", { class: "carrito-cuenta", "aria-live": "polite" }, "0");
  const total = h("span", { class: "carrito-total" }, dinero(0, negocio.moneda));
  const lista = h("ul", { class: "carrito-lineas" });
  const form = h("form", { class: "carrito-form", "data-pedido-form": true, onsubmit: (e) => {
    e.preventDefault();
    if (!lineas.length) return;
    enviar(armarMensajePedido(negocio, lineas, Object.fromEntries(new FormData(form))), e.submitter?.value);
  } },
  (negocio.pedidos.pide || []).map(campoFormulario),
  botonesEnvio(negocio.pedidos.boton || "Pedir por WhatsApp", "carrito-enviar"));
  activarCondicionales(form, negocio.pedidos.pide);
  const panel = h("details", { class: "carrito" },
    h("summary", {}, h("span", {}, "Tu pedido"), cuenta, total), lista, form);
  cont.append(panel);
  cont.hidden = true;

  document.addEventListener("carrito:cambio", ({ detail }) => {
    cont.hidden = detail.lineas.length === 0;
    cuenta.textContent = detail.lineas.reduce((s, l) => s + l.cantidad, 0);
    total.textContent = dinero(detail.total, negocio.moneda);
    lista.replaceChildren(...detail.lineas.map((l) => {
      const item = buscarItem(negocio.carta, l.id);
      const det = [...Object.values(l.opciones), ...l.extras].join(", ");
      return h("li", {},
        h("span", {}, `${item.nombre}${det ? ` · ${det}` : ""}`),
        h("span", { class: "cantidad" },
          h("button", { type: "button", "aria-label": `Quitar uno de ${item.nombre}`, onclick: () => agregar(l.id, l, -1) }, "−"),
          h("output", {}, l.cantidad),
          h("button", { type: "button", "aria-label": `Agregar otro ${item.nombre}`, onclick: () => agregar(l.id, l, 1) }, "+")));
    }));
  });
}

function campoFormulario(c) {
  const attrs = { name: c.id, required: c.requerido };
  let control;
  if (c.tipo === "modo") control = h("select", attrs, (negocio.pedidos.modos || []).map((m) => h("option", {}, m)));
  else if (c.tipo === "select") control = h("select", attrs, (c.opciones || []).map((m) => h("option", {}, m)));
  else if (c.tipo === "textarea") control = h("textarea", { ...attrs, rows: 2 });
  else control = h("input", { ...attrs, type: c.tipo || "text", inputmode: c.tipo === "tel" ? "tel" : undefined,
    autocomplete: { nombre: "name", direccion: "street-address", whatsapp: "tel", telefono: "tel" }[c.id] || "off" });
  return h("label", { "data-campo": c.id }, c.etiqueta, control);
}

// WhatsApp si hay número; Instagram si pedidos.instagram = true. Solo DM (sin número): el botón principal va a Instagram.
function botonesEnvio(texto, clase, textoInstagram = "Pedir por Instagram") {
  if (!negocio.whatsapp) return [h("button", { type: "submit", class: `${clase} por-instagram`, value: "instagram" }, texto)];
  return [
    h("button", { type: "submit", class: clase, value: "whatsapp" }, texto),
    negocio.pedidos?.instagram ? h("button", { type: "submit", class: `${clase} por-instagram`, value: "instagram" }, textoInstagram) : null,
  ];
}

// Campos con si_modo / si (la dirección con Delivery, el RUC con Factura): aparecen y se exigen solo cuando aplican.
function activarCondicionales(form, campos = []) {
  const actualizar = () => {
    const datos = Object.fromEntries(new FormData(form));
    for (const c of campos) {
      if (!c.si_modo && !c.si) continue;
      const label = form.querySelector(`[data-campo="${c.id}"]`);
      const aplica = campoAplica(c, datos);
      label.hidden = !aplica;
      label.querySelector("input, textarea, select").required = aplica && !!c.requerido;
    }
  };
  form.addEventListener("change", actualizar);
  actualizar();
}

// Turnos (día/noche, almuerzo/cena): la web abre en el turno en curso o el próximo, en la hora del negocio.
// ?turno=noche lo fuerza (para revisar y capturar cada identidad).
function iniciarTurnos() {
  if (!negocio.turnos?.length) return;
  const forzado = new URLSearchParams(location.search).get("turno");
  turno = negocio.turnos.find((t) => t.id === forzado) || turnoActual(negocio.turnos, horaLocal(new Date(), negocio.zona));
  aplicarTurno(false);
  document.querySelectorAll("[data-cambiar-turno]").forEach((b) => b.addEventListener("click", () => {
    const i = negocio.turnos.findIndex((t) => t.id === turno.id);
    const anterior = turno;
    turno = negocio.turnos[(i + 1) % negocio.turnos.length];
    aplicarTurno(true, anterior);
  }));
}

function aplicarTurno(manual, anterior = null) {
  document.documentElement.dataset.turno = turno.id;
  document.querySelectorAll("[data-turno-nombre]").forEach((el) => { el.textContent = turno.nombre; });
  const siguiente = negocio.turnos[(negocio.turnos.findIndex((t) => t.id === turno.id) + 1) % negocio.turnos.length];
  document.querySelectorAll("[data-cambiar-turno]").forEach((b) => {
    b.setAttribute("aria-label", `Ver ${siguiente.nombre.toLowerCase()}`);
    if (b.dataset.auto !== undefined || !b.textContent.trim()) { b.dataset.auto = ""; b.textContent = siguiente.nombre; }
  });
  const carta = document.querySelector("[data-carta]");
  if (manual && carta) pintarCarta(carta);
  emitir("turno:cambio", { turno, anterior, manual });
}

function pintarEstado(el) {
  const pintar = () => {
    const e = estadoAbierto(negocio.horario || [], horaLocal(new Date(), negocio.zona));
    el.textContent = e.texto;
    el.dataset.abierto = e.abierto;
  };
  pintar();
  setInterval(pintar, 60_000);
}

// ---------- reservas ----------
function pintarReservas(cont) {
  return negocio.reservas.tipo === "mesa" ? pintarReservaMesa(cont) : pintarReservaPorHora(cont);
}

// Próximos días que el negocio abre, en su zona horaria: [{ iso, dia, etiqueta }]
function proximosDias(n) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: negocio.zona, year: "numeric", month: "2-digit", day: "2-digit" });
  const nombre = new Intl.DateTimeFormat("es", { timeZone: negocio.zona, weekday: "short", day: "numeric", month: "short" });
  const out = [];
  const ahora = horaLocal(new Date(), negocio.zona);
  for (let k = 0; out.length < n && k < 21; k++) {
    const fecha = new Date(Date.now() + k * 86_400_000);
    const dia = horaLocal(fecha, negocio.zona).dia;
    const desde = k === 0 ? ahora.min + (negocio.reservas.anticipacion_min ?? 30) : -1;
    if (!horasDelDia(negocio.horario || [], dia, negocio.reservas.paso_min || 30, 30, desde).length) continue;
    out.push({ iso: fmt.format(fecha), dia, desde, etiqueta: k === 0 ? "Hoy" : k === 1 ? "Mañana" : nombre.format(fecha) });
  }
  return out;
}

// Mesa: día, hora y personas, con una tarjeta de resumen en vivo (dale la forma de la tarjeta física de sus mesas).
function pintarReservaMesa(cont) {
  const r = negocio.reservas;
  const dias = proximosDias(r.dias_adelante || 7);
  const horas = h("div", { class: "reserva-horas", role: "radiogroup", "aria-label": "Hora" });
  const personas = h("input", { type: "number", name: "personas", min: 1, max: r.max_personas || 20, value: r.personas_inicial || 2, inputmode: "numeric" });
  const tarjeta = h("output", { class: "reserva-tarjeta", "data-reserva-tarjeta": true, "aria-live": "polite" });
  const radios = (nombre, opciones, onchange) => opciones.map((o, i) => h("label", { class: "chip" },
    h("input", { type: "radio", name: nombre, value: o.valor, checked: i === 0, required: true, onchange }), o.texto));
  const pintarHoras = () => {
    const dia = dias.find((d) => d.iso === form.elements.fecha?.value) || dias[0];
    horas.replaceChildren(...radios("hora", horasDelDia(negocio.horario, dia?.dia ?? -1, r.paso_min || 30, 30, dia?.desde ?? -1).map((x) => ({ valor: x, texto: hora12(x) }))));
  };
  const paso = (d) => { personas.value = Math.min(Number(personas.max), Math.max(1, Number(personas.value) + d)); actualizar(); };
  const form = h("form", { class: "reserva-form", "data-reserva-form": true },
    h("fieldset", {}, h("legend", {}, "Día"), h("div", { class: "reserva-dias", role: "radiogroup" },
      radios("fecha", dias.map((d) => ({ valor: d.iso, texto: d.etiqueta })), () => { pintarHoras(); actualizar(); }))),
    h("fieldset", {}, h("legend", {}, "Hora"), horas),
    h("fieldset", { class: "reserva-personas" }, h("legend", {}, "Personas"),
      h("button", { type: "button", "aria-label": "Una persona menos", onclick: () => paso(-1) }, "−"), personas,
      h("button", { type: "button", "aria-label": "Una persona más", onclick: () => paso(1) }, "+")),
    (r.pide || []).map(campoFormulario),
    tarjeta,
    botonesEnvio(r.boton || "Reservar por WhatsApp", "reserva-enviar", "Reservar por Instagram"));
  const datos = () => Object.fromEntries(new FormData(form));
  const actualizar = () => {
    const d = datos();
    const dia = dias.find((x) => x.iso === d.fecha);
    const texto = d.hora ? `Mesa para ${d.personas} · ${dia?.etiqueta ?? d.fecha} · ${hora12(d.hora)}` : "Elige una hora";
    tarjeta.textContent = texto;
    emitir("reserva:cambio", { datos: d, texto });
  };
  form.addEventListener("input", actualizar);
  // lo que ya está en el carrito viaja con la reserva como pedido adelantado
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const r = { ...datos(), lineas: r_adelanto(), turno: turno?.nombre };
    enviar(armarMensajeReserva(negocio, r, datos()), e.submitter?.value);
  });
  if (!dias.length) return void cont.append(h("p", {}, "Escríbenos por WhatsApp para reservar."));
  cont.append(form);
  pintarHoras();
  actualizar();
}

const r_adelanto = () => (negocio.reservas?.adelantar === false ? [] : lineas.map((l) => ({ ...l })));

// Por hora con precio según su tarifa (canchas, salas, estudios).
function pintarReservaPorHora(cont) {
  const r = negocio.reservas;
  const precio = h("output", { class: "reserva-precio", "aria-live": "polite" }, "—");
  const hoy = new Date().toISOString().slice(0, 10);
  const form = h("form", { class: "reserva-form", "data-reserva-form": true },
    r.opciones?.length ? h("label", {}, r.recurso, h("select", { name: "opcion" }, r.opciones.map((o) => h("option", {}, o)))) : null,
    h("label", {}, "Fecha", h("input", { type: "date", name: "fecha", min: hoy, value: hoy, required: true })),
    h("label", {}, "Hora", h("input", { type: "time", name: "hora", step: 1800, value: "18:00", required: true })),
    h("label", {}, "Duración", h("select", { name: "minutos" }, r.duraciones.map((m) => h("option", { value: m }, `${m} min`)))),
    (r.pide || []).map(campoFormulario),
    h("p", {}, "Precio: ", precio),
    botonesEnvio(r.boton || "Reservar por WhatsApp", "reserva-enviar", "Reservar por Instagram"));
  const datos = () => { const d = Object.fromEntries(new FormData(form)); return { ...d, minutos: Number(d.minutos) }; };
  const actualizar = () => {
    const d = datos();
    const p = d.fecha && d.hora ? precioReserva(r, d.fecha, d.hora, d.minutos) : null;
    precio.textContent = p === null ? "Fuera de horario" : dinero(p, negocio.moneda);
    form.querySelectorAll("[type=submit]").forEach((b) => { b.disabled = p === null; });
  };
  form.addEventListener("input", actualizar);
  form.addEventListener("submit", (e) => { e.preventDefault(); enviar(armarMensajeReserva(negocio, datos(), datos()), e.submitter?.value); });
  cont.append(form);
  actualizar();
}

// ---------- formularios de informes / inscripción ----------
// Conserva los campos que el negocio ya pedía (su web vieja, su DM de siempre); solo cambia a dónde llegan.
function pintarFormulario(el) {
  const def = (negocio.formularios || []).find((f) => f.id === el.dataset.formulario);
  if (!def) return console.error(`negocio.json no tiene formularios[] con id "${el.dataset.formulario}"`);
  el.classList.add("formulario");
  el.append(...def.campos.map(campoFormulario), h("button", { type: "submit", value: "whatsapp" }, def.boton || "Enviar por WhatsApp"));
  activarCondicionales(el, def.campos);
  el.addEventListener("submit", (e) => {
    e.preventDefault();
    enviar(armarMensajeFormulario(negocio, def, Object.fromEntries(new FormData(el))), e.submitter?.value);
  });
}

// ---------- arranque ----------
async function iniciar() {
  try {
    negocio = await (await fetch("negocio.json")).json();
  } catch (err) {
    console.error("No pude leer negocio.json", err);
    document.querySelectorAll("[data-carta], [data-reservas]").forEach((c) =>
      c.append(h("p", { role: "alert" }, "No pudimos cargar la carta. Escríbenos por WhatsApp.")));
    return;
  }
  iniciarTurnos();
  const carta = document.querySelector("[data-carta]");
  const carrito = document.querySelector("[data-carrito]");
  const reservas = document.querySelector("[data-reservas]");
  if (carta) pintarCarta(carta);
  if (carrito && negocio.pedidos?.activo) pintarCarrito(carrito);
  if (reservas && negocio.reservas?.activo) pintarReservas(reservas);
  document.querySelectorAll("[data-estado]").forEach(pintarEstado);
  document.querySelectorAll("[data-formulario]").forEach(pintarFormulario);
  if (negocio.vendedor?.whatsapp) document.querySelectorAll("[data-dueno]").forEach((a) => {
    const v = negocio.vendedor;
    a.href = urlWhatsApp(v.whatsapp, (v.mensaje || "Hola, soy de {negocio} y quiero esta web.").replaceAll("{negocio}", negocio.nombre));
    a.target = "_blank"; a.rel = "noopener";
    a.textContent ||= v.texto || "¿Eres el dueño? Quiero esta web";
    a.hidden = false;
  });
  if (PRUEBA) document.documentElement.dataset.prueba = "";
  emitir("negocio:listo", { negocio });
}

iniciar();
