import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { lanIPv4 } from "../core/network.js";
import { DATA_DIR, PORT } from "../core/settings.js";
import { agents, AGENT_ONLINE_MS, type AgentRecord } from "./registry.js";

const CONFIG_FILE = path.join(DATA_DIR, "box.json");

export type BoxConfig = { host: string; port: number; token: string };

export function loadBoxConfig(): BoxConfig {
  let file: Partial<BoxConfig> = {};
  try {
    file = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as Partial<BoxConfig>;
  } catch {
    /* box.json ainda não existe */
  }
  return {
    host: process.env.BOX_HOST?.trim() || file.host || "",
    port: Number(process.env.BOX_PORT || file.port || 8790),
    token: process.env.BOX_TOKEN?.trim() || file.token || "",
  };
}

interface InfoPayload {
  manufacturer?: string;
  model?: string;
  brand?: string;
  android?: string;
  sdk?: number;
  ip?: string;
  port?: number;
  screen?: string;
  uptimeMs?: number;
  canInstall?: boolean;
  installer?: string | null;
  settings?: Record<string, boolean>;
  installers?: string[];
}

interface AppsPayload {
  user: string[];
  system: string[];
}

interface ResultPayload {
  result: string;
}

interface PendingApk {
  file: string;
  name: string;
  size: number;
}

const pendingApks = new Map<string, PendingApk>();

