import os from "node:os";
import net from "node:net";
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as dnsPromises } from "node:dns";
import { delay } from "./time.js";

const execAsync = promisify(exec);

export type Iface = { name: string; ip: string; netmask: string; prefix: string };

export const VIRTUAL_IFACE_RE = /vEthernet|WSL|VirtualBox|VMware|Hyper-V|Loopback|Tailscale|ZeroTier|Docker|VPN|TAP|TUN|Bluetooth|Npcap/i;

export function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let v = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
    v = v * 256 + n;
  }
  return v >>> 0;
}

export function isIPv4(s: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(s) && ipv4ToInt(s) !== null;
}

export function sameSubnet(ip: string, iface: Iface): boolean {
  const a = ipv4ToInt(ip);
  const b = ipv4ToInt(iface.ip);
  const m = ipv4ToInt(iface.netmask);
  if (a === null || b === null || m === null) return false;
  return ((a & m) >>> 0) === ((b & m) >>> 0);
}

export function ifaceList(): Iface[] {
  const out: Iface[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const nic of list ?? []) {
      if (nic.family !== "IPv4" || nic.internal) continue;
      if (nic.address.startsWith("169.254.")) continue;
      out.push({
        name,
        ip: nic.address,
        netmask: nic.netmask || "255.255.255.0",
        prefix: nic.address.split(".").slice(0, 3).join("."),
      });
    }
  }
  return out;
}

export async function gatewayInfo(): Promise<{ gateway: string | null; ifaceIp: string | null }> {
  try {
    const { stdout } = await execAsync("route print -4", { timeout: 4000, windowsHide: true });
    let best: { gateway: string; ifaceIp: string; metric: number } | null = null;
    for (const line of stdout.split(/\r?\n/)) {
      const m = line.trim().match(/^0\.0\.0\.0\s+0\.0\.0\.0\s+(\d{1,3}(?:\.\d{1,3}){3})\s+(\d{1,3}(?:\.\d{1,3}){3})\s+(\d+)/);
      if (!m) continue;
      const metric = Number(m[3]);
      if (!best || metric < best.metric) best = { gateway: m[1], ifaceIp: m[2], metric };
    }
    return { gateway: best?.gateway ?? null, ifaceIp: best?.ifaceIp ?? null };
  } catch {
    return { gateway: null, ifaceIp: null };
  }
}

export async function primaryInterface(): Promise<{ iface: Iface; gateway: string | null } | null> {
  const all = ifaceList();
  const gw = await gatewayInfo();
  let chosen = gw.ifaceIp ? all.find((i) => i.ip === gw.ifaceIp) : undefined;
  if (!chosen) {
    chosen = all.find(
      (i) => !VIRTUAL_IFACE_RE.test(i.name) && !/^192\.168\.56\.|^172\.(1[7-9]|2\d|3[01])\./.test(i.ip),
    );
  }
  if (!chosen) chosen = all[0];
  if (!chosen) return null;
  return { iface: chosen, gateway: gw.gateway };
}

export function lanIPv4(): string | null {
  const all = ifaceList();
  const chosen = all.find(
    (i) => !VIRTUAL_IFACE_RE.test(i.name) && !/^192\.168\.56\.|^172\.(1[7-9]|2\d|3[01])\./.test(i.ip),
  );
  return chosen?.ip ?? all[0]?.ip ?? null;
}

export function sweepIPs(iface: Iface): string[] {
  const [a, b, c] = iface.ip.split(".").map(Number);
  const out: string[] = [];
  for (let i = 1; i <= 254; i++) {
    const ip = `${a}.${b}.${c}.${i}`;
    if (ip !== iface.ip) out.push(ip);
  }
  return out;
}

export async function arpTable(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const { stdout } = await execAsync("arp -a", { timeout: 4000, windowsHide: true });
    for (const line of stdout.split(/\r?\n/)) {
      const m = line.match(
        /(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-f]{2}[-:][0-9a-f]{2}[-:][0-9a-f]{2}[-:][0-9a-f]{2}[-:][0-9a-f]{2}[-:][0-9a-f]{2})/i,
      );
      if (m) out.set(m[1], m[2].replace(/-/g, ":").toLowerCase());
    }
  } catch {
    /* sem ARP */
  }
  return out;
}

export async function getMacFromArp(ip: string): Promise<string | null> {
  return (await arpTable()).get(ip) ?? null;
}

export function reverseName(ip: string): Promise<string | null> {
  return Promise.race([
    dnsPromises.reverse(ip).then((names) => names.find((n) => n && n !== ip) ?? null).catch(() => null),
    delay(1200).then(() => null),
  ]);
}

export function pingTtl(ip: string): Promise<number | null> {
  return new Promise((resolve) => {
    execFile("ping", ["-n", "1", "-w", "800", ip], { timeout: 2500, windowsHide: true }, (err, stdout) => {
      const m = String(stdout).match(/TTL[=\s](\d+)/i);
      resolve(m ? Number(m[1]) : null);
    });
  });
}

export function lookupHost(name: string): Promise<string | null> {
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,251}[a-zA-Z0-9])?$/.test(name)) return Promise.resolve(null);
  return Promise.race([
    dnsPromises
      .lookup(name, { family: 4 })
      .then((r) => (isIPv4(r.address) ? r.address : null))
      .catch(() => null),
    delay(1800).then(() => null),
  ]);
}

export async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) break;
        await fn(items[i]);
      }
    }),
  );
}

export function portOpen(ip: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, ip);
  });
}
