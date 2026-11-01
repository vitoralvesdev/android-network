/* Renderiza o mapa de capacidades (/api/capabilities) em qualquer página. */
(() => {
  function render(el, data, { onlyPrimary = false } = {}) {
    if (!el) return;
    el.replaceChildren();

    const runtime = document.createElement("div");
    runtime.className = "caps-runtime";
    runtime.textContent = [
      `versão ${data.version}`,
      data.runtime?.lanAddress ? `LAN ${data.runtime.lanAddress}:${data.runtime.port}` : "",
      "API restrita ao localhost",
    ]
      .filter(Boolean)
      .join("  ·  ");
    el.append(runtime);

    for (const area of data.areas || []) {
      if (onlyPrimary && !area.primary) continue;
      const section = document.createElement("section");
      section.className = "caps-area" + (area.primary ? " caps-primary" : "");

      const head = document.createElement("div");
      head.className = "caps-head";
      const h3 = document.createElement("h3");
      h3.textContent = area.title;
      head.append(h3);
      if (area.primary) {
        const badge = document.createElement("span");
        badge.className = "caps-badge";
        badge.textContent = "foco atual";
        head.append(badge);
      }
      section.append(head);

      const summary = document.createElement("p");
      summary.className = "caps-summary";
      summary.textContent = area.summary;
      section.append(summary);

      for (const cap of area.capabilities) {
        const row = document.createElement("div");
        row.className = "caps-item";

        const title = document.createElement("div");
        title.className = "caps-title";
        title.textContent = cap.title;
        row.append(title);

        const desc = document.createElement("div");
        desc.className = "caps-desc";
        desc.textContent = cap.description;
        row.append(desc);

        const chips = document.createElement("div");
        chips.className = "caps-chips";
        if (cap.entry) {
          const link = document.createElement("a");
          link.className = "caps-chip caps-link";
          link.href = cap.entry;
          link.textContent = cap.entry;
          chips.append(link);
        }
        for (const cmd of cap.commands || []) {
          const chip = document.createElement("code");
          chip.className = "caps-chip";
          chip.textContent = cmd;
          chips.append(chip);
        }
        for (const ep of cap.endpoints || []) {
          const chip = document.createElement("code");
          chip.className = "caps-chip caps-endpoint";
          chip.textContent = ep;
          chips.append(chip);
        }
        if (chips.childElementCount) row.append(chips);

        section.append(row);
      }

      el.append(section);
    }
  }

  async function load(el, options = {}, onError) {
    if (!el) return;
    try {
      const r = await fetch("/api/capabilities");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      render(el, await r.json(), options);
    } catch (e) {
      el.innerHTML = `<div class="empty">Não foi possível carregar o mapa: ${e.message}</div>`;
    }
  }

  window.AN = window.AN || {};
  AN.renderCapabilities = render;
  AN.loadCapabilities = load;

  const mapEl = document.querySelector("#capabilities-map");
  if (mapEl) load(mapEl);
})();
