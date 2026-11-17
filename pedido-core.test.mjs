import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { turnoActual, cartaDelTurno, validarOpciones, campoAplica, armarMensajeFormulario, horasDelDia, buscarEnCarta, urlInstagram, armarMensajePedido, armarMensajeReserva, precioReserva, urlWhatsApp, dinero, estadoAbierto, hora12, horaLocal } from "./pedido-core.js";

const negocio = JSON.parse(readFileSync(new URL("./negocio.ejemplo.json", import.meta.url)));

// pedido con opción y extra
const msg = armarMensajePedido(negocio, [
  { id: "latte-vainilla", cantidad: 2, extras: ["Leche vegetal"], opciones: { Leche: "Avena" } },
  { id: "espresso", cantidad: 1 },
], { nombre: "Ana", modo: "Recojo en el local" });
assert.match(msg, /^Hola Bruselas 🌿 Quiero hacer un pedido:/);
assert.match(msg, /☕ 2x Latte Vainilla \(Avena, Leche vegetal\) — S\/ 35/);
assert.match(msg, /Total: S\/ 43/);
assert.match(msg, /Nombre: Ana/);
assert.doesNotMatch(msg, /Dirección/); // recojo: no se pide dirección
const delivery = armarMensajePedido(negocio, [{ id: "espresso", cantidad: 1 }], { nombre: "Ana", modo: "Delivery", direccion: "Av. Larco 1", notas: "  " });
assert.match(delivery, /Dirección: Av\. Larco 1/);
assert.doesNotMatch(delivery, /Notas/); // vacío no se manda
assert.throws(() => armarMensajePedido(negocio, [{ id: "no-existe", cantidad: 1 }]));

// horario
assert.equal(hora12("13:00"), "1 pm");
assert.equal(hora12("08:30"), "8:30 am");
assert.equal(hora12("00:00"), "12 am");
const h = negocio.horario; // L-V 08–13, sáb 09–14
assert.equal(estadoAbierto(h, { dia: 1, min: 10 * 60 }).texto, "Abierto ahora · hasta la 1 pm");
assert.equal(estadoAbierto(h, { dia: 1, min: 14 * 60 }).texto, "Cerrado · abre mañana a las 8 am");
assert.equal(estadoAbierto(h, { dia: 1, min: 6 * 60 }).texto, "Cerrado · abre hoy a las 8 am");
assert.equal(estadoAbierto(h, { dia: 6, min: 15 * 60 }).texto, "Cerrado · abre el lunes a las 8 am");
const noche = [{ dias: [5, 6], abre: "18:00", cierra: "02:00" }]; // bar que pasa la medianoche
assert.equal(estadoAbierto(noche, { dia: 0, min: 60 }).abierto, true); // domingo 1 am = sábado de noche
assert.equal(estadoAbierto(noche, { dia: 6, min: 60 }).abierto, true); // sábado 1 am = viernes de noche
assert.equal(estadoAbierto(noche, { dia: 0, min: 3 * 60 }).texto, "Cerrado · abre el viernes a las 6 pm");
assert.deepEqual(horaLocal(new Date("2026-10-19T15:30:00Z"), "America/Lima"), { dia: 1, min: 10 * 60 + 30 });

// reserva que cruza de tarifa normal a hora punta (lunes 2026-10-19, 17:30–18:30)
assert.equal(precioReserva(negocio.reservas, "2026-10-19", "17:30", 60), 40 / 2 + 60 / 2);
assert.equal(precioReserva(negocio.reservas, "2026-10-19", "03:00", 60), null);
assert.match(armarMensajeReserva(negocio, { fecha: "2026-10-19", hora: "18:00", minutos: 90 }), /Precio: S\/ 90/);

assert.equal(dinero(3.5, negocio.moneda), "S/ 3.50");

// recojo lleva la dirección del local; cierre opcional
const recojo = armarMensajePedido({ ...negocio, pedidos: { ...negocio.pedidos, cierre: "¿A qué hora lo puedo recoger?" } },
  [{ id: "espresso", cantidad: 1 }], { modo: "Recojo en el local" });
assert.match(recojo, /Entrega: Recojo en el local \(Calle Ejemplo 123, Ciudad\)/);
assert.match(recojo, /¿A qué hora lo puedo recoger\?$/);

// reserva de mesa: personas, sin precio
const mesa = { ...negocio, reservas: { tipo: "mesa", max_personas: 8, pide: negocio.reservas.pide } };
assert.match(armarMensajeReserva(mesa, { fecha: "2026-10-22", hora: "19:30", personas: 3 }, { nombre: "Ana" }), /Mesa para 3\nFecha: 2026-10-22 · 19:30\nNombre: Ana/);
assert.throws(() => armarMensajeReserva(mesa, { fecha: "2026-10-22", hora: "19:30", personas: 12 }));
assert.deepEqual(horasDelDia([{ dias: [3], abre: "19:00", cierra: "20:30" }], 3), ["19:00", "19:30", "20:00"]);
assert.deepEqual(horasDelDia([{ dias: [3], abre: "19:00", cierra: "20:30" }], 4), []);
assert.deepEqual(horasDelDia([{ dias: [3], abre: "19:00", cierra: "20:30" }], 3, 30, 30, 19 * 60 + 10), ["19:30", "20:00"]); // hoy, ya son 7:10 pm

