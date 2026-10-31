import dgram from "node:dgram";
import { getMacFromArp } from "./network.js";
import { knownHosts, saveHosts } from "./host-cache.js";
import { logInfo, logWarn } from "./log.js";

export function sendWoL(mac: string, broadcast = "255.255.255.255"): Promise<void> {
  return new Promise((resolve, reject) => {
    const macBytes = mac.replace(/[^0-9a-f]/gi, "");
    if (macBytes.length !== 12) {
      reject(new Error("MAC inválido"));
      return;
    }
    const buf = Buffer.alloc(102);
    buf.fill(0xff, 0, 6);
    const macBuf = Buffer.from(macBytes, "hex");
    for (let i = 0; i < 16; i++) macBuf.copy(buf, 6 + i * 6);
    const sock = dgram.createSocket("udp4");
    sock.once("error", reject);
    sock.bind(0, () => {
      sock.setBroadcast(true);
      sock.send(buf, 0, buf.length, 9, broadcast, (err) => {
        sock.close();
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

export async function wakeHost(ip: string): Promise<boolean> {
  const host = knownHosts[ip];
  let mac = host?.mac;
  if (!mac) {
    mac = (await getMacFromArp(ip)) ?? undefined;
    if (mac && host) {
      host.mac = mac;
      saveHosts(knownHosts);
    }
  }
  if (!mac) {
    logWarn(`WoL: sem MAC para ${ip}`);
    return false;
  }
  try {
    await sendWoL(mac);
    logInfo(`WoL: magic packet enviado para ${ip} (${mac})`);
    return true;
  } catch (e) {
    logWarn(`WoL: erro: ${(e as Error).message}`);
    return false;
  }
}
