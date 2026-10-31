import crypto from "node:crypto";
import { logFound } from "../core/log.js";
import { AGENT_TOKEN } from "../core/settings.js";
import { cleanText } from "../core/text.js";

export type AgentRecord = {
  id: string;
  ip: string;
  name?: string;
  model?: string;
  android?: string;
  platform?: string;
  userAgent?: string;
  screen?: string;
  language?: string;
  appVersion?: string;
  firstSeen: string;
  lastSeen: string;
  commands: string[];
  lastResult?: { ts: string; command: string; output: string };
};

export const agents = new Map<string, AgentRecord>();
export const AGENT_ONLINE_MS = 20_000;
export const AGENT_KEEP_MS = 24 * 60 * 60 * 1000;

export function cleanAgentId(v: unknown): string | null {
  return typeof v === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : null;
}

export function validAgentToken(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const a = Buffer.from(v);
  const b = Buffer.from(AGENT_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function upsertAgent(body: Record<string, unknown>, ip: string): AgentRecord {
  const id = cleanAgentId(body.id) ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const prev = agents.get(id);
  const rec: AgentRecord = {
    id,
    ip,
    name: cleanText(body.name, 80) ?? prev?.name,
    model: cleanText(body.model, 80) ?? prev?.model,
    android: cleanText(body.android, 40) ?? prev?.android,
    platform: cleanText(body.platform, 80) ?? prev?.platform,
    userAgent: cleanText(body.userAgent, 320) ?? prev?.userAgent,
    screen: cleanText(body.screen, 40) ?? prev?.screen,
    language: cleanText(body.language, 40) ?? prev?.language,
    appVersion: cleanText(body.appVersion, 40) ?? prev?.appVersion,
    firstSeen: prev?.firstSeen ?? now,
    lastSeen: now,
    commands: prev?.commands ?? [],
    lastResult: prev?.lastResult,
  };
  const wasOffline = !prev || Date.now() - Date.parse(prev.lastSeen) > AGENT_ONLINE_MS;
  agents.set(id, rec);
  if (!prev) logFound(`Agente conectado: ${rec.model ?? rec.name ?? id} (${ip})`);
  else if (wasOffline) logFound(`Agente reconectado: ${rec.model ?? rec.name ?? id} (${ip})`);
  return rec;
}

export function publicAgent(a: AgentRecord) {
  return {
    id: a.id,
    ip: a.ip,
    name: a.name,
    model: a.model,
    android: a.android,
    platform: a.platform,
    userAgent: a.userAgent,
    screen: a.screen,
    language: a.language,
    appVersion: a.appVersion,
    firstSeen: a.firstSeen,
    lastSeen: a.lastSeen,
    lastResult: a.lastResult,
    online: Date.now() - Date.parse(a.lastSeen) < AGENT_ONLINE_MS,
  };
}

export function startAgentCleanup(): void {
  setInterval(() => {
    const now = Date.now();
    for (const [id, a] of agents) {
      if (now - Date.parse(a.lastSeen) > AGENT_KEEP_MS) agents.delete(id);
    }
  }, 60_000).unref();
}