// buscador sin tildes
assert.equal(buscarEnCarta(negocio.carta, "LATTE vainilla")[0].items[0].id, "latte-vainilla");
assert.equal(buscarEnCarta(negocio.carta, "espresso bar").flatMap((x) => x.items).length, 3); // por sección
assert.equal(buscarEnCarta(negocio.carta, "zzz").length, 0);
// arma tu poke: tamaño con precio, base elige 1, proteínas 1–2, vegetales hasta 3
const poke = { nombre: "Duck Poke", moneda: negocio.moneda, pedidos: {}, carta: [{ seccion: "Pokes", items: [{
  id: "poke", nombre: "Poke", precio: 24, emoji: "🦆", opciones: [
    { nombre: "Tamaño", valores: ["Regular 1000 ml", { nombre: "Grande 1300 ml", precio: 4 }] },
    { nombre: "Base", valores: ["Arroz sushi", "Mix de lechugas"] },
    { nombre: "Proteína", valores: ["Atún shoyu", "Pollo", { nombre: "Langostinos", precio: 3 }], min: 1, max: 2 },
    { nombre: "Vegetales", valores: ["Palta", "Pepinillo", "Choclo", "Nabo"], max: 3 }] }] }] };
const item = poke.carta[0].items[0];
const sel = { Tamaño: "Grande 1300 ml", Base: "Arroz sushi", Proteína: ["Atún shoyu", "Langostinos"], Vegetales: ["Palta"] };
assert.equal(validarOpciones(item, sel), null);
assert.equal(validarOpciones(item, { ...sel, Proteína: [] }), "Elige al menos 1 en proteína");
assert.equal(validarOpciones(item, { ...sel, Base: undefined }), "Elige base");
assert.equal(validarOpciones(item, { ...sel, Vegetales: ["Palta", "Pepinillo", "Choclo", "Nabo"] }), "Máximo 3 en vegetales");
const mp = armarMensajePedido(poke, [{ id: "poke", cantidad: 1, opciones: sel }]);
assert.match(mp, /🦆 1x Poke — S\/ 31\n   Tamaño: Grande 1300 ml\n   Base: Arroz sushi\n   Proteína: Atún shoyu, Langostinos\n   Vegetales: Palta/);
assert.match(mp, /Total: S\/ 31/);

// campos condicionales genéricos: RUC solo con factura
const ruc = { id: "ruc", etiqueta: "RUC", si: { campo: "comprobante", valor: "Factura" } };
assert.equal(campoAplica(ruc, { comprobante: "Boleta" }), false);
assert.equal(campoAplica(ruc, { comprobante: "Factura" }), true);

// turnos día / noche
const turnos = [{ id: "dia", nombre: "Almuerzo", dias: [1, 2, 3, 4, 5, 6], abre: "12:00", cierra: "15:30" },
  { id: "noche", nombre: "Noche", dias: [1, 2, 3, 4, 5, 6], abre: "18:30", cierra: "23:00" }];
assert.equal(turnoActual(turnos, { dia: 3, min: 13 * 60 }).id, "dia");
assert.equal(turnoActual(turnos, { dia: 3, min: 19 * 60 + 30 }).enCurso, true);
assert.equal(turnoActual(turnos, { dia: 3, min: 16 * 60 }).id, "noche"); // entre turnos: el próximo
assert.equal(turnoActual(turnos, { dia: 3, min: 16 * 60 }).enCurso, false);
assert.equal(turnoActual(turnos, { dia: 0, min: 13 * 60 }).id, "dia"); // domingo cerrado: lunes al mediodía
const cartaT = [{ seccion: "Almuerzo", turno: "dia", items: [{ id: "a" }] }, { seccion: "Bebidas", items: [{ id: "b" }, { id: "c", turno: "noche" }] }];
assert.deepEqual(cartaDelTurno(cartaT, "noche").map((x) => x.items.map((i) => i.id)), [["b", "c"]]);
assert.deepEqual(cartaDelTurno(cartaT, "dia").map((x) => x.items.map((i) => i.id)), [["a"], ["b"]]);

// reserva de mesa con pedido adelantado
const conAdelanto = armarMensajeReserva(mesa, { fecha: "2026-10-21", hora: "20:00", personas: 2, turno: "noche",
  lineas: [{ id: "espresso", cantidad: 2 }] }, { nombre: "Ana" });
assert.match(conAdelanto, /Fecha: 2026-10-21 · 20:00 \(noche\)/);
assert.match(conAdelanto, /Quiero adelantar:\n☕ 2x Espresso — S\/ 16\nReferencial: S\/ 16$/);

// formulario de informes (gimnasio)
const gym = { nombre: "Planet", formularios: [{ id: "informes", saludo: "Hola {negocio} 👋 Quiero información para empezar a entrenar:",
  campos: [{ id: "nombre", etiqueta: "Nombre", requerido: true }, { id: "whatsapp", etiqueta: "WhatsApp", tipo: "tel", requerido: true },
    { id: "objetivo", etiqueta: "Objetivo", tipo: "select", opciones: ["Bajar de peso", "Aumentar masa"] }] }] };
assert.equal(armarMensajeFormulario(gym, gym.formularios[0], { nombre: "Ana", whatsapp: "999", objetivo: "Aumentar masa" }),
  "Hola Planet 👋 Quiero información para empezar a entrenar:\n\nNombre: Ana\nWhatsApp: 999\nObjetivo: Aumentar masa");
assert.throws(() => armarMensajeFormulario(gym, gym.formularios[0], { nombre: "Ana" }), /WhatsApp/);
assert.equal(urlInstagram("@jersey.coffee"), "https://ig.me/m/jersey.coffee");
assert.throws(() => urlInstagram("no válido/"));
assert.throws(() => urlWhatsApp("", "x"));
assert.ok(urlWhatsApp("+51 999 111 222", "hola mundo").endsWith("51999111222?text=hola%20mundo"));
console.log("✓ pedido-core ok");
