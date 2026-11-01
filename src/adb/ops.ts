import fs from "node:fs";
import path from "node:path";
import { CAPTURES_DIR, TMP_DIR } from "../core/settings.js";
import { isIPv4, lookupHost } from "../core/network.js";
import { scanState } from "../discovery/scan.js";
import { adbConnect, normalizeEndpoint, parseAdbDevices, resolveEndpoint, run, runBuffer } from "./client.js";

export type DeviceTarget = { endpoint: string; ip: string };
export type ResolveResult = DeviceTarget | { error: string };

function ipOf(endpoint: string): string {
  return endpoint.split(":")[0];
}

async function adbDevicesMap(): Promise<Map<string, string>> {
  try {
    return parseAdbDevices(await run("adb", ["devices"], 5000));
  } catch {
    return new Map();
  }
}

async function usbWifiIp(serial: string): Promise<string | null> {
  try {
    const out = await run("adb", ["-s", serial, "shell", "ip", "-4", "-o", "addr"], 4000);
    const found = [...out.matchAll(/inet (\d+\.\d+\.\d+\.\d+)/g)]
      .map((m) => m[1])
      .filter((ip) => !ip.startsWith("127."));
    return found.find((ip) => ip.startsWith("192.168.")) ?? found[0] ?? null;
  } catch {
    return null;
  }
}

export async function ensureDevice(target: string): Promise<ResolveResult> {
  const adbMap = await adbDevicesMap();

  if (!target.includes(":") && !isIPv4(target)) {
    const st = adbMap.get(target);
    if (st === "device") return { endpoint: target, ip: target };
    if (st) {
      return {
        error: [
          `${target}: estado "${st}" — não dá para usar ainda.`,
          st.includes("unauthorized")
            ? 'Aceite "Permitir depuração USB" na tela do aparelho e tente novamente.'
            : "Reconecte o cabo USB e rode list novamente.",
        ].join("\n"),
      };
    }
  }

  const direct = await resolveEndpoint(target);
  const ip = direct ? ipOf(direct) : await lookupHost(target);
  if (!ip) {
    return {
      error: `Alvo inválido ou nome não resolvido: ${target}\nUse <ip>, <ip:porta> ou o serial do adb devices (USB).`,
    };
  }

  let unauthorized: string | null = null;
  for (const [serial, state] of adbMap) {
    if (ipOf(serial) !== ip) continue;
    if (state === "device") return { endpoint: serial, ip };
    if (state.includes("unauthorized")) unauthorized = serial;
  }

  for (const [serial, state] of adbMap) {
    if (serial.includes(":") || state !== "device") continue;
    if ((await usbWifiIp(serial)) === ip) return { endpoint: serial, ip };
  }

  const group = scanState.groups.find((g) => g.ip === ip);
  const candidates: string[] = [];
  if (direct) candidates.push(direct);
  if (group?.adbEndpoint) candidates.push(group.adbEndpoint);
  if (group) {
    for (const c of group.connections) {
      if ((c.protocol === "ADB" || c.protocol === "ADB Wireless") && c.port) {
        candidates.push(`${group.ip}:${c.port}`);
      }
    }
  }
  candidates.push(`${ip}:5555`);

  for (const ep of [...new Set(candidates)].filter(normalizeEndpoint)) {
    const state = await adbConnect(ep);
    if (state === "device") return { endpoint: ep, ip };
    if (state === "unauthorized") unauthorized = ep;
  }

  if (unauthorized) {
    return {
      error: [
        `${unauthorized}: conectado, mas sem autorização.`,
        'Aceite "Permitir depuração USB" na tela do aparelho e tente novamente.',
      ].join("\n"),
    };
  }
  return {
    error: [
      `${ip}: ADB não acessível.`,
      "",
      "Esses comandos precisam de ADB habilitado no aparelho:",
      "  Android 11+: Opções do desenvolvedor > Depuração sem fio > pair/connect",
      "  Android 10 ou menor: Depuração USB/ADB pela rede > connect <ip>:5555",
      "",
      "A página /agent não substitui o ADB para instalar/remover apps.",
    ].join("\n"),
  };
}

export async function listApps(device: DeviceTarget): Promise<string> {
  const [user, system] = await Promise.all([
    run("adb", ["-s", device.endpoint, "shell", "pm", "list", "packages", "-3"], 15000),
    run("adb", ["-s", device.endpoint, "shell", "pm", "list", "packages", "-s"], 15000),
  ]);
  const parse = (out: string) =>
    out
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/^package:/, ""))
      .filter(Boolean)
      .sort();

  const userApps = parse(user);
  const systemApps = parse(system);
  return [
    `${device.ip} — aplicativos instalados`,
    "",
    `Usuário (${userApps.length}):`,
    ...(userApps.length ? userApps.map((p) => `  ${p}`) : ["  (nenhum)"]),
    "",
    `Sistema (${systemApps.length}):`,
    ...(systemApps.length ? systemApps.map((p) => `  ${p}`) : ["  (nenhum)"]),
  ].join("\n");
}

