#!/usr/bin/env node
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, writeFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_FILE = path.join(ROOT, "box.json");

const HELP = `uso: node tools/box.mjs <comando> [args]

  config <ip[:porta]> <token>         salva host e token em box.json
  health                              testa se o agente responde
  info                                modelo, Android, permissões e instaladores
  apps [--system] [--json]            lista apps (usuário por padrão)
  launch <pacote>                     abre um app
  open <url>                          abre um site
  install <arquivo.apk> [--agent|--session]
                                      envia o APK do PC e abre a instalação na TV
                                      (padrão: navegador da box; --agent: instalador do agente)
  uninstall <pacote>                  pede a desinstalação na TV
  settings [unknown|security|applications|main]
  result                              último resultado de instalação/desinstalação

host, porta e token também valem por BOX_HOST, BOX_PORT e BOX_TOKEN.`;

function fail(msg) {
  console.error("erro: " + msg);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadConfig(argv) {
  let file = {};
  try {
    file = JSON.parse(await readFile(CONFIG_FILE, "utf8"));
  } catch {}
  const cfg = {
    host: process.env.BOX_HOST || file.host || "",
    port: Number(process.env.BOX_PORT || file.port || 8790),
    token: process.env.BOX_TOKEN || file.token || "",
  };
  const args = [];
  for (const a of argv) {
    const m = a.match(/^--(host|port|token)=(.+)$/);
    if (m) cfg[m[1]] = m[1] === "port" ? Number(m[2]) : m[2];
    else args.push(a);
  }
  return { cfg, args };
}

function base(cfg) {
  if (!cfg.host) fail("box não configurada: node tools/box.mjs config <ip[:porta]> <token>");
  return `http://${cfg.host}:${cfg.port}`;
}

async function call(cfg, p, { timeout = 20000 } = {}) {
  if (!cfg.token) fail("token ausente: use config, BOX_TOKEN ou --token=");
  let res;
  try {
    res = await fetch(base(cfg) + p, {
      headers: { "x-agent-token": cfg.token },
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    fail(`sem resposta de ${base(cfg)} (${e.name === "TimeoutError" ? "timeout" : e.message})`);
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  if (!res.ok) fail(`HTTP ${res.status} em ${p}: ${text}`);
  if (json && json.ok === false) fail(json.error || text);
  return json ?? text;
}

function lanIp() {
  const found = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== "IPv4" || a.internal || a.address.startsWith("169.254.")) continue;
      found.push(a.address);
    }
  }
  const score = (ip) =>
    ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3;
  found.sort((x, y) => score(x) - score(y));
  return found[0];
}

async function waitResult(cfg, before, timeoutMs) {
  const end = Date.now() + timeoutMs;
  let last = before;
  while (Date.now() < end) {
    await sleep(2000);
    try {
      last = (await call(cfg, "/result", { timeout: 8000 })).result;
    } catch {
      continue;
    }
    if (last !== before && !last.includes("baixando")) return last;
  }
  return last;
}

async function cmdConfig(args) {
  const [target, token] = args;
  if (!target || !token) fail("uso: node tools/box.mjs config <ip[:porta]> <token>");
  let host = target;
  let port = 8790;
  const m = target.match(/^(.*):(\d+)$/);
  if (m) {
    host = m[1];
    port = Number(m[2]);
  }
  await writeFile(CONFIG_FILE, JSON.stringify({ host, port, token }, null, 2) + "\n");
  console.log(`salvo em ${CONFIG_FILE}: ${host}:${port}`);
}

async function cmdInstall(cfg, args) {
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) fail("uso: node tools/box.mjs install <arquivo.apk> [--agent|--session]");
  const abs = path.resolve(file);
  let size;
  try {
    size = (await stat(abs)).size;
  } catch {
    fail(`arquivo não encontrado: ${file}`);
  }
  if (!abs.toLowerCase().endsWith(".apk")) fail("o arquivo precisa ter extensão .apk");

  const name = path.basename(abs);
  const ip = lanIp();
  if (!ip) fail("não encontrei um IP de LAN no PC para a box baixar o APK");

  let markDownloaded;
  const downloaded = new Promise((r) => (markDownloaded = r));
  const server = createServer((req, res) => {
    if ((req.url || "").split("?")[0] !== "/" + encodeURIComponent(name)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.on("finish", () => markDownloaded());
    res.writeHead(200, {
      "content-type": "application/vnd.android.package-archive",
      "content-length": size,
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(abs).pipe(res);
  });
  await new Promise((r) => server.listen(0, "0.0.0.0", r));
  const port = server.address().port;
  const url = `http://${ip}:${port}/${encodeURIComponent(name)}`;

  console.log(`servindo ${name} (${size} bytes) em ${url}`);

  if (!args.includes("--agent") && !args.includes("--session")) {
    await call(cfg, `/open?url=${encodeURIComponent(url)}`);
    console.log("abri o APK no navegador da TV. Toque no download e confirme a instalação.");
    await Promise.race([downloaded, sleep(90000)]);
    server.close();
    return;
  }

  const before = (await call(cfg, "/result")).result;
  const mode = args.includes("--session") ? "&mode=session" : "";
  await call(cfg, `/install?url=${encodeURIComponent(url)}${mode}`);
  const after = await waitResult(cfg, before, 90000);
  server.close();

  console.log("resultado: " + after);
  if (after.includes("instalador aberto") || after.includes("aguardando")) {
    console.log("confirme a instalação na tela da TV.");
  }
}

async function main() {
  const { cfg, args } = await loadConfig(process.argv.slice(2));
  const [cmd, ...rest] = args;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(HELP);
    return;
  }

  switch (cmd) {
    case "config":
      return cmdConfig(rest);

    case "health": {
      const res = await fetch(base(cfg) + "/health", { signal: AbortSignal.timeout(5000) }).catch((e) =>
        fail(`sem resposta de ${base(cfg)} (${e.message})`),
      );
      console.log(`agente respondeu: HTTP ${res.status} ${await res.text()}`);
      return;
    }

    case "info": {
      const i = await call(cfg, "/info");
      console.log(`box: ${i.manufacturer} ${i.model} — Android ${i.android} (SDK ${i.sdk})`);
      console.log(`ip: ${i.ip}:${i.port} | tela: ${i.screen} | uptime: ${Math.round(i.uptimeMs / 60000)} min`);
      console.log(
        `instalação de APK: ${i.canInstall ? "permitida" : "bloqueada"} | instalador: ${i.installer ?? "desconhecido"}`,
      );
      const s = i.settings || {};
      console.log(
        `settings: unknown=${s.unknownSources} security=${s.security} apps=${s.applications} main=${s.main}`,
      );
      if (i.installers?.length) console.log("instaladores para APK:\n  " + i.installers.join("\n  "));
      return;
    }

    case "apps": {
      const a = await call(cfg, "/apps");
      if (rest.includes("--json")) {
        console.log(JSON.stringify(a, null, 2));
        return;
      }
      const list = rest.includes("--system") ? a.system : a.user;
      console.log(list.join("\n"));
      return;
    }

    case "launch": {
      const pkg = rest[0];
      if (!pkg) fail("uso: node tools/box.mjs launch <pacote>");
      await call(cfg, `/launch?pkg=${encodeURIComponent(pkg)}`);
      console.log(`abrindo ${pkg} na TV`);
      return;
    }

    case "open": {
      const url = rest[0];
      if (!url) fail("uso: node tools/box.mjs open <url>");
      await call(cfg, `/open?url=${encodeURIComponent(url)}`);
      console.log(`abrindo ${url} na TV`);
      return;
    }

    case "install":
      return cmdInstall(cfg, rest);

    case "uninstall": {
      const pkg = rest[0];
      if (!pkg) fail("uso: node tools/box.mjs uninstall <pacote>");
      const r = await call(cfg, `/uninstall?pkg=${encodeURIComponent(pkg)}`);
      console.log(r.msg || "pedido enviado; confirme na TV");
      return;
    }

    case "settings": {
      const what = rest[0] || "unknown";
      const valid = ["unknown", "security", "applications", "main"];
      if (!valid.includes(what)) fail(`uso: settings [${valid.join("|")}]`);
      const r = await call(cfg, `/settings?what=${what}`);
      console.log(`aberto: ${r.what} (${r.action})`);
      return;
    }

    case "result": {
      const r = await call(cfg, "/result");
      console.log(r.result || "(sem resultado)");
      return;
    }

    default:
      console.error(`comando desconhecido: ${cmd}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((e) => fail(e.message));
