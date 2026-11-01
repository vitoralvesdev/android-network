import { adbConnect, normalizeAdbState, run } from "../adb/client.js";
import { appConfig } from "../core/config-store.js";
import { knownHosts, saveHosts } from "../core/host-cache.js";
import { logFound, logInfo, logStep, logWarn } from "../core/log.js";
import {
  arpTable,
  mapLimit,
  pingTtl,
  portOpen,
  primaryInterface,
  reverseName,
  sameSubnet,
  sweepIPs,
} from "../core/network.js";
import { DeviceMap, finalKind, processMdns, processSsdp, toPublic } from "./identify.js";
import { isAndroidModel, isAppleModel } from "./models.js";
import { hintsForPort, PORT_LABELS, PROBE_PORTS } from "./ports.js";
import { airPlayInfo } from "./protocols/airplay.js";
import { castInfo } from "./protocols/cast.js";
import { discoverMDNS } from "./protocols/mdns.js";
import type { MdnsService } from "./protocols/mdns.js";
import { ssdpSearch } from "./protocols/ssdp.js";
import type { SsdpHit } from "./protocols/ssdp.js";
import { KIND_LABEL, KIND_ORDER } from "./types.js";
import type { DeviceGroup, DeviceKind, Hint } from "./types.js";

export type ScanStatus = "idle" | "scanning" | "done" | "error";
export type UsbAdb = { serial: string; state: string; model?: string; product?: string; ip?: string };
export const scanState = {
  status: "idle" as ScanStatus,
  groups: [] as DeviceGroup[],
  usbAdb: [] as UsbAdb[],
  scannedAt: null as string | null,
  error: null as string | null,
  progress: 0,
  step: "",
  interface: null as string | null,
};

let currentAbortController: AbortController | null = null;
export function makeAbortSignal(): AbortSignal {
  currentAbortController = new AbortController();
  return currentAbortController.signal;
}

/* ─── probe de IPs ────────────────────────────────────────────────── */

async function probeIPs(
  ips: string[],
  timeoutMs: number,
  devices: DeviceMap,
  probed: Set<string>,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  let cursor = 0;
  let done = 0;
  const total = ips.length;
  const workers = Math.min(appConfig.scanWorkers, Math.max(1, total));
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= total) break;
        const ip = ips[i];
        if (probed.has(ip)) continue;
        probed.add(ip);
        const open: number[] = [];
        for (const port of PROBE_PORTS) {
          if (await portOpen(ip, port, timeoutMs)) open.push(port);
        }
        if (open.length) {
          for (const port of open) {
            devices.addConnection(ip, {
              protocol: PORT_LABELS[port] ?? "TCP",
              port,
              state: "tcp-open",
              detail: `Porta ${port} aberta`,
            });
            for (const hint of hintsForPort(port)) devices.hint(ip, hint);
          }
          logFound(`TCP ${ip}: ${open.map((p) => `${PORT_LABELS[p] ?? p}:${p}`).join(", ")}`);
        }
        done++;
        if (onProgress && done % 10 === 0) onProgress(done, total);
      }
    }),
  );
}

/* ─── descoberta principal ────────────────────────────────────────── */

const warnedAdb = new Set<string>();

