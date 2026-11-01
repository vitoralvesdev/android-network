import dgram from "node:dgram";
import { sameSubnet } from "../../core/network.js";
import { delay } from "../../core/time.js";
import type { Iface } from "../../core/network.js";
import { logWarn } from "../../core/log.js";

type DnsRecord = {
  name: string;
  type: number;
  data: string | { port: number; target: string } | Record<string, string>;
};

export type MdnsService = {
  service: string;
  instance: string;
  host?: string;
  ip: string;
  port?: number;
  txt: Record<string, string>;
  sourceIp: string;
};

function normName(s: string): string {
  return s.toLowerCase().replace(/\.$/, "");
}

function readDnsName(buf: Buffer, start: number): { name: string; next: number } {
  const labels: string[] = [];
  let p = start;
  let next = start;
  let jumped = false;
  let guard = 0;
  while (p < buf.length && guard++ < 128) {
    const len = buf[p];
    if (len === 0) {
      p++;
      if (!jumped) next = p;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (p + 1 >= buf.length) break;
      const ptr = ((len & 0x3f) << 8) | buf[p + 1];
      if (!jumped) next = p + 2;
      jumped = true;
      p = ptr;
      continue;
    }
    if (p + 1 + len > buf.length) break;
    labels.push(buf.subarray(p + 1, p + 1 + len).toString("utf8"));
    p += 1 + len;
    if (!jumped) next = p;
  }
  return { name: labels.join("."), next };
}

function parseDns(buf: Buffer): DnsRecord[] {
  if (buf.length < 12) return [];
  const qd = buf.readUInt16BE(4);
  const an = buf.readUInt16BE(6);
  const ns = buf.readUInt16BE(8);
  const ar = buf.readUInt16BE(10);
  let p = 12;
  for (let i = 0; i < qd; i++) {
    const { next } = readDnsName(buf, p);
    p = next + 4;
    if (p > buf.length) return [];
  }
  const records: DnsRecord[] = [];
  const total = Math.min(an + ns + ar, 256);
  for (let i = 0; i < total; i++) {
    if (p + 10 > buf.length) break;
    const { name, next } = readDnsName(buf, p);
    p = next;
    if (p + 10 > buf.length) break;
    const type = buf.readUInt16BE(p);
    const rdlen = buf.readUInt16BE(p + 8);
    const rdata = p + 10;
    const end = rdata + rdlen;
    if (end > buf.length) break;
    let data: DnsRecord["data"] | null = null;
    if (type === 1 && rdlen === 4) {
      data = `${buf[rdata]}.${buf[rdata + 1]}.${buf[rdata + 2]}.${buf[rdata + 3]}`;
    } else if (type === 12) {
      data = readDnsName(buf, rdata).name;
    } else if (type === 33 && rdlen >= 6) {
      data = { port: buf.readUInt16BE(rdata + 4), target: readDnsName(buf, rdata + 6).name };
    } else if (type === 16) {
      const txt: Record<string, string> = {};
      let q = rdata;
      while (q < end) {
        const l = buf[q++];
        if (q + l > end) break;
        const s = buf.subarray(q, q + l).toString("utf8");
        q += l;
        const eq = s.indexOf("=");
        if (eq > 0) txt[s.slice(0, eq)] = s.slice(eq + 1);
        else if (s) txt[s] = "";
      }
      data = txt;
    }
    if (data !== null) records.push({ name, type, data });
    p = end;
  }
  return records;
}

function buildMdnsQuery(name: string, unicast: boolean): Buffer {
  const parts: number[] = [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
  for (const label of name.split(".").filter(Boolean)) parts.push(Buffer.byteLength(label), ...Buffer.from(label));
  parts.push(0, 0, 12, unicast ? 0x80 : 0x00, 0x01);
  return Buffer.from(parts);
}

function isSrv(v: DnsRecord["data"]): v is { port: number; target: string } {
  return typeof v === "object" && v !== null && !Array.isArray(v) && "port" in v && "target" in v;
}

function isTxt(v: DnsRecord["data"]): v is Record<string, string> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !("port" in v) && !("target" in v);
}

