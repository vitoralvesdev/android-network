/* Utilitários compartilhados entre as páginas. */
window.AN = (() => {
  const SPINNER_SVG = `<svg class="spinner" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5"
    stroke-linecap="round" stroke-dasharray="40 20" transform-origin="center">
    <animateTransform attributeName="transform" type="rotate"
      from="0" to="360" dur="0.8s" repeatCount="indefinite"/>
  </circle>
</svg>`;

  function formatTime(iso) {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function relativeTime(iso) {
    const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
    if (s < 5) return "agora";
    if (s < 60) return `há ${s}s`;
    const m = Math.round(s / 60);
    if (m < 60) return `há ${m}min`;
    return `há ${Math.round(m / 60)}h`;
  }

  async function copyText(text, label, onMessage = () => {}) {
    if (!text || text === "—") return;
    try {
      await navigator.clipboard.writeText(text);
      onMessage(`${label} copiado.`, "success");
    } catch {
      onMessage(`Copie manualmente: ${text}`, "warn");
    }
  }

  function initLogs({ logsEl, countEl, clearBtn }) {
    if (!logsEl) return;
    let entries = [];
    logsEl.innerHTML = '<div class="logs-empty">Aguardando logs…</div>';

    const add = (entry) => {
      entries.push(entry);
      logsEl.querySelector(".logs-empty")?.remove();
      const row = document.createElement("div");
      row.className = `log-entry log-${entry.level}`;
      const ts = document.createElement("span");
      ts.className = "log-ts";
      ts.textContent = formatTime(entry.ts);
      const msg = document.createElement("span");
      msg.className = "log-msg";
      msg.textContent = entry.msg;
      row.append(ts, msg);
      logsEl.append(row);
      logsEl.scrollTop = logsEl.scrollHeight;
      if (countEl) {
        countEl.textContent = `${entries.length} entrada${entries.length === 1 ? "" : "s"}`;
      }
    };

    const es = new EventSource("/api/logs");
    es.onmessage = (ev) => {
      try {
        add(JSON.parse(ev.data));
      } catch {
        /* evento inválido */
      }
    };
    es.onerror = () =>
      add({ ts: new Date().toISOString(), level: "warn", msg: "SSE desconectado, reconectando…" });

    if (clearBtn) {
      clearBtn.onclick = () => {
        entries = [];
        logsEl.innerHTML = '<div class="logs-empty">Logs limpos.</div>';
        if (countEl) countEl.textContent = "0 entradas";
      };
    }
  }

  return { SPINNER_SVG, formatTime, relativeTime, copyText, initLogs };
})();
