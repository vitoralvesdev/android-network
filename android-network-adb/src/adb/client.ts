import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isIPv4, lookupHost } from "../core/network.js";
import { delay } from "../core/time.js";

const execFileAsync = promisify(execFile);

export async function run(cmd: string, args: string[], timeout = 8000): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return `${stdout ?? ""}${stderr ?? ""}`.trim();
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string; code?: string | number };
    if (e.code === "ENOENT") throw new Error("ADB não encontrado. Instale Android SDK Platform Tools e adicione ao PATH.");
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim();
    if (out) return out;
    throw new Error(e.message || "Falha ao executar comando.");
  }
}

export async function runBuffer(cmd: string, args: string[], timeout = 15000): Promise<Buffer> {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      timeout,
      windowsHide: true,
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    });
    return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? "");
  } catch (err) {
    const e = err as Error & { code?: string | number; stdout?: Buffer };
    if (e.code === "ENOENT") throw new Error("ADB não encontrado. Instale Android SDK Platform Tools e adicione ao PATH.");
    throw new Error(e.message || "Falha ao executar comando.");
  }
}

export function parseAdbDevices(out: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of out.split(/\r?\n/).slice(1)) {
    const m = line.trim().match(/^(\S+)\s+(\S+)/);
    if (!m) continue;
    map.set(m[1], m[2]);
  }
  return map;
}

export function normalizeAdbState(state: string | null | undefined): string | null {
  if (!state) return null;
  const s = state.toLowerCase();
  if (s.includes("unauthorized")) return "unauthorized";
  if (s.includes("offline")) return "offline";
  if (s.includes("device")) return "device";
  return s;
}

export async function adbConnect(ep: string): Promise<string | null> {
  try {
    await run("adb", ["connect", ep], 9000);
  } catch {
    /* a saída de erro pode conter a resposta */
  }
  await delay(700);
  try {
    return normalizeAdbState(parseAdbDevices(await run("adb", ["devices"], 5000)).get(ep));
  } catch {
    return null;
  }
}

export function validEndpoint(s: string): boolean {
  const m = s.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/);
  if (!m) return false;
  const octets = m[1].split(".").map(Number);
  const port = Number(m[2]);
  return octets.every((o) => o >= 0 && o <= 255) && port >= 1 && port <= 65535;
}

export function normalizeEndpoint(s: string): string | null {
  if (validEndpoint(s)) return s;
  if (isIPv4(s)) return `${s}:5555`;
  return null;
}

export async function resolveEndpoint(s: string): Promise<string | null> {
  const direct = normalizeEndpoint(s);
  if (direct) return direct;
  const sep = s.lastIndexOf(":");
  const host = sep > 0 ? s.slice(0, sep) : s;
  const port = sep > 0 ? s.slice(sep + 1) : "5555";
  if (!/^\d{1,5}$/.test(port)) return null;
  const ip = await lookupHost(host);
  return ip ? `${ip}:${port}` : null;
}
