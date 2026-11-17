// Nada aparece de golpe: los [data-entra] se revelan al entrar en pantalla, en cascada por grupo.
// Usa data-entra="N" para el orden dentro de un grupo (retraso N × 60 ms).
const vistos = new IntersectionObserver((entradas) => {
  for (const e of entradas) {
    if (!e.isIntersecting) continue;
    e.target.style.transitionDelay = `${Number(e.target.dataset.entra || 0) * 60}ms`;
    e.target.classList.add("visible");
    vistos.unobserve(e.target);
  }
}, { rootMargin: "0px 0px -10% 0px" });

const observar = () => document.querySelectorAll("[data-entra]:not(.visible)").forEach((el) => vistos.observe(el));
observar();
document.addEventListener("negocio:listo", observar); // la carta se pinta después