async function discover(): Promise<DeviceGroup[]> {
  const devices = new DeviceMap();
  const probed = new Set<string>();
  const progress = (pct: number, step: string) => {
    scanState.progress = pct;
    scanState.step = step;
  };

  const ctx = await primaryInterface();
  if (!ctx) {
    logWarn("Nenhuma interface IPv4 ativa encontrada.");
    return [];
  }
  const { iface, gateway } = ctx;
  scanState.interface = `${iface.name} ${iface.ip}`;
  logInfo(`Interface: ${iface.name} · ${iface.ip} (gateway ${gateway ?? "?"})`);

  /* Etapa 0 — known hosts */
  if (appConfig.knownHostsFirst) {
    const hosts = Object.values(knownHosts).filter((h) => sameSubnet(h.ip, iface));
    if (hosts.length) {
      progress(3, `Known hosts: ${hosts.length} IP(s)…`);
      logStep(`Etapa 0 — Known hosts: ${hosts.length} IP(s)…`);
      let hit = 0;
      await mapLimit(hosts, 8, async (h) => {
        for (const port of h.ports) {
          if (await portOpen(h.ip, port, appConfig.timeoutKnown)) {
            hit++;
            devices.addConnection(h.ip, {
              protocol: PORT_LABELS[port] ?? "TCP",
              port,
              state: "tcp-open",
              detail: "Host conhecido",
            });
            for (const hint of hintsForPort(port)) devices.hint(h.ip, hint);
            if (h.name) devices.setInfo(h.ip, { name: h.name }, 2);
            logFound(`Known: ${h.ip}:${port} respondeu`);
            break;
          }
        }
      });
      logInfo(`Known hosts: ${hit}/${hosts.length} responderam`);
    }
  }

  /* Etapa 1 — ADB devices */
  if (appConfig.stepAdbDevices) {
    progress(8, "ADB devices…");
    logStep("Etapa 1 — ADB devices…");
    try {
      const out = await run("adb", ["devices", "-l"], 6000);
      const usbList: UsbAdb[] = [];
      let n = 0;
      for (const line of out.split(/\r?\n/).slice(1)) {
        const t = line.trim();
        if (!t || t.startsWith("*")) continue;
        const [id, state, ...rest] = t.split(/\s+/);
        if (!id || !state) continue;
        const norm = normalizeAdbState(state) ?? state;
        const model = rest.find((x) => x.startsWith("model:"))?.slice(6)?.replace(/_/g, " ");
        const product = rest.find((x) => x.startsWith("product:"))?.slice(8);
        if (!id.includes(":")) {
          const rec: UsbAdb = { serial: id, state: norm, model, product };
          if (norm === "device") {
            try {
              const wifi = await run("adb", ["-s", id, "shell", "ip", "-4", "addr", "show", "wlan0"], 4000);
              rec.ip = wifi.match(/inet (\d+\.\d+\.\d+\.\d+)/)?.[1];
            } catch {
              rec.ip = undefined;
            }
            if (rec.ip) {
              devices.addConnection(rec.ip, { protocol: "ADB USB", state: norm, detail: `serial ${id}` });
              devices.setAdb(rec.ip, id, norm);
              if (model) devices.setInfo(rec.ip, { model }, 2, `ADB USB (${id})`);
              devices.hint(rec.ip, "android");
            }
          }
          usbList.push(rec);
          logFound(`ADB USB: ${model || id} (${norm})${rec.ip ? ` — ${rec.ip}` : ""}`);
          n++;
          continue;
        }
        const sep = id.lastIndexOf(":");
        const ip = id.slice(0, sep);
        const port = Number(id.slice(sep + 1));
        if (!sameSubnet(ip, iface) || !port) continue;
        if (port !== 5555 && norm === "offline") {
          if (!warnedAdb.has(id)) {
            warnedAdb.add(id);
            logWarn(`ADB: ${id} offline ignorado (porta ${port} não é ADB — provavelmente AirPlay)`);
          }
          continue;
        }
        devices.addConnection(ip, { protocol: "ADB", port, state: norm ?? state, detail: rest.join(" ") });
        if (model) devices.setInfo(ip, { model }, 2, `ADB devices (${state})`);
        const tvish = /tv|box|bravia|shield|fire|chromecast|mi\s?box/i.test(model ?? "");
        devices.hint(ip, tvish ? "android-tv" : "android");
        if (norm === "device" || norm === "unauthorized" || norm === "offline") {
          devices.setAdb(ip, id, norm);
        }
        n++;
      }
      scanState.usbAdb = usbList;
      logInfo(`ADB devices: ${n}`);
    } catch (e) {
      logWarn(`ADB indisponível: ${(e as Error).message}`);
    }
  }

  /* Etapa 2 — mDNS + SSDP em paralelo */
  if (appConfig.stepMdns || appConfig.stepSsdp) {
    progress(15, "mDNS + SSDP/UPnP…");
    logStep("Etapa 2 — mDNS + SSDP/UPnP…");
    const [mdns, ssdp] = await Promise.all([
      appConfig.stepMdns ? discoverMDNS(iface) : Promise.resolve([] as MdnsService[]),
      appConfig.stepSsdp ? ssdpSearch(iface) : Promise.resolve([] as SsdpHit[]),
    ]);
    processMdns(devices, mdns, appConfig.stepAdbMdns);
    processSsdp(devices, ssdp);
    logInfo(`mDNS: ${mdns.length} serviço(s) | SSDP: ${ssdp.length} resposta(s)`);
  }

  /* Etapa 3 — ARP cache */
  const arp = await arpTable();
  if (appConfig.stepArpScan) {
    progress(45, "ARP cache…");
    logStep("Etapa 3 — ARP cache…");
    const arpIPs = [...arp.keys()].filter((ip) => sameSubnet(ip, iface) && ip !== iface.ip && !probed.has(ip));
    logStep(`ARP: ${arpIPs.length} candidato(s)${arpIPs.length ? ": " + arpIPs.join(", ") : ""}`);
    await probeIPs(arpIPs, appConfig.timeoutArp, devices, probed);
  }

  /* Etapa 4 — sweep /24 */
  if (appConfig.stepFullSweep) {
    progress(55, `Sweep ${iface.prefix}.0/24…`);
    const ips = sweepIPs(iface).filter((ip) => !probed.has(ip));
    logStep(`Etapa 4 — sweep ${iface.prefix}.0/24: ${ips.length} IP(s)…`);
    await probeIPs(ips, appConfig.timeoutSweep, devices, probed, (done, total) => {
      const pct = 55 + Math.round((done / Math.max(1, total)) * 27);
      progress(pct, `Sweep ${iface.prefix}.0/24: ${done}/${total}`);
    });
  }

  /* Etapa 5 — hosts só no ARP (sem portas) */
  if (appConfig.includeArpOnly) {
    for (const [ip, mac] of arp) {
      if (!sameSubnet(ip, iface) || ip === iface.ip) continue;
      if (/^224\.|^239\.|\.255$|\.0$/.test(ip)) continue;
      if (devices.has(ip)) continue;
      devices.touch(ip);
      devices.setInfo(ip, { mac }, 0, "Presente na rede (ARP), sem portas abertas");
    }
  }

  /* Etapa 6 — identificação ativa */
  progress(86, "Identificando (AirPlay, Cast, ADB)…");
  logStep("Etapa 5 — identificação (AirPlay, Cast, ADB)…");
  await mapLimit(devices.all(), 6, async (g) => {
    const ports = new Set(g.connections.map((c) => c.port).filter((p): p is number => typeof p === "number"));

    if (appConfig.enrichAirPlay && (ports.has(5000) || ports.has(7000) || g.connections.some((c) => c.protocol.startsWith("AirPlay")))) {
      const info = await airPlayInfo(g.ip);
      if (info) {
        devices.setInfo(
          g.ip,
          { name: info.name, model: info.model, mac: info.mac },
          3,
          `AirPlay /info${info.model ? ` (model=${info.model})` : ""}`,
        );
        if (isAppleModel(info.model)) devices.hint(g.ip, "apple");
        else if (isAndroidModel(info.model)) devices.hint(g.ip, "android");
        logFound(
          `AirPlay: ${g.ip}${info.name ? ` "${info.name}"` : ""}${info.model ? ` model=${info.model}` : ""}${
            info.version ? ` v${info.version}` : ""
          }`,
        );
      }
    }

    if (appConfig.enrichCast && (ports.has(8008) || ports.has(8009) || g.connections.some((c) => c.protocol.includes("Cast")))) {
      const info = await castInfo(g.ip);
      if (info) {
        devices.setInfo(
          g.ip,
          { name: info.name, model: info.model, vendor: info.manufacturer },
          3,
          `Google Cast eureka_info${info.model ? ` (model=${info.model})` : ""}`,
        );
        devices.hint(g.ip, "android-tv");
        logFound(`Cast: ${g.ip}${info.name ? ` "${info.name}"` : ""}${info.model ? ` model=${info.model}` : ""}`);
      }
    }

    if (appConfig.adbAutoConnect && ports.has(5555)) {
      const ep = `${g.ip}:5555`;
      const state = await adbConnect(ep);
      if (state) {
        devices.addConnection(g.ip, { protocol: "ADB", port: 5555, state, detail: "adb connect" });
        devices.setAdb(g.ip, ep, state);
        devices.hint(g.ip, "android");
        if (state === "device") logFound(`ADB: ${ep} autorizado`);
        else logWarn(`ADB: ${ep} ${state}`);
      }
    }

    if (g.name === g.ip) {
      const rn = await reverseName(g.ip);
      if (rn) devices.setInfo(g.ip, { name: rn }, 1, "DNS reverso");
    }
    if (!g.mac && arp.has(g.ip)) g.mac = arp.get(g.ip);

    if (g.connections.length === 0 && g.hints.size === 0) {
      const ttl = await pingTtl(g.ip);
      if (ttl !== null) {
        const family =
          ttl <= 64 ? "família Linux/Android" : ttl <= 128 ? "família Windows" : "equipamento de rede";
        devices.setInfo(g.ip, {}, 0, `Host ativo (TTL ${ttl} — ${family})`);
        logInfo(`TTL: ${g.ip} = ${ttl} (${family})`);
      }
    }
  });

  /* Etapa 7 — finalização */
  progress(97, "Classificando…");
  const groups = devices.all();
  let cacheChanged = false;
  for (const g of groups) {
    if (!g.mac && arp.has(g.ip)) g.mac = arp.get(g.ip);

    if (g.hints.size === 0 && g.mac) {
      const h = knownHosts[g.ip];
      if (h?.kind && h.kind !== "unknown" && h.mac === g.mac) {
        g.hints.add(h.kind);
        g.evidence.push(`Tipo lembrado de varredura anterior (${KIND_LABEL[h.kind]})`);
      }
    }

    g.kind = finalKind(g, gateway);
    g.evidence = [...new Set(g.evidence)];

    if (g.kind !== "unknown" && g.mac) {
      const h = knownHosts[g.ip] ?? { ip: g.ip, ports: [], lastSeen: "" };
      if (h.kind !== g.kind || h.mac !== g.mac) {
        h.kind = g.kind;
        h.mac = g.mac;
        h.lastSeen = new Date().toISOString();
        knownHosts[g.ip] = h;
        cacheChanged = true;
      }
    }
  }
  if (cacheChanged) saveHosts(knownHosts);

  const result = groups
    .filter((g) => g.connections.length > 0 || g.evidence.length > 0)
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.ip.localeCompare(b.ip))
    .map(toPublic);

  const counts = result.reduce(
    (acc, g) => {
      acc[g.kind]++;
      return acc;
    },
    { "android-tv": 0, android: 0, apple: 0, router: 0, unknown: 0 } as Record<DeviceKind, number>,
  );
  logFound(
    `Concluído: ${result.length} aparelho(s) — ${counts["android-tv"]} Android/Cast, ${counts.android} Android, ${counts.apple} Apple, ${counts.router} roteador(es), ${counts.unknown} não identificado(s)`,
  );
  return result;
}