export async function installApk(device: DeviceTarget, apkPath: string): Promise<{ ok: boolean; output: string }> {
  const abs = path.resolve(apkPath);
  if (!fs.existsSync(abs)) return { ok: false, output: `Arquivo não encontrado: ${abs}` };
  if (!/\.apk$/i.test(abs)) return { ok: false, output: `Não é um APK: ${abs}` };

  const out = await run("adb", ["-s", device.endpoint, "install", "-r", abs], 240000);
  const ok = /Success/i.test(out) && !/Failure/i.test(out);
  return {
    ok,
    output: ok
      ? `${device.ip}: APK instalado.\n${path.basename(abs)}`
      : [ `Falha ao instalar ${path.basename(abs)} em ${device.ip}.`, "", out ].join("\n"),
  };
}

export async function uninstallPackage(
  device: DeviceTarget,
  pkg: string,
  confirmed: boolean,
): Promise<{ ok: boolean; output: string }> {
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(pkg)) {
    return { ok: false, output: `Pacote inválido: ${pkg}` };
  }
  if (!confirmed) {
    return {
      ok: false,
      output: `Confirmação necessária.\nUse: uninstall ${device.ip} ${pkg} confirmar`,
    };
  }

  let out = await run("adb", ["-s", device.endpoint, "uninstall", pkg], 60000);
  let ok = /Success/i.test(out);
  if (!ok) {
    const fallback = await run(
      "adb",
      ["-s", device.endpoint, "shell", "pm", "uninstall", "--user", "0", pkg],
      60000,
    );
    out = [out, "", `pm uninstall --user 0:\n${fallback}`].filter(Boolean).join("\n");
    ok = /Success/i.test(fallback);
  }

  return {
    ok,
    output: ok
      ? `${device.ip}: ${pkg} removido${/--user/.test(out) ? " para o usuário 0" : ""}.`
      : [`Falha ao remover ${pkg} de ${device.ip}.`, "", out].join("\n"),
  };
}

export async function pushFile(
  device: DeviceTarget,
  localPath: string,
  remotePath?: string,
): Promise<{ ok: boolean; output: string }> {
  const abs = path.resolve(localPath);
  if (!fs.existsSync(abs)) return { ok: false, output: `Arquivo não encontrado: ${abs}` };

  const dest = remotePath?.trim() || `/sdcard/Download/${path.basename(abs)}`;
  const out = await run("adb", ["-s", device.endpoint, "push", abs, dest], 240000);
  const ok = !/error|failed|cannot/i.test(out) || /\d+ files? pushed/i.test(out);
  return {
    ok,
    output: ok
      ? `${device.ip}: enviado para ${dest}\n${out}`
      : [`Falha ao enviar ${path.basename(abs)}.`, "", out].join("\n"),
  };
}

export async function rebootDevice(
  device: DeviceTarget,
  confirmed: boolean,
): Promise<{ ok: boolean; output: string }> {
  if (!confirmed) {
    return { ok: false, output: `Confirmação necessária.\nUse: reboot ${device.ip} confirmar` };
  }
  await run("adb", ["-s", device.endpoint, "reboot"], 15000);
  return { ok: true, output: `${device.ip}: reiniciando…` };
}

export async function captureScreen(
  device: DeviceTarget,
): Promise<{ ok: boolean; output: string; url?: string }> {
  const png = await runBuffer("adb", ["-s", device.endpoint, "exec-out", "screencap", "-p"], 30000);
  if (png.length < 8 || png.subarray(0, 4).toString("latin1") !== "\x89PNG") {
    return { ok: false, output: `${device.ip}: não foi possível capturar a tela.` };
  }
  fs.mkdirSync(CAPTURES_DIR, { recursive: true });
  const name = `tela-${Date.now()}.png`;
  fs.writeFileSync(path.join(CAPTURES_DIR, name), png);
  return {
    ok: true,
    output: `${device.ip}: captura salva (${Math.round(png.length / 1024)} KB).\n/api/captures/${name}`,
    url: `/api/captures/${name}`,
  };
}

export function stageUpload(fileName: string, data: Buffer): string {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const safe = path.basename(fileName).replace(/[^\w.\-]+/g, "_").slice(0, 120) || "arquivo.bin";
  const file = path.join(TMP_DIR, `${Date.now()}-${safe}`);
  fs.writeFileSync(file, data);
  return file;
}

export function isValidIp(value: string): boolean {
  return isIPv4(value);
}
