import { knownHosts, recordHost, saveHosts } from "../core/host-cache.js";
import { logFound } from "../core/log.js";
import { isAndroidModel, isAppleModel } from "./models.js";
import type { MdnsService } from "./protocols/mdns.js";
import type { SsdpHit } from "./protocols/ssdp.js";
import type { Connection, DeviceGroup, DeviceKind, Group, Hint } from "./types.js";

export class DeviceMap {
  private map = new Map<string, Group>();

  has(ip: string): boolean {
    return this.map.has(ip);
  }

  get(ip: string): Group {
    let g = this.map.get(ip);
    if (!g) {
      g = {
        ip,
        name: ip,
        kind: "unknown",
        connections: [],
        evidence: [],
        hints: new Set<Hint>(),
        namePriority: 0,
        modelPriority: 0,
        lastSeen: new Date().toISOString(),
      };
      this.map.set(ip, g);
    }
    return g;
  }

  touch(ip: string) {
    this.get(ip).lastSeen = new Date().toISOString();
  }

  addConnection(ip: string, conn: Connection) {
    const g = this.get(ip);
    if (g.connections.some((c) => c.protocol === conn.protocol && c.port === conn.port)) return;
    g.connections.push(conn);
    g.lastSeen = new Date().toISOString();
    if (conn.port) recordHost(ip, conn.port, g.name !== ip ? g.name : undefined);
  }

  setInfo(
    ip: string,
    info: { name?: string; model?: string; vendor?: string; mac?: string },
    priority: number,
    evidence?: string,
  ) {
    const g = this.get(ip);
    if (info.name && info.name !== ip && priority >= g.namePriority) {
      g.name = info.name;
      g.namePriority = priority;
    }
    if (info.model && priority >= g.modelPriority) {
      g.model = info.model;
      g.modelPriority = priority;
    }
    if (info.vendor) g.vendor = info.vendor;
    if (info.mac) g.mac = info.mac;
    if (evidence) g.evidence.push(evidence);
    if (info.name) {
      const h = knownHosts[ip];
      if (h && h.name !== info.name) {
        h.name = info.name;
        saveHosts(knownHosts);
      }
    }
  }

  setAdb(ip: string, endpoint: string, state: string) {
    const g = this.get(ip);
    g.adbEndpoint = endpoint;
    g.adbState = state;
  }

  setPairingPort(ip: string, port: number) {
    this.get(ip).pairingPort = port;
  }

  hint(ip: string, hint: Hint) {
    this.get(ip).hints.add(hint);
  }

  all(): Group[] {
    return [...this.map.values()].sort((a, b) => a.ip.localeCompare(b.ip));
  }
}

export function finalKind(g: Group, gateway: string | null): DeviceKind {
  if (g.hints.has("router") || (gateway !== null && g.ip === gateway)) return "router";
  if (g.hints.has("android-tv")) return "android-tv";
  if (g.hints.has("android")) return "android";
  if (g.hints.has("apple")) return "apple";
  return "unknown";
}

export function toPublic(g: Group): DeviceGroup {
  return {
    ip: g.ip,
    name: g.name,
    kind: g.kind,
    model: g.model,
    vendor: g.vendor,
    mac: g.mac,
    adbEndpoint: g.adbEndpoint,
    adbState: g.adbState,
    pairingPort: g.pairingPort,
    connections: g.connections,
    evidence: g.evidence,
  };
}

/* ─── mDNS/SSDP -> DeviceMap ──────────────────────────────────────── */

