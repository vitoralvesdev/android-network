import type { Hint } from "./types.js";

export const PROBE_PORTS = [5555, 6466, 8008, 8009, 9080, 8080, 80, 5000, 7000, 62078] as const;
export const PORT_LABELS: Record<number, string> = {
  5555: "ADB",
  6466: "Android TV Remote",
  8008: "Google Cast HTTP",
  8009: "Google Cast TLS",
  9080: "TV Web Panel",
  8080: "HTTP",
  80: "HTTP",
  5000: "AirPlay/RAOP",
  7000: "AirPlay RTSP",
  62078: "Apple Lockdown",
  49152: "Apple Continuity",
};

export function hintsForPort(port: number): Hint[] {
  switch (port) {
    case 5555:
      return ["android"];
    case 6466:
    case 8008:
    case 8009:
      return ["android-tv"];
    case 62078:
      return ["apple"];
    case 5000:
    case 7000:
      return ["airplay"];
    default:
      return [];
  }
}
