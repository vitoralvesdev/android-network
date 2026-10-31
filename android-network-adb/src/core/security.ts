import type { Request } from "express";
import { ifaceList } from "./network.js";

export function clientAddress(req: Request): string {
  return (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
}

export function isLocalRequest(req: Request): boolean {
  const ip = clientAddress(req);
  if (ip === "127.0.0.1" || ip === "::1") return true;
  return ifaceList().some((i) => i.ip === ip);
}