/* ─── scan scheduling ─────────────────────────────────────────────── */

let rescanTimer: ReturnType<typeof setTimeout> | null = null;

export function startScan() {
  if (scanState.status === "scanning") {
    logWarn("Varredura já em andamento.");
    return;
  }
  if (rescanTimer) {
    clearTimeout(rescanTimer);
    rescanTimer = null;
  }
  scanState.status = "scanning";
  scanState.error = null;
  scanState.progress = 0;
  scanState.step = "Iniciando…";
  scanState.usbAdb = [];
  void discover()
    .then((groups) => {
      scanState.groups = groups;
      scanState.scannedAt = new Date().toISOString();
      scanState.status = "done";
      scanState.progress = 100;
      scanState.step = "Concluído";
      rescanTimer = setTimeout(startScan, appConfig.autoRescanMinutes * 60 * 1000);
    })
    .catch((e) => {
      scanState.status = "error";
      scanState.error = (e as Error).message;
      logWarn(`Varredura falhou: ${(e as Error).message}`);
      rescanTimer = setTimeout(startScan, 2 * 60 * 1000);
    });
}

export function abortCurrent(): boolean {
  if (!currentAbortController) return false;
  currentAbortController.abort();
  currentAbortController = null;
  return true;
}

export function endAbortSignal(): void {
  currentAbortController = null;
}
