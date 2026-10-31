import * as http from "node:http";
import * as https from "node:https";
import { VERSION } from "./settings.js";

export function httpGet(
  urlStr: string,
  timeoutMs = 2500,
  maxBytes = 256 * 1024,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(urlStr);
    } catch (e) {
      reject(e);
      return;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      reject(new Error("protocolo não suportado"));
      return;
    }
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.get(
      u,
      { timeout: timeoutMs, headers: { "User-Agent": `android-network-adb/${VERSION}`, Accept: "*/*" } },
      (res) => {
        let body = "";
        let bytes = 0;
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > maxBytes) {
            req.destroy(new Error("resposta muito grande"));
            return;
          }
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}
