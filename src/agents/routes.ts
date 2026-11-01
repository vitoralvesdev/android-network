import { Router } from "express";
import { lanIPv4 } from "../core/network.js";
import { logInfo } from "../core/log.js";
import { clientAddress, isLocalRequest } from "../core/security.js";
import { AGENT_TOKEN, PORT } from "../core/settings.js";
import { cleanMultiline, cleanText } from "../core/text.js";
import { agents, AGENT_ONLINE_MS, cleanAgentId, publicAgent, upsertAgent } from "./registry.js";

const router = Router();

router.post("/api/agent/register", (req, res) => {
  const rec = upsertAgent((req.body ?? {}) as Record<string, unknown>, clientAddress(req));
  res.json({ ok: true, id: rec.id, serverTime: new Date().toISOString() });
});

router.post("/api/agent/heartbeat", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const id = cleanAgentId(body.id);
  if (!id) {
    res.status(400).json({ ok: false, error: "id inválido" });
    return;
  }
  const rec = upsertAgent(body, clientAddress(req));
  const commands = rec.commands.splice(0, rec.commands.length);
  res.json({ ok: true, id: rec.id, serverTime: new Date().toISOString(), commands });
});

router.post("/api/agent/result", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const id = cleanAgentId(body.id);
  const rec = id ? agents.get(id) : undefined;
  if (!rec) {
    res.status(404).json({ ok: false, error: "agente não encontrado" });
    return;
  }
  const command = cleanText(body.command, 120) ?? "?";
  const output = cleanMultiline(body.output, 4000) ?? "";
  rec.lastResult = { ts: new Date().toISOString(), command, output };
  rec.lastSeen = new Date().toISOString();
  logInfo(`Agente ${rec.model ?? rec.name ?? id}: ${command} -> ${output.replace(/\s+/g, " ").slice(0, 160)}`);
  res.json({ ok: true });
});

router.get("/api/agents", (req, res) => {
  res.json({
    agents: [...agents.values()].map(publicAgent),
    onlineMs: AGENT_ONLINE_MS,
    token: isLocalRequest(req) ? AGENT_TOKEN : undefined,
    agentPath: "/agent",
    lanAddress: lanIPv4(),
    port: PORT,
  });
});

router.post("/api/agents/:id/command", (req, res) => {
  const id = cleanAgentId(req.params.id);
  const rec = id ? agents.get(id) : undefined;
  if (!rec) {
    res.status(404).json({ ok: false, error: "agente não encontrado" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const cmd = cleanText(body.command, 200);
  if (!cmd || !/^(info|env|open\s+https?:\/\/\S+)$/i.test(cmd)) {
    res.status(400).json({ ok: false, error: "Comandos permitidos: info, env ou open <url http(s)>." });
    return;
  }
  rec.commands.push(cmd);
  res.json({ ok: true, queued: cmd });
});

router.delete("/api/agents/:id", (req, res) => {
  const id = cleanAgentId(req.params.id);
  if (id) agents.delete(id);
  res.json({ ok: true });
});

export const agentsRouter = router;
