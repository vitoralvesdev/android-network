import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./settings.js";

export interface ScanConfig {
  knownHostsFirst: boolean;
  stepAdbDevices: boolean;
  stepAdbMdns: boolean;
  stepSsdp: boolean;
  stepMdns: boolean;
  stepArpScan: boolean;
  stepFullSweep: boolean;
  timeoutKnown: number;
  timeoutArp: number;
  timeoutSweep: number;
  scanWorkers: number;
  autoRescanMinutes: number;
  keepAliveEnabled: boolean;
  keepAliveIntervalSec: number;
  wakeOnLan: boolean;
  enrichAirPlay: boolean;
  enrichCast: boolean;
  includeArpOnly: boolean;
  adbAutoConnect: boolean;
}

export const DEFAULT_CONFIG: ScanConfig = {
  knownHostsFirst: true,
  stepAdbDevices: true,
  stepAdbMdns: true,
  stepSsdp: true,
  stepMdns: true,
  stepArpScan: true,
  stepFullSweep: true,
  timeoutKnown: 1500,
  timeoutArp: 1000,
  timeoutSweep: 500,
  scanWorkers: 60,
  autoRescanMinutes: 10,
  keepAliveEnabled: true,
  keepAliveIntervalSec: 60,
  wakeOnLan: true,
  enrichAirPlay: true,
  enrichCast: true,
  includeArpOnly: true,
  adbAutoConnect: true,
};

const CONFIG_FILE = path.join(DATA_DIR, "scan-config.json");

function loadConfig(): ScanConfig {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) } as ScanConfig;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(cfg: ScanConfig) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
}

export const appConfig: ScanConfig = loadConfig();

export function updateConfig(patch: Partial<ScanConfig>): ScanConfig {
  Object.assign(appConfig, patch);
  saveConfig(appConfig);
  return appConfig;
}

export function resetConfig(): ScanConfig {
  Object.assign(appConfig, DEFAULT_CONFIG);
  saveConfig(appConfig);
  return appConfig;
}
