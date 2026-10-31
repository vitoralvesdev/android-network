import fs from "node:fs";
import path from "node:path";
import type { DeviceKind } from "../discovery/types.js";
import { DATA_DIR } from "./settings.js";

export interface KnownHost { ip: string; ports: number[]; lastSeen: string; name?: string; mac?: string; kind?: DeviceKind; }
export type KnownHostMap = Record<string, KnownHost>;

const HOSTS_FILE = path.join(DATA_DIR, "known-hosts.json");

function loadHosts(): KnownHostMap {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(HOSTS_FILE, "utf8"));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as KnownHostMap;
    return {};
  } catch {
    return {};
  }
}

export function saveHosts(hosts: KnownHostMap) {
  fs.writeFileSync(HOSTS_FILE, JSON.stringify(hosts, null, 2), "utf8");
}

export const knownHosts: KnownHostMap = loadHosts();

export function recordHost(ip: string, port: number, name?: string) {
  const h = knownHosts[ip] ?? { ip, ports: [], lastSeen: "" };
  if (!h.ports.includes(port)) h.ports.push(port);
  h.lastSeen = new Date().toISOString();
  if (name && name !== ip) h.name = name;
  knownHosts[ip] = h;
  saveHosts(knownHosts);
}

export function clearHosts() {
  for (const key of Object.keys(knownHosts)) delete knownHosts[key];
  saveHosts(knownHosts);
}