export async function discoverMDNS(iface: Iface, timeoutMs = 4200): Promise<MdnsService[]> {
  const services = [
    "_googlecast._tcp.local",
    "_androidtvremote2._tcp.local",
    "_androidtvremote._tcp.local",
    "_airplay._tcp.local",
    "_raop._tcp.local",
    "_adb-tls-connect._tcp.local",
    "_adb-tls-pairing._tcp.local",
    "_companion-link._tcp.local",
    "_remotepairing._tcp.local",
  ];
  const hits = new Map<string, MdnsService>();

  const handle = (msg: Buffer, sourceIp: string) => {
    if (!sameSubnet(sourceIp, iface)) return;
    let records: DnsRecord[];
    try {
      records = parseDns(msg);
    } catch {
      return;
    }
    const aMap = new Map<string, string>();
    const srvMap = new Map<string, { port: number; target: string }>();
    const txtMap = new Map<string, Record<string, string>>();
    const ptrMap = new Map<string, string[]>();

    for (const r of records) {
      const rn = normName(r.name);
      if (r.type === 1 && typeof r.data === "string") {
        aMap.set(rn, r.data);
      } else if (r.type === 33 && isSrv(r.data)) {
        srvMap.set(rn, r.data);
      } else if (r.type === 16 && isTxt(r.data)) {
        txtMap.set(rn, r.data);
      } else if (r.type === 12 && typeof r.data === "string") {
        const arr = ptrMap.get(rn) ?? [];
        if (!arr.includes(r.data)) arr.push(r.data);
        ptrMap.set(rn, arr);
      }
    }

    for (const svc of services) {
      const instances = ptrMap.get(svc);
      if (!instances) continue;
      for (const rawInst of instances) {
        const instKey = normName(rawInst);
        const srv = srvMap.get(instKey);
        const txt = txtMap.get(instKey) ?? {};
        const host = srv ? normName(srv.target) : undefined;
        const ip = (host && aMap.get(host)) ?? sourceIp;
        if (!sameSubnet(ip, iface)) continue;
        const port = srv?.port;
        const key = `${svc}|${instKey}|${ip}|${port ?? 0}`;
        if (hits.has(key)) continue;
        const suffix = `.${svc}`;
        const display = instKey.endsWith(suffix) ? rawInst.slice(0, rawInst.length - suffix.length) : rawInst;
        hits.set(key, { service: svc, instance: display, host, ip, port, txt, sourceIp });
      }
    }
  };

  const querySock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  querySock.on("message", (msg, rinfo) => handle(msg, rinfo.address));
  querySock.on("error", (e) => logWarn(`mDNS: ${e.message}`));
  await new Promise<void>((resolve) => {
    querySock.bind(0, () => {
      try { querySock.setMulticastInterface(iface.ip); } catch { /* */ }
      try { querySock.addMembership("224.0.0.251", iface.ip); } catch { /* */ }
      try { querySock.setMulticastTTL(255); } catch { /* */ }
      resolve();
    });
  });

  let listener: dgram.Socket | null = null;
  try {
    listener = dgram.createSocket({ type: "udp4", reuseAddr: true });
    listener.on("message", (msg, rinfo) => handle(msg, rinfo.address));
    listener.on("error", () => { /* porta 5353 pode estar ocupada */ });
    await new Promise<void>((resolve, reject) => {
      const onErr = (e: Error) => {
        try { listener?.close(); } catch { /* */ }
        reject(e);
      };
      listener!.once("error", onErr);
      listener!.bind(5353, () => {
        listener!.off("error", onErr);
        try { listener!.addMembership("224.0.0.251", iface.ip); } catch { /* */ }
        resolve();
      });
    });
  } catch {
    listener = null;
  }

  const sendQueries = () => {
    for (const svc of services) {
      const pkt = buildMdnsQuery(svc, true);
      try { querySock.send(pkt, 0, pkt.length, 5353, "224.0.0.251"); } catch { /* */ }
    }
  };
  sendQueries();
  const t1 = setTimeout(sendQueries, 700);
  const t2 = setTimeout(sendQueries, 1500);
  await delay(timeoutMs);
  clearTimeout(t1);
  clearTimeout(t2);
  try { querySock.close(); } catch { /* */ }
  try { listener?.close(); } catch { /* */ }
  return [...hits.values()];
}
