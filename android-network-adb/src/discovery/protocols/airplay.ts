import net from "node:net";
import { asString } from "../../core/text.js";
import { decodeEntities } from "../../core/xml.js";

export type AirplayInfo = { name?: string; model?: string; mac?: string; version?: string; osBuild?: string };


function readUIntBE(buf: Buffer, off: number, len: number): number {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + buf[off + i];
  return v;
}

function parseBplist(buf: Buffer): unknown {
  if (buf.length < 40 || buf.subarray(0, 8).toString("latin1") !== "bplist00") throw new Error("bplist inválido");
  const trailer = buf.subarray(buf.length - 32);
  const offsetSize = trailer[6];
  const objectRefSize = trailer[7];
  const numObjects = readUIntBE(trailer, 8, 8);
  const topObject = readUIntBE(trailer, 16, 8);
  const offsetTableOffset = readUIntBE(trailer, 24, 8);
  if (!offsetSize || !objectRefSize || numObjects > 100000 || offsetTableOffset >= buf.length)
    throw new Error("bplist inválido");

  const offsets: number[] = [];
  for (let i = 0; i < numObjects; i++) {
    const off = offsetTableOffset + i * offsetSize;
    if (off + offsetSize > buf.length) throw new Error("bplist truncado");
    offsets.push(readUIntBE(buf, off, offsetSize));
  }

  function objectLength(off: number, info: number): { len: number; start: number } {
    if (info !== 0x0f) return { len: info, start: off + 1 };
    if (off + 2 > buf.length) return { len: 0, start: off + 1 };
    const intMarker = buf[off + 1];
    const intLen = 1 << (intMarker & 0x0f);
    if ((intMarker >> 4) !== 0x1 || off + 2 + intLen > buf.length) return { len: 0, start: off + 1 };
    return { len: readUIntBE(buf, off + 2, intLen), start: off + 2 + intLen };
  }

  function readObject(ref: number, depth = 0): unknown {
    if (depth > 32 || ref < 0 || ref >= offsets.length) return null;
    const off = offsets[ref];
    if (off >= buf.length) return null;
    const marker = buf[off];
    const type = marker >> 4;
    const info = marker & 0x0f;
    if (type === 0x0) {
      if (info === 0x8) return false;
      if (info === 0x9) return true;
      return null;
    }
    if (type === 0x1) {
      const len = 1 << info;
      if (off + 1 + len > buf.length) return null;
      return readUIntBE(buf, off + 1, len);
    }
    if (type === 0x2) {
      const len = 1 << info;
      if (off + 1 + len > buf.length) return null;
      if (len === 4) return buf.readFloatBE(off + 1);
      if (len === 8) return buf.readDoubleBE(off + 1);
      return null;
    }
    if (type === 0x3) return null;
    if (type === 0x4) {
      const { len, start } = objectLength(off, info);
      return buf.subarray(start, start + len);
    }
    if (type === 0x5 || type === 0x6 || type === 0x7) {
      const { len, start } = objectLength(off, info);
      if (start + len > buf.length) return null;
      const slice = buf.subarray(start, start + len);
      if (type === 0x5) return slice.toString("latin1");
      if (type === 0x6) return Buffer.from(slice).swap16().toString("utf16le");
      return slice.toString("utf8");
    }
    if (type === 0x8) {
      const len = info + 1;
      if (off + 1 + len > buf.length) return null;
      return readUIntBE(buf, off + 1, len);
    }
    if (type === 0xa || type === 0xc) {
      const { len, start } = objectLength(off, info);
      const arr: unknown[] = [];
      for (let i = 0; i < len; i++) {
        const p = start + i * objectRefSize;
        if (p + objectRefSize > buf.length) break;
        arr.push(readObject(readUIntBE(buf, p, objectRefSize), depth + 1));
      }
      return arr;
    }
    if (type === 0xd) {
      const { len, start } = objectLength(off, info);
      const obj: Record<string, unknown> = {};
      const valStart = start + len * objectRefSize;
      for (let i = 0; i < len; i++) {
        const kp = start + i * objectRefSize;
        const vp = valStart + i * objectRefSize;
        if (vp + objectRefSize > buf.length) break;
        const k = readObject(readUIntBE(buf, kp, objectRefSize), depth + 1);
        const v = readObject(readUIntBE(buf, vp, objectRefSize), depth + 1);
        if (typeof k === "string") obj[k] = v;
      }
      return obj;
    }
    return null;
  }

  return readObject(topObject);
}

function xmlPlistValue(xml: string, key: string): string | undefined {
  const re = new RegExp(`<key>${key}</key>\\s*<string>([\\s\\S]*?)</string>`, "i");
  const m = xml.match(re);
  return m ? decodeEntities(m[1].trim()) : undefined;
}

function parseAirplayResponse(buf: Buffer): AirplayInfo | null {
  const idx = buf.indexOf("\r\n\r\n");
  if (idx < 0) return null;
  const head = buf.subarray(0, idx).toString("latin1");
  if (!/^(RTSP|HTTP)\/1\.[01] 200/i.test(head)) return null;
  let body = buf.subarray(idx + 4);
  const cl = head.match(/content-length:\s*(\d+)/i);
  if (cl) body = body.subarray(0, Number(cl[1]));
  try {
    if (body.subarray(0, 8).toString("latin1") === "bplist00") {
      const obj = parseBplist(body);
      if (!obj || typeof obj !== "object") return null;
      const rec = obj as Record<string, unknown>;
      return {
        name: asString(rec.name),
        model: asString(rec.model),
        mac: asString(rec.macAddress),
        version: asString(rec.sourceVersion),
        osBuild: asString(rec.osBuildVersion),
      };
    }
    const xml = body.toString("utf8");
    if (xml.includes("<plist")) {
      return {
        name: xmlPlistValue(xml, "name"),
        model: xmlPlistValue(xml, "model"),
        mac: xmlPlistValue(xml, "macAddress"),
        version: xmlPlistValue(xml, "sourceVersion"),
        osBuild: xmlPlistValue(xml, "osBuildVersion"),
      };
    }
  } catch {
    /* plist inválido */
  }
  return null;
}

export function airPlayInfo(ip: string, timeoutMs = 2200): Promise<AirplayInfo | null> {
  return new Promise((resolve) => {
    const sock = net.connect(5000, ip);
    let buf = Buffer.alloc(0);
    let done = false;
    const finish = (v: AirplayInfo | null) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch { /* */ }
      resolve(v);
    };
    sock.setTimeout(timeoutMs);
    sock.on("connect", () => {
      try { sock.write("GET /info RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: AirPlay/1.0\r\n\r\n"); } catch { /* */ }
    });
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length > 128 * 1024) return finish(null);
      const idx = buf.indexOf("\r\n\r\n");
      if (idx < 0) return;
      const head = buf.subarray(0, idx).toString("latin1");
      const m = head.match(/content-length:\s*(\d+)/i);
      if (m && buf.length >= idx + 4 + Number(m[1])) finish(parseAirplayResponse(buf));
    });
    sock.on("timeout", () => finish(parseAirplayResponse(buf)));
    sock.on("error", () => finish(null));
    sock.on("close", () => finish(parseAirplayResponse(buf)));
    setTimeout(() => finish(parseAirplayResponse(buf)), timeoutMs + 300);
  });
}
