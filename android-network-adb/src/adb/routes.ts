import express, { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { recordHost } from "../core/host-cache.js";
import { logInfo, logStep, logWarn } from "../core/log.js";
import { isIPv4, lookupHost } from "../core/network.js";
import { CAPTURES_DIR } from "../core/settings.js";
import { delay } from "../core/time.js";
import { abortCurrent, endAbortSignal, makeAbortSignal, scanState } from "../discovery/scan.js";
import { KIND_LABEL } from "../discovery/types.js";
import { adbConnect, parseAdbDevices, resolveEndpoint, run, validEndpoint } from "./client.js";
import { runAgentCommand } from "../agents/native.js";
import {
  captureScreen,
  ensureDevice,
  installApk,
  listApps,
  pushFile,
  rebootDevice,
  stageUpload,
  uninstallPackage,
} from "./ops.js";

const router = Router();

function helpText(): string {
  return [
    "Comandos:",
    "  list <ip-ou-serial>      identifica e coleta dados via ADB",
    "  apps <alvo>              lista apps de usuário e de sistema",
    "  install <alvo> <apk>     instala/atualiza um APK do PC",
    "  uninstall <alvo> <pacote> confirmar",
    "                           remove um app",
    "  screen <alvo>            captura a tela da box",
    "  push <alvo> <arquivo> [destino]",
    "                           envia um arquivo para a box",
    "  reboot <alvo> confirmar  reinicia a box",
    "  pair <ip:porta> <código>  pareia depuração sem fio (Android 11+)",
    "  connect <ip-ou-nome[:porta]> conecta ADB (porta padrão 5555)",
    "  disconnect <ip-ou-nome[:porta]> desconecta ADB",
    "  abort                    cancela a operação atual",
    "",
    "Agente nativo (box, sem ADB):",
    "  info                     modelo, Android, permissões e instaladores",
    "  apps [--system] [--json] lista apps da box (use 'agent apps')",
    "  launch <pacote>          abre um app na TV",
    "  open <url>               abre um site na TV",
    "  install <apk> [--agent|--session]",
    "                           envia um APK do PC e abre a instalação",
    "  uninstall <pacote>       pede a desinstalação na TV",
    "  settings [unknown|security|applications|main]",
    "  result                   último resultado de instalação",
    "  agent config <ip[:porta]> <token>",
    "                           aponta o terminal para a box",
    "",
    "Use 'agent <comando>' (ou 'box <comando>') para o agente;",
    "'apps', 'install' e 'uninstall' sem prefixo continuam sendo ADB.",
    "",
    "No cabo USB, use o serial exibido por `adb devices` no lugar do IP.",
  ].join("\n");
}

function cleanArg(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

function splitArgs(value: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

router.post("/api/command", async (req, res) => {
  const raw = typeof req.body?.command === "string" ? req.body.command.trim() : "";

  if (/^abort$/i.test(raw)) {
    if (abortCurrent()) {
      logWarn("Operação abortada.");
      res.json({ ok: true, output: "Operação abortada." });
      return;
    }
    res.json({ ok: true, output: "Nenhuma operação em andamento." });
    return;
  }

  if (/^help$/i.test(raw) || !raw) {
    res.json({ ok: true, output: helpText() });
    return;
  }

  const agentMatch = raw.match(/^(?:agent|box)(?:\s+([\s\S]+))?$/i);
  if (agentMatch) {
    res.json(await runAgentCommand(agentMatch[1] ?? "help"));
    return;
  }

  if (/^(info|health|result|config|launch|open)(?:\s|$)/i.test(raw)) {
    res.json(await runAgentCommand(raw));
    return;
  }

  const pairMatch = raw.match(/^pair\s+(\S+)\s+(\d{4,8})$/i);
  if (pairMatch) {
    const target = pairMatch[1];
    const code = pairMatch[2];
    if (!validEndpoint(target)) {
      res.status(400).json({ ok: false, output: "Alvo inválido. Use pair <ip:porta-de-pareamento> <código>." });
      return;
    }
    logStep(`pair ${target} ****`);
    try {
      const out = await run("adb", ["pair", target, code], 30000);
      const ok = /successfully paired|already paired/i.test(out);
      const ip = target.slice(0, target.lastIndexOf(":"));
      res.json({
        ok,
        output: ok
          ? [
              `Pareado com ${target}.`,
              "",
              "Agora conecte usando a PORTA DE CONEXÃO exibida na tela de Depuração sem fio",
              "(é diferente da porta de pareamento):",
              `  connect ${ip}:<porta-de-conexao>`,
            ].join("\n")
          : [
              "Falha ao parear.",
              out,
              "",
              "Confira:",
              "  - a tela 'Parear dispositivo' está aberta na TV",
              "  - o código de 6 dígitos está correto",
              "  - o IP e a porta são os de pareamento (não os de conexão)",
            ].join("\n"),
      });
    } catch (e) {
      res.status(500).json({ ok: false, output: (e as Error).message });
    }
    return;
  }

  const connectMatch = raw.match(/^connect\s+(\S+)$/i);
  if (connectMatch) {
    const ep = await resolveEndpoint(connectMatch[1]);
    if (!ep) {
      res.status(400).json({ ok: false, output: "Alvo inválido ou nome não resolvido. Use connect <ip-ou-nome[:porta]>." });
      return;
    }
    logStep(`connect ${ep}…`);
    const state = await adbConnect(ep);
    const output = state
      ? state === "device"
        ? `${ep}: conectado e autorizado.`
        : state === "unauthorized"
          ? `${ep}: conectado, mas a TV ainda não autorizou.\nAceite "Permitir depuração USB" na tela da TV e rode list novamente.`
          : `${ep}: estado "${state}".\nSe for Android 11+, use a depuração sem fio com pareamento (pair).`
      : `${ep}: não foi possível conectar.\nVerifique se a depuração ADB está habilitada e se a porta está correta.`;
    res.json({ ok: state === "device", output });
    return;
  }

  const disconnectMatch = raw.match(/^disconnect\s+(\S+)$/i);
  if (disconnectMatch) {
    const ep = await resolveEndpoint(disconnectMatch[1]);
    if (!ep) {
      res.status(400).json({ ok: false, output: "Alvo inválido ou nome não resolvido. Use disconnect <ip-ou-nome[:porta]>." });
      return;
    }
    const out = await run("adb", ["disconnect", ep], 5000).catch((e) => (e as Error).message);
    res.json({ ok: true, output: out || `${ep} desconectado.` });
    return;
  }

  const appsMatch = raw.match(/^apps\s+(\S+)$/i);
  if (appsMatch) {
    const target = cleanArg(appsMatch[1]);
    logStep(`apps ${target}…`);
    const device = await ensureDevice(target);
    if ("error" in device) {
      res.json({ ok: false, output: device.error });
      return;
    }
    try {
      res.json({ ok: true, output: await listApps(device) });
    } catch (e) {
      res.json({ ok: false, output: (e as Error).message });
    }
    return;
  }

  const installMatch = raw.match(/^install\s+(\S+)\s+(.+)$/i);
  if (installMatch) {
    const target = cleanArg(installMatch[1]);
    const [apkPath] = splitArgs(installMatch[2]);
    logStep(`install ${target} ${path.basename(apkPath || "")}…`);
    const device = await ensureDevice(target);
    if ("error" in device) {
      res.json({ ok: false, output: device.error });
      return;
    }
    try {
      res.json(await installApk(device, apkPath));
    } catch (e) {
      res.json({ ok: false, output: (e as Error).message });
    }
    return;
  }

  const uninstallMatch = raw.match(/^uninstall\s+(\S+)\s+(\S+)(?:\s+(confirmar|--yes))?$/i);
  if (uninstallMatch) {
    const target = cleanArg(uninstallMatch[1]);
    const pkg = cleanArg(uninstallMatch[2]);
    const confirmed = Boolean(uninstallMatch[3]);
    logStep(`uninstall ${target} ${pkg}${confirmed ? "" : " (sem confirmação)"}`);
    const device = await ensureDevice(target);
    if ("error" in device) {
      res.json({ ok: false, output: device.error });
      return;
    }
    try {
      res.json(await uninstallPackage(device, pkg, confirmed));
    } catch (e) {
      res.json({ ok: false, output: (e as Error).message });
    }
    return;
  }

  const rebootMatch = raw.match(/^reboot\s+(\S+)(?:\s+(confirmar|--yes))?$/i);
  if (rebootMatch) {
    const target = cleanArg(rebootMatch[1]);
    logStep(`reboot ${target}${rebootMatch[2] ? "" : " (sem confirmação)"}`);
    const device = await ensureDevice(target);
    if ("error" in device) {
      res.json({ ok: false, output: device.error });
      return;
    }
    try {
      res.json(await rebootDevice(device, Boolean(rebootMatch[2])));
    } catch (e) {
      res.json({ ok: false, output: (e as Error).message });
    }
    return;
  }

  const screenMatch = raw.match(/^screen\s+(\S+)$/i);
  if (screenMatch) {
    const target = cleanArg(screenMatch[1]);
    logStep(`screen ${target}…`);
    const device = await ensureDevice(target);
    if ("error" in device) {
      res.json({ ok: false, output: device.error });
      return;
    }
    try {
      res.json(await captureScreen(device));
    } catch (e) {
      res.json({ ok: false, output: (e as Error).message });
    }
    return;
  }

  const pushMatch = raw.match(/^push\s+(\S+)\s+(.+)$/i);
  if (pushMatch) {
    const target = cleanArg(pushMatch[1]);
    const [localPath, remotePath] = splitArgs(pushMatch[2]);
    logStep(`push ${target} ${path.basename(localPath || "")}…`);
    const device = await ensureDevice(target);
    if ("error" in device) {
      res.json({ ok: false, output: device.error });
      return;
    }
    try {
      res.json(await pushFile(device, localPath, remotePath));
    } catch (e) {
      res.json({ ok: false, output: (e as Error).message });
    }
    return;
  }

  const listMatch = raw.match(/^list\s+(.+)$/i);
  if (!listMatch) {
    res.status(400).json({ ok: false, output: helpText() });
    return;
  }

  const target = listMatch[1].trim().replace(/^["']|["']$/g, "");
  if (!target || target.length > 253 || /[;&|`$<>]/.test(target)) {
    res.status(400).json({ ok: false, output: "Alvo inválido." });
    return;
  }

  const signal = makeAbortSignal();
  try {
    logStep(`list ${target}…`);
    let usbSerial: string | null = null;
    if (!target.includes(":") && !isIPv4(target)) {
      try {
        const map = parseAdbDevices(await run("adb", ["devices"], 5000));
        if (map.get(target) === "device") usbSerial = target;
      } catch {
        /* sem adb: segue o fluxo de rede */
      }
    }
    let groups = scanState.groups;
    if (groups.length === 0) {
      await delay(1500);
      groups = scanState.groups;
    }
    if (signal.aborted) {
      res.json({ ok: false, output: "Abortado." });
      return;
    }

    let group = groups.find(
      (g) =>
        g.ip === target ||
        g.name.toLowerCase() === target.toLowerCase() ||
        g.adbEndpoint === target ||
        (target.includes(":") && g.adbEndpoint?.startsWith(target + ":")) === true,
    );
    let ip = group?.ip ?? (target.includes(":") ? target.split(":")[0] : target);
    if (!group && !isIPv4(ip) && !usbSerial) {
      const resolved = await lookupHost(ip);
      if (!resolved) {
        res.status(404).json({
          ok: false,
          output: `Não encontrei "${target}" na rede nem no DNS.\nLigue o aparelho, confirme o IP no roteador e rode list <ip>.\nSe estiver no cabo USB, use o serial exibido por adb devices.`,
        });
        return;
      }
      logInfo(`Resolvido ${ip} -> ${resolved}`);
      ip = resolved;
      group = groups.find((g) => g.ip === resolved);
    }

    let endpoint: string | null = usbSerial;
    let state: string | null = usbSerial ? "device" : null;
    if (!usbSerial) {
      const candidates: string[] = [];
      if (group?.adbEndpoint) candidates.push(group.adbEndpoint);
      if (group) {
        for (const c of group.connections) {
          if ((c.protocol === "ADB" || c.protocol === "ADB USB") && c.port) candidates.push(`${group.ip}:${c.port}`);
        }
      }
      candidates.push(`${ip}:5555`);
      const unique = [...new Set(candidates)].filter((ep) => !ep.endsWith(":7000") && validEndpoint(ep)).slice(0, 4);

      for (const ep of unique) {
        if (signal.aborted) break;
        const st = await adbConnect(ep);
        if (st === "device") {
          endpoint = ep;
          state = st;
          break;
        }
        if (!state && st) {
          endpoint = ep;
          state = st;
        }
      }
    }
    if (signal.aborted) {
      res.json({ ok: false, output: "Abortado." });
      return;
    }

    if (!endpoint || state !== "device") {
      const conns =
        group?.connections
          .map(
            (c) =>
              `  • ${c.protocol}${c.port ? `:${c.port}` : ""} — ${c.state}${c.detail ? ` (${c.detail})` : ""}`,
          )
          .join("\n") ?? "";
      const ident = [
        group?.kind ? `  Tipo       : ${KIND_LABEL[group.kind]}` : "",
        group?.model ? `  Modelo     : ${group.model}` : "",
        group?.vendor ? `  Fabricante : ${group.vendor}` : "",
        group?.mac ? `  MAC        : ${group.mac}` : "",
        group?.evidence?.length ? `  Evidências : ${group.evidence.join("; ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const pairHint = group?.pairingPort
        ? `  Porta de pareamento detectada: ${ip}:${group.pairingPort}`
        : "  A porta de pareamento aparece na tela 'Parear dispositivo' da TV.";
      const lines = [
        `${ip}: ADB não acessível${state ? ` (estado: ${state})` : ""}.`,
        "",
        ident ? `Identificação:\n${ident}\n` : "",
        "Conexões detectadas:",
        conns || "  (nenhuma)",
        "",
      ];
      if (group?.kind === "apple") {
        lines.push(
          "Atenção: este IP foi identificado como Apple (AirPlay/Continuity).",
          "iPhones, Macs e Apple TVs não expõem ADB.",
          "Se você esperava o TV Box aqui, este IP não é o dele.",
          "Ligue a box, confirme o IP no painel do roteador e rode list novamente.",
        );
        res.json({ ok: false, output: lines.join("\n") });
        return;
      }
      lines.push(
        "Para habilitar ADB:",
        "  Android 11+ (Depuração sem fio):",
        "    1. Na TV: Configurações > Sobre > toque 7x em Número da versão",
        "    2. Opções do desenvolvedor > Depuração sem fio",
        pairHint,
        "    3. pair <ip:porta-de-pareamento> <código>",
        "    4. connect <ip:porta-de-conexao>",
        "",
        "  Android 10 ou menor:",
        "    1. Opções do desenvolvedor > Depuração USB (ou ADB pela rede)",
        "    2. connect <ip>:5555",
        "    3. Aceite 'Permitir depuração USB' na tela da TV",
        "",
        "Se a box não tiver opção de depuração, a firmware bloqueia o ADB;",
        "será necessário menu de engenharia/vendor (engenharia reversa).",
      );
      res.json({ ok: false, output: lines.join("\n") });
      return;
    }

    logStep(`Coletando dados de ${endpoint}…`);
    const getprop = (p: string) => run("adb", ["-s", endpoint!, "shell", "getprop", p]);
    const shell = (c: string) => run("adb", ["-s", endpoint!, "shell", c]);
    const clean = (v: string) => v.replace(/\r/g, "").trim();

    const [manufacturer, model, android, sdk, board, brand, buildId, memRaw, cpuRaw, uptimeRaw, storageRaw, batteryRaw] =
      (
        await Promise.all([
          getprop("ro.product.manufacturer"),
          getprop("ro.product.model"),
          getprop("ro.build.version.release"),
          getprop("ro.build.version.sdk"),
          getprop("ro.product.board"),
          getprop("ro.product.brand"),
          getprop("ro.build.id"),
          shell("cat /proc/meminfo"),
          shell("cat /proc/cpuinfo | grep -E 'Hardware|model name|Processor' | head -3"),
          shell("cat /proc/uptime"),
          shell("df /data 2>/dev/null | tail -1"),
          shell("dumpsys battery 2>/dev/null | grep -E 'level|status|temperature'"),
        ])
      ).map(clean);

    if (signal.aborted) {
      res.json({ ok: false, output: "Abortado." });
      return;
    }
    if (!manufacturer && !model && !android) {
      res.status(502).json({
        ok: false,
        output: `${endpoint}: aparelho conectado mas não respondeu.\nWi-Fi instável? Tente novamente.`,
      });
      return;
    }

    const epPort = Number(endpoint.slice(endpoint.lastIndexOf(":") + 1)) || 5555;
    if (isIPv4(ip)) recordHost(ip, epPort, `${brand} ${model}`.trim());

    const memLine = (k: string) => {
      const m = memRaw.match(new RegExp(`${k}:\\s*(\\d+)`));
      return m ? parseInt(m[1], 10) : 0;
    };
    const memTotal = memLine("MemTotal");
    const memFree = memLine("MemFree");
    const memCached = memLine("Cached");
    const memAvail = memLine("MemAvailable") || memFree + memCached;
    const memUsed = memTotal - memAvail;
    const memPct = memTotal ? Math.round((memUsed / memTotal) * 100) : 0;
    const toMB = (kb: number) => (kb ? `${Math.round(kb / 1024)} MB` : "?");
    const uptimeSec = parseFloat(uptimeRaw.split(" ")[0]) || 0;
    const d = Math.floor(uptimeSec / 86400);
    const h = Math.floor((uptimeSec % 86400) / 3600);
    const m = Math.floor((uptimeSec % 3600) / 60);
    const uptimeFmt = [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(" ");
    const sp = storageRaw.trim().split(/\s+/);
    const kbToHuman = (kb: number) =>
      !Number.isFinite(kb) || kb <= 0
        ? "?"
        : kb >= 1048576
          ? `${(kb / 1048576).toFixed(1)} GB`
          : kb >= 1024
            ? `${Math.round(kb / 1024)} MB`
            : `${kb} KB`;
    const battLevel = batteryRaw.match(/level:\s*(\d+)/)?.[1];
    const battStatus = batteryRaw.match(/status:\s*(\d+)/)?.[1];
    const battTemp = batteryRaw.match(/temperature:\s*(\d+)/)?.[1];
    const statusMap: Record<string, string> = {
      "1": "desconhecido",
      "2": "carregando",
      "3": "descarregando",
      "4": "sem carga",
      "5": "carregado",
    };
    const bar = (pct: number, w = 20) =>
      "[" + "█".repeat(Math.round((pct / 100) * w)) + "░".repeat(w - Math.round((pct / 100) * w)) + `] ${pct}%`;
    const connsStr =
      group?.connections.map((c) => `  • ${c.protocol}${c.port ? `:${c.port}` : ""} — ${c.state}`).join("\n") ??
      "  (nenhuma)";
    const cpuModel = cpuRaw.split("\n")[0]?.replace(/.*:\s*/, "").trim() || "desconhecido";
    const title = `${brand} ${model}`.trim() || ip;

    res.json({
      ok: true,
      output: [
        "╔══════════════════════════════════════╗",
        `║  ${title.slice(0, 34).padEnd(34)}║`,
        "╚══════════════════════════════════════╝",
        "",
        "── Identificação ──────────────────────",
        `  Fabricante  : ${manufacturer || "?"}`,
        `  Marca       : ${brand || "?"}`,
        `  Modelo      : ${model || "?"}`,
        `  Board       : ${board || "?"}`,
        `  CPU         : ${cpuModel}`,
        `  Android     : ${android || "?"} (SDK ${sdk || "?"})`,
        `  Build ID    : ${buildId || "?"}`,
        `  Tipo        : ${group && group.kind !== "unknown" ? KIND_LABEL[group.kind] : "Android (ADB)"}`,
        `  Endpoint    : ${endpoint}`,
        "",
        "── Memória RAM ───────────────────────",
        `  Total       : ${memTotal ? toMB(memTotal) : "N/A"}`,
        `  Em uso      : ${memTotal ? `${toMB(memUsed)} ${bar(memPct)}` : "N/A"}`,
        `  Disponível  : ${memTotal ? toMB(memAvail) : "N/A"}`,
        "",
        "── Armazenamento (/data) ─────────────",
        `  Total       : ${kbToHuman(Number(sp[1]))}`,
        `  Usado       : ${kbToHuman(Number(sp[2]))} (${sp[4] ?? "?"})`,
        `  Livre       : ${kbToHuman(Number(sp[3]))}`,
        "",
        "── Sistema ───────────────────────────",
        `  Uptime      : ${uptimeFmt || "?"}`,
        `  Bateria     : ${battLevel ? `${battLevel}%` : "N/A"} (${
          battStatus ? (statusMap[battStatus] ?? battStatus) : "N/A"
        }, ${battTemp ? `${(parseInt(battTemp, 10) / 10).toFixed(1)}°C` : "N/A"})`,
        "",
        "── Conexões detectadas ───────────────",
        connsStr,
      ].join("\n"),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      res.json({ ok: false, output: "Abortado." });
      return;
    }
    res.status(500).json({ ok: false, output: (e as Error).message });
  } finally {
    endAbortSignal();
  }
});

router.post(
  "/api/transfer",
  express.raw({ type: "application/octet-stream", limit: "400mb" }),
  async (req, res) => {
    const target = typeof req.query.target === "string" ? req.query.target : "";
    const action = req.query.action === "push" ? "push" : "install";
    const dest = typeof req.query.dest === "string" ? req.query.dest : undefined;
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ ok: false, output: "Nenhum arquivo recebido." });
      return;
    }
    if (!target) {
      res.status(400).json({ ok: false, output: "Informe o alvo (IP da box)." });
      return;
    }

    const device = await ensureDevice(target);
    if ("error" in device) {
      res.json({ ok: false, output: device.error });
      return;
    }

    const name = typeof req.header("x-file-name") === "string" ? req.header("x-file-name")! : "arquivo.bin";
    const staged = stageUpload(name, req.body);
    try {
      const result =
        action === "push" ? await pushFile(device, staged, dest) : await installApk(device, staged);
      res.json(result);
    } catch (e) {
      res.json({ ok: false, output: (e as Error).message });
    } finally {
      fs.unlink(staged, () => {});
    }
  },
);

router.get("/api/captures/:file", (req, res) => {
  const name = req.params.file;
  if (!/^tela-\d+\.png$/.test(name)) {
    res.status(400).json({ ok: false, error: "Nome inválido." });
    return;
  }
  const file = path.join(CAPTURES_DIR, name);
  if (!fs.existsSync(file)) {
    res.status(404).json({ ok: false, error: "Captura não encontrada." });
    return;
  }
  res.sendFile(file);
});

export const adbRouter = router;
