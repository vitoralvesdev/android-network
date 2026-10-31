import express from "express";
import path from "node:path";
import { apiAccess } from "./agents/security.js";
import { agentsRouter } from "./agents/routes.js";
import { nativeRouter } from "./agents/native.js";
import { startAgentCleanup } from "./agents/registry.js";
import { discoveryRouter } from "./discovery/routes.js";
import { adbRouter } from "./adb/routes.js";
import { systemRouter } from "./core/routes.js";
import { lanIPv4 } from "./core/network.js";
import { startScan } from "./discovery/scan.js";
import { startKeepAlive } from "./adb/keepalive.js";
import { AGENT_TOKEN, AGENT_TOKEN_FILE, HOST, PORT, PUBLIC_DIR, VERSION } from "./core/settings.js";

const app = express();

app.use(express.json({ limit: "20kb" }));
app.use(express.static(PUBLIC_DIR));
app.use(apiAccess);

app.get("/agent", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "agent.html"));
});

app.get("/discovery", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "discovery.html"));
});

app.get("/apk", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "apk.html"));
});

app.use(agentsRouter);
app.use(discoveryRouter);
app.use(adbRouter);
app.use(nativeRouter);
app.use(systemRouter);

const lan = lanIPv4();

app.listen(PORT, HOST, () => {
  console.log(`Android Network ADB v${VERSION}: http://localhost:${PORT}`);
  if (HOST === "0.0.0.0" && lan) {
    console.log(`LAN: http://${lan}:${PORT}  (agente: http://${lan}:${PORT}/agent)`);
  }
  console.log(`Token do agente: ${AGENT_TOKEN}  (arquivo ${AGENT_TOKEN_FILE})`);
  console.log(
    "Se a box não abrir a página, permita Node.js no firewall do Windows (rede privada) ou libere a porta 3000.",
  );
  startScan();
  startKeepAlive();
  startAgentCleanup();
});