export function processMdns(devices: DeviceMap, services: MdnsService[], includeAdb: boolean) {
  for (const s of services) {
    if (!includeAdb && s.service.startsWith("_adb")) continue;
    const txt = s.txt;
    const isAirplay = s.service === "_airplay._tcp.local" || s.service === "_raop._tcp.local";
    // Em RAOP, "md" são os tipos de metadata (0,1,2); o modelo real vem em "am".
    const model = isAirplay
      ? (txt.am ?? txt.model ?? txt.model_name)
      : (txt.md ?? txt.am ?? txt.model ?? txt.model_name);
    const name = txt.fn ?? txt.name ?? s.instance;

    switch (s.service) {
      case "_googlecast._tcp.local": {
        devices.addConnection(s.ip, {
          protocol: "Google Cast",
          port: s.port ?? 8009,
          state: "discovered",
          detail: txt.md ? `md=${txt.md}` : "mDNS",
        });
        devices.setInfo(s.ip, { name, model }, 3, `Google Cast${model ? ` (${model})` : ""}`);
        devices.hint(s.ip, "android-tv");
        logFound(`mDNS Google Cast: ${s.ip} "${name}"${model ? ` model=${model}` : ""}`);
        break;
      }
      case "_androidtvremote2._tcp.local":
      case "_androidtvremote._tcp.local": {
        devices.addConnection(s.ip, {
          protocol: "Android TV Remote",
          port: s.port ?? 6466,
          state: "discovered",
          detail: "mDNS",
        });
        devices.setInfo(s.ip, { name: txt.fn ?? undefined }, 2, "Android TV Remote (mDNS)");
        devices.hint(s.ip, "android-tv");
        logFound(`mDNS Android TV Remote: ${s.ip}${s.port ? `:${s.port}` : ""}`);
        break;
      }
      case "_airplay._tcp.local":
      case "_raop._tcp.local": {
        const protocol = s.service === "_airplay._tcp.local" ? "AirPlay" : "AirPlay/RAOP";
        const port = s.port ?? (s.service === "_airplay._tcp.local" ? 7000 : 5000);
        devices.addConnection(s.ip, {
          protocol,
          port,
          state: "discovered",
          detail: model ? `model=${model}` : "mDNS",
        });
        devices.setInfo(s.ip, { name, model }, 2, `AirPlay${model ? ` (model=${model})` : ""}`);
        devices.hint(s.ip, "airplay");
        if (isAppleModel(model)) devices.hint(s.ip, "apple");
        else if (isAndroidModel(model)) devices.hint(s.ip, "android");
        logFound(`mDNS ${protocol}: ${s.ip} "${name}"${model ? ` model=${model}` : ""}`);
        break;
      }
      case "_adb-tls-connect._tcp.local": {
        devices.addConnection(s.ip, {
          protocol: "ADB Wireless",
          port: s.port,
          state: "discovered",
          detail: "Depuração sem fio (pareamento pode ser necessário)",
        });
        devices.hint(s.ip, "android");
        if (s.port) devices.setAdb(s.ip, `${s.ip}:${s.port}`, "pairing");
        logFound(`mDNS ADB sem fio: ${s.ip}${s.port ? `:${s.port}` : ""} (pareamento)`);
        break;
      }
      case "_adb-tls-pairing._tcp.local": {
        devices.addConnection(s.ip, {
          protocol: "ADB Pairing",
          port: s.port,
          state: "discovered",
          detail: "Porta de pareamento",
        });
        devices.hint(s.ip, "android");
        if (s.port) devices.setPairingPort(s.ip, s.port);
        logFound(`mDNS ADB pareamento: ${s.ip}${s.port ? `:${s.port}` : ""}`);
        break;
      }
      case "_companion-link._tcp.local":
      case "_remotepairing._tcp.local": {
        devices.addConnection(s.ip, {
          protocol: "Apple Continuity",
          port: s.port,
          state: "discovered",
          detail: "mDNS",
        });
        devices.setInfo(s.ip, { name: txt.fn ?? undefined, model }, 2, "Apple Continuity");
        devices.hint(s.ip, "apple");
        logFound(`mDNS Apple: ${s.ip}${model ? ` model=${model}` : ""}`);
        break;
      }
    }
  }
}

export function processSsdp(devices: DeviceMap, hits: SsdpHit[]) {
  for (const h of hits) {
    const label = [h.server, h.st].filter(Boolean).join(" | ");
    devices.addConnection(h.ip, {
      protocol: "SSDP/UPnP",
      state: "discovered",
      detail: label || "UPnP",
    });
    devices.setInfo(
      h.ip,
      { name: h.name ?? h.model, model: h.model, vendor: h.manufacturer },
      2,
      `UPnP${h.deviceType ? ` (${h.deviceType})` : ""}`,
    );
    const all = `${h.manufacturer ?? ""} ${h.model ?? ""} ${h.name ?? ""} ${h.deviceType ?? ""} ${h.server ?? ""}`;
    if (
      /InternetGatewayDevice|WANDevice|WANConnectionDevice|Layer3Forwarding/i.test(h.deviceType ?? "") ||
      /router|roteador|ONT|GPON|ZTE|Huawei|TP-Link|D-Link|Intelbras|Fiberhome|Nokia|Mikrotik/i.test(all)
    ) {
      devices.hint(h.ip, "router");
    }
    if (/android|google|chromecast/i.test(all)) devices.hint(h.ip, "android-tv");
    logFound(
      `SSDP: ${h.ip} "${h.name ?? h.model ?? "?"}"${h.model ? ` model=${h.model}` : ""}${
        h.manufacturer ? ` vendor=${h.manufacturer}` : ""
      }`,
    );
  }
}
