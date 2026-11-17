// Pedido real de Casa Boru: precios de su carta (destacada MENÚ) y mensaje para el DM.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { armarMensajePedido, estadoAbierto, urlInstagram, validarOpciones, buscarItem } from "./pedido-core.js";

const negocio = JSON.parse(readFileSync(new URL("./negocio.json", import.meta.url)));
const msg = armarMensajePedido(negocio, [
  { id: "latte-frio", cantidad: 2, opciones: {}, extras: ["Jarabe vainilla", "Leche de avena OATLY!"] },
  { id: "santo-pesto", cantidad: 1, opciones: { Pan: "Focaccia" }, extras: [] },
], { nombre: "Ana", hora: "10:30" });
assert.match(msg, /^Hola Boru 🫂 Quiero pedir para pick up en el 56:/);
assert.doesNotMatch(msg, /credencial|socio|sello/i);
assert.match(msg, /A nombre de: Ana/);
assert.match(msg, /🧊 2x Latte \(Jarabe vainilla, Leche de avena OATLY!\) — \$ 208/); // (80+12+12)×2
assert.match(msg, /🥪 1x Santo Pesto \(Focaccia\) — \$ 125/);
assert.match(msg, /Total: \$ 333/);
assert.equal(validarOpciones(buscarItem(negocio.carta, "latte-frio"), {}), null);
assert.equal(urlInstagram(negocio.usuario_ig), "https://ig.me/m/casaboru");
assert.equal(estadoAbierto(negocio.horario, { dia: 6, min: 15 * 60 }).texto, "Cerrado · abre el lunes a las 8:30 am");
assert.equal(estadoAbierto(negocio.horario, { dia: 2, min: 9 * 60 }).texto, "Abierto ahora · hasta las 6 pm");
const ids = negocio.carta.flatMap((s) => s.items.map((i) => i.id));
assert.equal(new Set(ids).size, ids.length, "ids repetidos en la carta");
console.log("✓ boru:", ids.length, "productos");