function splitArgs(value: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

async function agentCall<T>(p: string, timeout = 20000): Promise<T> {
  const cfg = loadBoxConfig();
  if (!cfg.host) throw new Error("box não configurada. Use: agent config <ip[:porta]> <token>");
  if (!cfg.token) throw new Error("token ausente. Use: agent config <ip[:porta]> <token>");

  let res: Response;
  try {
    res = await fetch(`http://${cfg.host}:${cfg.port}${p}`, {
      headers: { "x-agent-token": cfg.token },
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    const err = e as Error;
    throw new Error(`sem resposta de ${cfg.host}:${cfg.port} (${err.name === "TimeoutError" ? "timeout" : err.message})`);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* resposta em texto puro */
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  if (json && typeof json === "object" && (json as { ok?: boolean }).ok === false) {
    throw new Error((json as { error?: string }).error || text);
  }
  return (json ?? text) as T;
}

function agentHelp(): string {
  return [
    "Agente (box, sem ADB):",
    "  info                     modelo, Android, permissões e instaladores",
    "  apps [--system] [--json] lista apps da box (APK nativo)",
    "  launch <pacote>          abre um app na TV (APK nativo)",
    "  open <url>               abre um site na TV",
    "  env                      ambiente do navegador da box (agente de página)",
    "  install <apk> [--agent|--session]",
    "                           envia um APK do PC e abre a instalação (APK nativo)",
    "  uninstall <pacote>       pede a desinstalação na TV (APK nativo)",
    "  settings [unknown|security|applications|main]",
    "  result                   último resultado de instalação (APK nativo)",
    "  health                   testa o APK nativo na porta 8790",
    "  list                     agentes de navegador registrados no PC",
    "  config <ip[:porta]> <token>",
    "                           aponta o terminal para a box",
    "",
    "Dois modos:",
    "  - agente de página (/agent): registra no PC; aceita info, env e open",
    "  - APK nativo (porta 8790): aceita apps, launch, install, uninstall, settings, result",
    "",
    "Use o prefixo 'agent' (ou 'box'). Sem prefixo, valem os comandos ADB.",
  ].join("\n");
}

function nativeConfigured(): boolean {
  const cfg = loadBoxConfig();
  return Boolean(cfg.host) && cfg.port !== PORT;
}

function findBrowserAgent(host: string): AgentRecord | undefined {
  const list = [...agents.values()];
  if (host) {
    const exact = list.find((a) => a.ip === host);
    if (exact) return exact;
  }
  return list.length === 1 ? list[0] : undefined;
}

function requireNative(): void {
  const cfg = loadBoxConfig();
  if (cfg.port === PORT) {
    throw new Error(
      `a porta ${PORT} é do PC, não da box. O agente de página só responde info, env e open; ` +
        `para apps/launch/install use o APK nativo: agent config ${cfg.host || "<ip>"}:8790 <token-do-app>`,
    );
  }
}

async function browserCommand(cmd: string, waitMs = 12000): Promise<string> {
  const cfg = loadBoxConfig();
  const rec = findBrowserAgent(cfg.host);
  if (!rec) {
    const total = agents.size;
    throw new Error(
      total
        ? `nenhum agente corresponde a ${cfg.host || "?"}; use agent list para ver ${total} registrado(s)`
        : "nenhum agente de página registrado. Abra http://<ip-do-pc>:3000/agent na box",
    );
  }
  const age = Date.now() - Date.parse(rec.lastSeen);
  if (age > AGENT_ONLINE_MS) {
    throw new Error(`agente ${rec.ip} offline há ${Math.round(age / 1000)}s; mantenha a página /agent aberta`);
  }
  const id = rec.id;
  const start = Date.now();
  rec.commands.push(cmd);
  while (Date.now() - start < waitMs) {
    await new Promise((r) => setTimeout(r, 500));
    // cada heartbeat substitui o registro; reler para ver o lastResult novo
    const cur = agents.get(id);
    if (cur?.lastResult && Date.parse(cur.lastResult.ts) >= start && cur.lastResult.command === cmd) {
      return cur.lastResult.output || "(sem saída)";
    }
  }
  throw new Error("a box não respondeu (heartbeat de 5s). Confirme que a página /agent continua aberta");
}

function explainError(e: Error): string {
  const msg = e.message;
  if (/HTTP 401|token inválido/i.test(msg)) {
    const cfg = loadBoxConfig();
    return (
      `${msg}\n\n` +
      `O APK respondeu, mas o token não confere. Na TV, abra o app "HIGHSKY Agent": ` +
      `a tela mostra IP e "Token: xxxxxxxx".\n` +
      `Depois rode: agent config ${cfg.host || "<ip>"}:${cfg.port || 8790} <token-da-tv>`
    );
  }
  return msg;
}

function isAuthError(e: Error): boolean {
  return /HTTP 401|token inválido/i.test(e.message);
}

function formatAgentList(): string {
  const list = [...agents.values()];
  if (!list.length) return "nenhum agente de página registrado. Abra http://<ip-do-pc>:3000/agent na box.";
  const lines = [`${list.length} agente(s) de página registrado(s):`];
  for (const a of list) {
    const age = Math.round((Date.now() - Date.parse(a.lastSeen)) / 1000);
    const online = age * 1000 < AGENT_ONLINE_MS;
    lines.push(
      `  ${a.ip.padEnd(15)} ${online ? "online " : "offline"} ${String(age).padStart(4)}s  ${a.model ?? a.name ?? "?"}  id=${a.id}`,
    );
    if (a.lastResult) {
      lines.push(`      último: ${a.lastResult.command} -> ${a.lastResult.output.replace(/\s+/g, " ").slice(0, 100)}`);
    }
  }
  return lines.join("\n");
}

function formatInfo(i: InfoPayload): string {
  const s = i.settings ?? {};
  const lines = [
    `Box      : ${i.manufacturer ?? "?"} ${i.model ?? "?"} — Android ${i.android ?? "?"} (SDK ${i.sdk ?? "?"})`,
    `IP       : ${i.ip ?? "?"}:${i.port ?? "?"} | tela ${i.screen ?? "?"} | uptime ${Math.round((i.uptimeMs ?? 0) / 60000)} min`,
    `Instalar : ${i.canInstall ? "permitido (o ROM pode bloquear mesmo assim)" : "bloqueado"} | instalador ${i.installer ?? "desconhecido"}`,
    `Settings : unknown=${s.unknownSources} security=${s.security} apps=${s.applications} main=${s.main}`,
  ];
  if (i.installers?.length) lines.push("Instaladores para APK:", ...i.installers.map((x) => `  ${x}`));
  return lines.join("\n");
}

function formatApps(a: AppsPayload, args: string[]): string {
  if (args.includes("--json")) return JSON.stringify(a, null, 2);
  const system = args.includes("--system");
  const list = system ? a.system : a.user;
  return [`${list.length} apps (${system ? "sistema" : "usuário"}):`, ...list].join("\n");
}

async function waitResult(before: string, timeoutMs: number): Promise<string> {
  const end = Date.now() + timeoutMs;
  let last = before;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      last = (await agentCall<ResultPayload>("/result", 8000)).result;
    } catch {
      continue;
    }
    if (last !== before && !last.includes("baixando")) return last;
  }
  return last;
}

function cmdConfig(args: string[]): { ok: boolean; output: string } {
  const [target, token] = args;
  if (!target || !token) return { ok: false, output: "uso: agent config <ip[:porta]> <token>" };
  let host = target;
  let port = 8790;
  const m = target.match(/^(.*):(\d+)$/);
  if (m) {
    host = m[1];
    port = Number(m[2]);
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ host, port, token }, null, 2) + "\n", "utf8");
  const warn =
    port === PORT
      ? `\natenção: ${PORT} é a porta deste PC (servidor web), não da box. ` +
        `Nesse modo valem info, env, open e list pelo agente de página; ` +
        `apps/launch/install exigem o APK nativo: agent config ${host}:8790 <token-do-app>`
      : "";
  return { ok: true, output: `Box configurada: ${host}:${port} (${CONFIG_FILE})${warn}` };
}

