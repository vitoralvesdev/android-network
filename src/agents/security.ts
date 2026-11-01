import type { NextFunction, Request, Response } from "express";
import { isLocalRequest } from "../core/security.js";
import { validAgentToken } from "./registry.js";

export function agentTokenFrom(req: Request): string | null {
  const header = req.header("x-agent-token");
  if (header) return header;
  const q = req.query.token;
  if (typeof q === "string") return q;
  const body = req.body as { token?: unknown } | undefined;
  return typeof body?.token === "string" ? body.token : null;
}

export function apiAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api/")) return next();

  const agentWrite =
    req.path === "/api/agent/register" ||
    req.path === "/api/agent/heartbeat" ||
    req.path === "/api/agent/result" ||
    (/^\/api\/agents\/[A-Za-z0-9_-]{8,64}\/command$/.test(req.path) && req.method === "POST");

  if (!agentWrite) {
    if (isLocalRequest(req)) return next();
    res.status(403).json({ ok: false, error: "Acesso restrito ao localhost." });
    return;
  }
  if (!validAgentToken(agentTokenFrom(req))) {
    res.status(401).json({ ok: false, error: "Token do agente inválido ou ausente." });
    return;
  }
  next();
}
