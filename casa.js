// El recorrido por la casa: el ticket del pick up y los ajustes plegados de cada bebida.
// Escucha los eventos de pedido.js; no toca precios ni mensajes (eso vive en pedido-core.js).
const $ = (s, el = document) => el.querySelector(s);

// Cada vez que agregas algo, el contador (un vaso) brinca.
document.addEventListener("carrito:cambio", () => {
  const vaso = $(".carrito summary");
  vaso?.classList.remove("brinca");
  void vaso?.offsetWidth;
  vaso?.classList.add("brinca");
});

document.addEventListener("negocio:listo", () => {
  const titulo = $(".carrito summary span");
  if (titulo) titulo.textContent = "Tu ticket";
  // en desktop el ticket vive abierto junto a la barra
  const panel = $(".carrito");
  const ancho = matchMedia("(min-width: 1024px)");
  if (panel) {
    panel.open = ancho.matches;
    ancho.addEventListener("change", (e) => { panel.open = e.matches; });
    $("summary", panel).addEventListener("click", (e) => { if (ancho.matches) e.preventDefault(); });
  }
  const carta = $("[data-carta]");
  personalizar(carta);
  new MutationObserver(() => personalizar(carta)).observe(carta, { childList: true, subtree: true });
});

// Jarabe, avena y foam van plegados: un botón por producto los abre (la carta queda limpia en el pulgar).
function personalizar(carta) {
  carta.querySelectorAll(".item:not([data-plegable])").forEach((item) => {
    item.dataset.plegable = "";
    const variantes = $(".item-variantes", item);
    if (!variantes) return;
    variantes.id = `var-${item.dataset.item}`;
    const nombres = [...variantes.querySelectorAll("legend")].map((l) => l.textContent.split(" ·")[0].toLowerCase());
    const extras = [...variantes.querySelectorAll(":scope > .chip input")].map((i) => i.value);
    if (extras.some((x) => x.startsWith("Jarabe"))) nombres.push("jarabe, avena o foam");
    else nombres.push(...extras.map((x) => x.toLowerCase()));
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "item-ajustes";
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", variantes.id);
    const texto = nombres.join(" · ");
    btn.textContent = texto[0].toUpperCase() + texto.slice(1);
    btn.setAttribute("aria-label", `${btn.textContent} para ${$(".item-nombre", item).textContent}`);
    btn.addEventListener("click", () => {
      const abierto = item.classList.toggle("abierto");
      btn.setAttribute("aria-expanded", String(abierto));
    });
    variantes.before(btn);
  });
}
