import { adbConnect, run } from "./client.js";
import { appConfig } from "../core/config-store.js";
import { knownHosts, saveHosts } from "../core/host-cache.js";
import { logInfo, logStep, logWarn } from "../core/log.js";
import { portOpen } from "../core/network.js";
import { delay } from "../core/time.js";
import { wakeHost } from "../core/wol.js";

let keepAliveTimer: ReturnType<typeof setTimeout> | null = null;

async function keepAlive() {
  if (!appConfig.keepAliveEnabled) {
    keepAliveTimer = setTimeout(keepAlive, appConfig.keepAliveIntervalSec * 1000);
    return;
  }
  const adbHosts = Object.values(knownHosts).filter((h) => h.ports.includes(5555));
  if (adbHosts.length) {
    logStep(`Keep-alive: ${adbHosts.length} host(s) ADB...`);
    for (const host of adbHosts) {
      const ep = `${host.ip}:5555`;
      let online = await portOpen(host.ip, 5555, 2000);
      if (!online && appConfig.wakeOnLan) {
        const woke = await wakeHost(host.ip);
        if (woke) {
          for (let i = 0; i < 5; i++) {
            await delay(3000);
            if (await portOpen(host.ip, 5555, 2000)) {
              online = true;
              break;
            }
          }
        }
      }
      if (!online) {
        logWarn(`Keep-alive: ${ep} offline`);
        continue;
      }
      const state = await adbConnect(ep);
      if (state === "device") {
        try {
          await run("adb", ["-s", ep, "shell", "echo", "ok"], 5000);
          logInfo(`Keep-alive: ${ep} ok`);
          host.lastSeen = new Date().toISOString();
          saveHosts(knownHosts);
        } catch (e) {
          logWarn(`Keep-alive: ${ep} erro: ${(e as Error).message}`);
        }
      } else if (state) {
        logWarn(`Keep-alive: ${ep} ${state}`);
      }
    }
  }
  keepAliveTimer = setTimeout(keepAlive, appConfig.keepAliveIntervalSec * 1000);
}

export function startKeepAlive() {
  if (keepAliveTimer) {
    clearTimeout(keepAliveTimer);
    keepAliveTimer = null;
  }
  if (appConfig.keepAliveEnabled) {
    keepAliveTimer = setTimeout(keepAlive, appConfig.keepAliveIntervalSec * 1000);
    logInfo(`Keep-alive ativo (intervalo: ${appConfig.keepAliveIntervalSec}s, somente porta 5555)`);
  }
}