async function cmdInstall(args: string[]): Promise<{ ok: boolean; output: string }> {
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) return { ok: false, output: "uso: agent install <arquivo.apk> [--agent|--session]" };
  const abs = path.resolve(file);
  let size = 0;
  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) throw new Error("não é arquivo");
    size = st.size;
  } catch {
    return { ok: false, output: `arquivo não encontrado: ${file}` };
  }
  if (!abs.toLowerCase().endsWith(".apk")) return { ok: false, output: "o arquivo precisa ter extensão .apk" };
  if (size > 400 * 1024 * 1024) return { ok: false, output: "APK maior que 400 MB" };

  const ip = lanIPv4();
  if (!ip) return { ok: false, output: "não encontrei um IP de LAN no PC" };

  const id = crypto.randomUUID();
  const name = path.basename(abs);
  pendingApks.set(id, { file: abs, name, size });
  setTimeout(() => pendingApks.delete(id), 10 * 60_000).unref();
  const url = `http://${ip}:${PORT}/agent-apk/${id}/${encodeURIComponent(name)}`;

  const browser = !args.includes("--agent") && !args.includes("--session");
  if (browser) {
    if (nativeConfigured()) {
      try {
        await agentCall(`/open?url=${encodeURIComponent(url)}`, 8000);
        return {
          ok: true,
          output: `APK servido em ${url}\nAbri no navegador da TV: toque no download e confirme a instalação.`,
        };
      } catch {
        /* APK nativo fora do ar: tenta pelo agente de página */
      }
    }
    await browserCommand(`open ${url}`, 20000);
    return {
      ok: true,
      output: `APK servido em ${url}\nAbri no navegador da TV (agente de página): toque no download e confirme a instalação.`,
    };
  }
  requireNative();

  const before = (await agentCall<ResultPayload>("/result")).result;
  const mode = args.includes("--session") ? "&mode=session" : "";
  await agentCall(`/install?url=${encodeURIComponent(url)}${mode}`);
  const after = await waitResult(before, 15000);
  const hint =
    after.includes("instalador aberto") || after.includes("aguardando")
      ? "\nConfirme a instalação na tela da TV. Depois rode: agent result"
      : "";
  return { ok: true, output: `Resultado: ${after}${hint}` };
}

