import dgram from "node:dgram";
import { isIPv4, mapLimit, sameSubnet } from "../../core/network.js";
import type { Iface } from "../../core/network.js";
import { httpGet } from "../../core/http.js";
import { logWarn } from "../../core/log.js";
import { xmlTag } from "../../core/xml.js";

export type SsdpHit = {
  ip: string;
  server?: string;
  st?: string;
  usn?: string;
  location?: string;
  name?: string;
  manufacturer?: string;
  model?: string;
  modelNumber?: string;
  deviceType?: string;
};


function isLocalUrl(raw: string, iface: Iface): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:") return false;
    if (isIPv4(u.hostname)) return sameSubnet(u.hostname, iface) && u.hostname !== iface.ip;
    return /\.local$/i.test(u.hostname);
  } catch {
    return false;
  }
}

export function ssdpSearch(iface: Iface, timeoutMs = 3500): Promise<SsdpHit[]> {
  return new Promise((resolve) => {
    const hits = new Map<string, SsdpHit>();
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const MSEARCH = [
      "M-SEARCH * HTTP/1.1",
      "HOST: 239.255.255.250:1900",
      'MAN: "ssdp:discover"',
      "MX: 2",
      "ST: ssdp:all",
      "",
      "",
    ].join("\r\n");

    const send = () => {
      const b = Buffer.from(MSEARCH, "utf8");
      try { sock.send(b, 1900, "239.255.255.250"); } catch { /* */ }
    };

    sock.on("message", (msg, rinfo) => {
      if (!sameSubnet(rinfo.address, iface)) return;
      const text = msg.toString("utf8");
      if (!/^HTTP\/1\.1 200/i.test(text)) return;
      const headers: Record<string, string> = {};
      for (const line of text.split(/\r?\n/).slice(1)) {
        const i = line.indexOf(":");
        if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
      }
      const key = headers.usn || headers.location || `${rinfo.address}|${headers.st ?? ""}`;
      if (hits.has(key)) return;
      hits.set(key, {
        ip: rinfo.address,
        server: headers.server,
        st: headers.st,
        usn: headers.usn,
        location: headers.location,
      });
    });
    sock.on("error", (e) => logWarn(`SSDP: ${e.message}`));
    sock.bind(0, () => {
      try { sock.setMulticastInterface(iface.ip); } catch { /* */ }
      try { sock.setMulticastTTL(4); } catch { /* */ }
      send();
      setTimeout(send, 500);
      setTimeout(send, 1200);
    });

    setTimeout(async () => {
      try { sock.close(); } catch { /* */ }
      const list = [...hits.values()];
      await mapLimit(list, 6, async (h) => {
        if (!h.location || !isLocalUrl(h.location, iface)) return;
        try {
          const r = await httpGet(h.location, 2200, 128 * 1024);
          if (r.status < 200 || r.status >= 300) return;
          h.name = xmlTag(r.body, "friendlyName");
          h.manufacturer = xmlTag(r.body, "manufacturer");
          h.model = xmlTag(r.body, "modelName") ?? xmlTag(r.body, "modelDescription");
          h.modelNumber = xmlTag(r.body, "modelNumber");
          h.deviceType = xmlTag(r.body, "deviceType");
        } catch {
          /* descrição indisponível */
        }
      });
      resolve(list);
    }, timeoutMs);
  });
}
