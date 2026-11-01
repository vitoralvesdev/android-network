import { Router } from "express";
import { agents, publicAgent } from "../agents/registry.js";
import { VERSION } from "../core/settings.js";
import { scanState, startScan } from "./scan.js";

const router = Router();

type AgentPublic = ReturnType<typeof publicAgent>;

function agentSummary(a: AgentPublic) {
  return {
    id: a.id,
    online: a.online,
    model: a.model,
    android: a.android,
    screen: a.screen,
    appVersion: a.appVersion,
    lastSeen: a.lastSeen,
  };
}

function mergedGroups(agentList: AgentPublic[]) {
  const byIp = new Map(agentList.map((a) => [a.ip, a]));
  const groups = scanState.groups.map((g) => {
    const agent = byIp.get(g.ip);
    return agent ? { ...g, agent: agentSummary(agent) } : g;
  });

  for (const u of scanState.usbAdb) {
    if (u.ip && groups.some((g) => g.ip === u.ip)) continue;
    if (groups.some((g) => g.ip === u.serial)) continue;
    groups.push({
      ip: u.serial,
      name: u.model || u.serial,
      kind: "android" as const,
      model: u.model,
      adbEndpoint: u.serial,
      adbState: u.state,
      connections: [{ protocol: "ADB USB", state: u.state, detail: `serial ${u.serial}` }],
      evidence: [`ADB USB (${u.serial})`],
    } as (typeof groups)[number]);
  }

  for (const a of agentList) {
    if (groups.some((g) => g.ip === a.ip)) continue;
    groups.push({
      ip: a.ip,
      name: a.model || a.name || a.ip,
      kind: "unknown" as const,
      model: a.model,
      connections: [],
      evidence: ["Agente conectado via /agent"],
      agent: agentSummary(a),
    } as (typeof groups)[number]);
  }
  return groups;
}

router.get("/api/devices", (_req, res) => {
  const agentList = [...agents.values()].map(publicAgent);
  res.json({
    groups: mergedGroups(agentList),
    agents: agentList,
    usbAdb: scanState.usbAdb,
    scannedAt: scanState.scannedAt,
    status: scanState.status,
    progress: scanState.progress,
    step: scanState.step,
    interface: scanState.interface,
    error: scanState.error,
    version: VERSION,
  });
});

router.get("/api/scan/status", (_req, res) => {
  res.json({
    status: scanState.status,
    progress: scanState.progress,
    step: scanState.step,
    count: scanState.groups.length,
    agents: agents.size,
    usb: scanState.usbAdb.length,
    scannedAt: scanState.scannedAt,
    interface: scanState.interface,
  });
});

router.post("/api/scan/start", (_req, res) => {
  if (scanState.status === "scanning") {
    res.json({ ok: false, msg: "Varredura já em andamento." });
    return;
  }
  startScan();
  res.json({ ok: true, msg: "Varredura iniciada em background." });
});

export const discoveryRouter = router;
