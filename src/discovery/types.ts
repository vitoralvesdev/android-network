/* ─── tipos ───────────────────────────────────────────────────────── */

export type DeviceKind = "android-tv" | "android" | "apple" | "router" | "unknown";
export type Hint = "android-tv" | "android" | "apple" | "router" | "airplay";

export type Connection = { protocol: string; port?: number; state: string; detail?: string };

export type DeviceGroup = {
  ip: string;
  name: string;
  kind: DeviceKind;
  model?: string;
  vendor?: string;
  mac?: string;
  adbEndpoint?: string;
  adbState?: string;
  pairingPort?: number;
  connections: Connection[];
  evidence: string[];
};

export type Group = DeviceGroup & {
  hints: Set<Hint>;
  namePriority: number;
  modelPriority: number;
  lastSeen: string;
};

export const KIND_LABEL: Record<DeviceKind, string> = {
  "android-tv": "Android TV / Cast",
  android: "Android",
  apple: "Apple",
  router: "Roteador",
  unknown: "Não identificado",
};

export const KIND_ORDER: Record<DeviceKind, number> = {
  "android-tv": 0,
  android: 1,
  apple: 2,
  router: 3,
  unknown: 4,
};
