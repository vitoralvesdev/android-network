import { Router } from "express";
import { startKeepAlive } from "../adb/keepalive.js";
import { getCapabilities } from "../capabilities.js";
import { appConfig, resetConfig, updateConfig } from "./config-store.js";
import { clearHosts, knownHosts } from "./host-cache.js";
import { logInfo, recentLogs, subscribeLogs } from "./log.js";
import { lanIPv4 } from "./network.js";
import { isLocalRequest } from "./security.js";
import { AGENT_TOKEN, PORT, VERSION } from "./settings.js";

export const systemRouter = Router();

systemRouter.get("/api/logs", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  for (const e of recentLogs) res.write(`data: ${JSON.stringify(e)}\n\n`);
  const unsubscribe = subscribeLogs((e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
  req.on("close", unsubscribe);
});

systemRouter.get("/api/capabilities", (req, res) => {
  const local = isLocalRequest(req);
  res.json({
    ...getCapabilities(),
    runtime: {
      version: VERSION,
      port: PORT,
      lanAddress: lanIPv4(),
      token: local ? AGENT_TOKEN : undefined,
      localOnly: !local,
    },
  });
});

systemRouter.get("/api/config", (_req, res) => res.json(appConfig));

systemRouter.post("/api/config", (req, res) => {
  updateConfig((req.body ?? {}) as Partial<typeof appConfig>);
  logInfo("Configuração atualizada.");
  startKeepAlive();
  res.json({ ok: true, config: appConfig });
});

systemRouter.post("/api/config/reset", (_req, res) => {
  resetConfig();
  logInfo("Configuração resetada para o padrão.");
  startKeepAlive();
  res.json({ ok: true, config: appConfig });
});

systemRouter.get("/api/hosts", (_req, res) => res.json(knownHosts));

systemRouter.delete("/api/hosts", (_req, res) => {
  clearHosts();
  logInfo("Cache de hosts conhecidos limpo.");
  res.json({ ok: true });
});
