export type LogLevel = "info" | "found" | "warn" | "step";
export type LogEntry = { ts: string; level: LogLevel; msg: string };
export const logSubscribers = new Set<(e: LogEntry) => void>();
export const recentLogs: LogEntry[] = [];
const MAX_RECENT = 300;

function emit(level: LogLevel, msg: string) {
  const entry: LogEntry = { ts: new Date().toISOString(), level, msg };
  console.log(`[${level}] ${msg}`);
  recentLogs.push(entry);
  if (recentLogs.length > MAX_RECENT) recentLogs.shift();
  for (const cb of logSubscribers) cb(entry);
}

export const logInfo = (m: string) => emit("info", m);
export const logFound = (m: string) => emit("found", m);
export const logWarn = (m: string) => emit("warn", m);
export const logStep = (m: string) => emit("step", m);

export function subscribeLogs(cb: (e: LogEntry) => void): () => void {
  logSubscribers.add(cb);
  return () => {
    logSubscribers.delete(cb);
  };
}
