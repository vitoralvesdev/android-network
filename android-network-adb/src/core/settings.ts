import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const PORT = 3000;
export const HOST = process.env.HOST?.trim() || "0.0.0.0";
export const VERSION = "0.6.0";
const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(here, "../..");
export const AGENT_TOKEN_FILE = path.join(DATA_DIR, "agent-token.txt");

function loadOrCreateAgentToken(): string {
  const fromEnv = process.env.AGENT_TOKEN?.trim();
  if (fromEnv && /^[A-Za-z0-9_-]{6,64}$/.test(fromEnv)) return fromEnv;
  try {
    const saved = fs.readFileSync(AGENT_TOKEN_FILE, "utf8").trim();
    if (/^[A-Za-z0-9_-]{6,64}$/.test(saved)) return saved;
  } catch {
    /* primeira execução */
  }
  const token = crypto.randomBytes(4).toString("hex");
  try {
    fs.writeFileSync(AGENT_TOKEN_FILE, `${token}\n`, "utf8");
  } catch {
    /* sem permissão de escrita: token só em memória */
  }
  return token;
}

export const AGENT_TOKEN = loadOrCreateAgentToken();

export const PUBLIC_DIR = path.join(DATA_DIR, "public");
export const CAPTURES_DIR = path.join(DATA_DIR, "captures");
export const TMP_DIR = path.join(DATA_DIR, "tmp");
