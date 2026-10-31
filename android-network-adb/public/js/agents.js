/* Página inicial: agentes conectados + mapa de capacidades. */
(() => {
  const agentsEl = document.querySelector("#agents");
  const agentCountEl = document.querySelector("#agent-count");
  const agentUrlEl = document.querySelector("#agent-url");
  const agentTokenEl = document.querySelector("#agent-token");
  const copyTokenBtn = document.querySelector("#copy-token");
  const copyLinkBtn = document.querySelector("#copy-link");
  const agentHintEl = document.querySelector("#agent-hint");
  const refreshBtn = document.querySelector("#refresh");
  const capsEl = document.querySelector("#capabilities");
  const statusEl = document.querySelector("#agent-status");

  let agents = [];
  let agentToken = "";
  let lastMessageAt = 0;

  function message(text, cls = "info") {
    if (!statusEl) return;
    lastMessageAt = Date.now();
    statusEl.textContent = text;
    statusEl.className = `status status-${cls}`;
  }

  async function queueAgentCommand(id, command) {
    try {
      const r = await fetch(`/api/agents/${encodeURIComponent(id)}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agent-token": agentToken },
        body: JSON.stringify({ command }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      message(`Comando enfileirado (${command}). A box responde no próximo heartbeat.`, "ok");
    } catch (e) {
      message(`Falha ao enviar comando: ${e.message}`, "error");
    }
  }

  async function removeAgent(id, name) {
    if (!confirm(`Remover ${name} da lista?\nSe a página do agente continuar aberta, ele volta a aparecer.`)) return;
    try {
      const r = await fetch(`/api/agents/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "x-agent-token": agentToken },
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      message(`${name} removido da lista.`, "ok");
      await fetchAgents();
    } catch (e) {
      message(`Falha ao remover: ${e.message}`, "error");
    }
  }

  function actionButton(label, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-secondary";
    btn.textContent = label;
    btn.onclick = onClick;
    return btn;
  }

  function renderAgents() {
    if (agentCountEl) agentCountEl.textContent = agents.length;
    if (!agentsEl) return;
    if (!agents.length) {
      agentsEl.innerHTML =
        '<div class="empty">Nenhum agente conectado ainda.<br>Abra a URL do agente no navegador da box.</div>';
      return;
    }
    agentsEl.replaceChildren();
    for (const a of agents) {
      const card = document.createElement("div");
      card.className = "agent-card" + (a.online ? " online" : " offline");

      const top = document.createElement("div");
      top.className = "agent-top";
      const dot = document.createElement("span");
      dot.className = "agent-dot";
      const name = document.createElement("span");
      name.className = "agent-name";
      name.textContent = a.model || a.name || a.ip || a.id;
      const state = document.createElement("span");
      state.className = "agent-state";
      state.textContent = a.online ? "online" : "offline";
      top.append(dot, name, state);

      const sub = document.createElement("div");
      sub.className = "agent-sub";
      sub.textContent = [a.ip, a.android ? `Android ${a.android}` : "", a.platform]
        .filter(Boolean)
        .join("  ·  ");

      const sub2 = document.createElement("div");
      sub2.className = "agent-sub";
      sub2.textContent = [
        a.screen || "",
        a.language || "",
        a.appVersion ? `agente v${a.appVersion}` : "",
        `visto ${AN.relativeTime(a.lastSeen)}`,
      ]
        .filter(Boolean)
        .join("  ·  ");

      card.append(top, sub, sub2);

      if (a.userAgent) {
        const ua = document.createElement("div");
        ua.className = "agent-ua";
        ua.textContent = a.userAgent;
        card.append(ua);
      }

      const actions = document.createElement("div");
      actions.className = "agent-actions";
      actions.append(
        actionButton("Pedir info", () => queueAgentCommand(a.id, "info")),
        actionButton("Ambiente", () => queueAgentCommand(a.id, "env")),
        actionButton("Abrir site", () => {
          const url = prompt("URL http(s) para abrir na box:", "https://");
          if (url && /^https?:\/\//i.test(url)) queueAgentCommand(a.id, `open ${url}`);
          else if (url) message("A URL precisa começar com http:// ou https://", "error");
        }),
        actionButton("Remover", () => removeAgent(a.id, name.textContent)),
      );
      card.append(actions);

      if (a.lastResult) {
        const res = document.createElement("pre");
        res.className = "agent-result";
        res.textContent = `> ${a.lastResult.command} (${AN.formatTime(a.lastResult.ts)})\n${a.lastResult.output}`;
        card.append(res);
      }

      agentsEl.append(card);
    }
  }

  async function fetchAgents() {
    try {
      const r = await fetch("/api/agents");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      agents = data.agents || [];
      if (data.token) agentToken = data.token;
      renderAgents();

      if (agentUrlEl && data.lanAddress && data.port) {
        const base = `http://${data.lanAddress}:${data.port}/agent`;
        agentUrlEl.textContent = data.token ? `${base}?token=${data.token}` : base;
      }
      if (agentTokenEl) {
        agentTokenEl.textContent = data.token || "abra o painel em localhost";
        if (data.token && agentHintEl) agentHintEl.style.display = "none";
      }
      if (refreshBtn) refreshBtn.disabled = false;

      if (statusEl && Date.now() - lastMessageAt > 4000) {
        const online = agents.filter((a) => a.online).length;
        statusEl.textContent = `${online} online de ${agents.length} agente(s) · atualizado ${AN.formatTime(
          new Date().toISOString(),
        )}`;
        statusEl.className = "status status-info";
      }
    } catch (e) {
      if (agentHintEl) agentHintEl.textContent = `Não foi possível ler o estado dos agentes: ${e.message}`;
    }
  }

  if (copyTokenBtn) {
    copyTokenBtn.onclick = () => {
      const token = agentTokenEl ? agentTokenEl.textContent.trim() : "";
      if (token.startsWith("abra")) return;
      AN.copyText(token, "Token", message);
    };
  }

  if (copyLinkBtn) {
    copyLinkBtn.onclick = () => AN.copyText(agentUrlEl ? agentUrlEl.textContent.trim() : "", "Link do agente", message);
  }

  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = `${AN.SPINNER_SVG} Atualizando…`;
      await fetchAgents();
      refreshBtn.innerHTML = "↻ Atualizar";
      refreshBtn.disabled = false;
    };
  }

  AN.initLogs({
    logsEl: document.querySelector("#logs"),
    countEl: document.querySelector("#log-count"),
    clearBtn: document.querySelector("#clear-logs"),
  });

  fetchAgents();
  AN.loadCapabilities(capsEl, { onlyPrimary: true });
  setInterval(fetchAgents, 3000);
})();