export async function runAgentCommand(input: string): Promise<{ ok: boolean; output: string }> {
  const args = splitArgs(input);
  const sub = (args.shift() || "help").toLowerCase();
  try {
    switch (sub) {
      case "help":
        return { ok: true, output: agentHelp() };
      case "config":
        return cmdConfig(args);
      case "list":
        return { ok: true, output: formatAgentList() };
      case "env":
        return { ok: true, output: await browserCommand("env") };
      case "health": {
        const cfg = loadBoxConfig();
        if (!cfg.host) return { ok: false, output: "box não configurada. Use: agent config <ip[:porta]> <token>" };
        if (!nativeConfigured()) {
          const rec = findBrowserAgent(cfg.host);
          if (!rec) {
            return {
              ok: false,
              output: `nenhum agente de página para ${cfg.host}; abra http://${lanIPv4() ?? "<ip-do-pc>"}:${PORT}/agent na box`,
            };
          }
          const age = Math.round((Date.now() - Date.parse(rec.lastSeen)) / 1000);
          const online = age * 1000 < AGENT_ONLINE_MS;
          return {
            ok: online,
            output: `agente de página ${rec.ip} ${online ? "online" : "offline"} (${age}s) — ${rec.model ?? rec.name ?? "?"}`,
          };
        }
        const res = await fetch(`http://${cfg.host}:${cfg.port}/health`, {
          signal: AbortSignal.timeout(5000),
        }).catch((e: Error) => {
          throw new Error(`sem resposta de ${cfg.host}:${cfg.port} (${e.message})`);
        });
        return { ok: res.ok, output: `agente respondeu: HTTP ${res.status} ${await res.text()}` };
      }
      case "info": {
        if (nativeConfigured()) {
          try {
            return { ok: true, output: formatInfo(await agentCall<InfoPayload>("/info", 8000)) };
          } catch (nativeErr) {
            if (isAuthError(nativeErr as Error)) return { ok: false, output: explainError(nativeErr as Error) };
            try {
              return { ok: true, output: await browserCommand("info") };
            } catch (browserErr) {
              return {
                ok: false,
                output: `${(nativeErr as Error).message}\n(agente de página: ${(browserErr as Error).message})`,
              };
            }
          }
        }
        return { ok: true, output: await browserCommand("info") };
      }
      case "apps":
        requireNative();
        return { ok: true, output: formatApps(await agentCall<AppsPayload>("/apps"), args) };
      case "launch": {
        requireNative();
        const pkg = args[0];
        if (!pkg) return { ok: false, output: "uso: agent launch <pacote>" };
        await agentCall(`/launch?pkg=${encodeURIComponent(pkg)}`);
        return { ok: true, output: `abrindo ${pkg} na TV` };
      }
      case "open": {
        const url = args[0];
        if (!url) return { ok: false, output: "uso: agent open <url>" };
        if (nativeConfigured()) {
          try {
            await agentCall(`/open?url=${encodeURIComponent(url)}`, 8000);
            return { ok: true, output: `abrindo ${url} na TV` };
          } catch (nativeErr) {
            try {
              await browserCommand(`open ${url}`);
              return { ok: true, output: `abrindo ${url} na TV (agente de página)` };
            } catch (browserErr) {
              if (isAuthError(nativeErr as Error)) return { ok: false, output: explainError(nativeErr as Error) };
              return {
                ok: false,
                output: `${(nativeErr as Error).message}\n(agente de página: ${(browserErr as Error).message})`,
              };
            }
          }
        }
        await browserCommand(`open ${url}`);
        return { ok: true, output: `abrindo ${url} na TV (agente de página)` };
      }
      case "install":
        return cmdInstall(args);
      case "uninstall": {
        requireNative();
        const pkg = args[0];
        if (!pkg) return { ok: false, output: "uso: agent uninstall <pacote>" };
        const r = await agentCall<{ msg?: string }>(`/uninstall?pkg=${encodeURIComponent(pkg)}`);
        return { ok: true, output: r.msg || "pedido enviado; confirme na TV" };
      }
      case "settings": {
        requireNative();
        const what = args[0] || "unknown";
        const valid = ["unknown", "security", "applications", "main"];
        if (!valid.includes(what)) return { ok: false, output: `uso: agent settings [${valid.join("|")}]` };
        const r = await agentCall<{ what: string; action: string }>(`/settings?what=${what}`);
        return { ok: true, output: `aberto: ${r.what} (${r.action})` };
      }
      case "result": {
        if (!nativeConfigured()) {
          const rec = findBrowserAgent(loadBoxConfig().host);
          return { ok: true, output: rec?.lastResult?.output || "(sem resultado do agente de página)" };
        }
        const r = await agentCall<ResultPayload>("/result");
        return { ok: true, output: r.result || "(sem resultado)" };
      }
      default:
        return { ok: false, output: agentHelp() };
    }
  } catch (e) {
    return { ok: false, output: explainError(e as Error) };
  }
}

export const nativeRouter = Router();

nativeRouter.get("/agent-apk/:id/:name", (req, res) => {
  const entry = pendingApks.get(req.params.id);
  if (!entry) {
    res.status(404).json({ ok: false, error: "APK expirado ou inexistente." });
    return;
  }
  res.setHeader("Content-Type", "application/vnd.android.package-archive");
  res.setHeader("Content-Length", String(entry.size));
  res.sendFile(entry.file, (err) => {
    if (err) {
      if (!res.headersSent) res.status(500).end();
      return;
    }
    setTimeout(() => pendingApks.delete(req.params.id), 60_000).unref();
  });
});
