import { httpGet } from "../../core/http.js";
import { asString } from "../../core/text.js";

export type CastInfo = { name?: string; model?: string; manufacturer?: string; version?: string };

export async function castInfo(ip: string): Promise<CastInfo | null> {
  for (const p of ["/setup/eureka_info?options=detail", "/setup/eureka_info"]) {
    try {
      const r = await httpGet(`http://${ip}:8008${p}`, 2200, 128 * 1024);
      if (r.status < 200 || r.status >= 300) continue;
      const j = JSON.parse(r.body) as Record<string, unknown>;
      const di = (j.device_info && typeof j.device_info === "object" ? j.device_info : {}) as Record<string, unknown>;
      const info: CastInfo = {
        name: asString(j.name) ?? asString(di.name),
        model: asString(j.model_name) ?? asString(j.model) ?? asString(di.model_name),
        manufacturer: asString(j.manufacturer) ?? asString(j.device_brand) ?? asString(di.manufacturer),
        version: asString(j.version) ?? asString(di.version),
      };
      if (info.name || info.model) return info;
    } catch {
      /* sem Cast */
    }
  }
  return null;
}
