/**
 * Minimal key-value store for server-side state that must survive across
 * serverless invocations (watch channels, Asana tokens, sync versions).
 *
 * Writing this state to /tmp — the previous approach — silently breaks in
 * production: serverless platforms give each invocation an ephemeral,
 * per-instance /tmp, so a write from one lambda is invisible to the next and
 * vanishes on cold start. Google/Asana webhook version bumps would appear to
 * work in dev and then never actually reach the polling client in prod.
 *
 * Backed by Upstash Redis's REST API (plain HTTPS, no persistent connection —
 * works on any serverless runtime). Vercel KV is Upstash under the hood, so
 * its env var names (KV_REST_API_URL / KV_REST_API_TOKEN) are accepted too.
 *
 * When neither is configured (e.g. local dev without a provisioned store),
 * falls back to a local JSON file so `npm run dev` keeps working with zero
 * setup. The fallback has the same cross-instance limitation as the old
 * approach — it's a dev convenience only, never use it in production.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

const hasUpstash = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

let warnedFallbackOnce = false;
function warnFallbackOnce() {
  if (warnedFallbackOnce) return;
  warnedFallbackOnce = true;
  console.warn(
    "[kv] UPSTASH_REDIS_REST_URL/TOKEN (or KV_REST_API_URL/TOKEN) not set — " +
      "falling back to local file storage. Fine for local dev; this WILL NOT " +
      "work correctly on serverless deployments (state won't survive cold " +
      "starts or be shared across instances). Provision Upstash/Vercel KV for prod."
  );
}

async function upstashCommand<T>(command: unknown[]): Promise<T> {
  const res = await fetch(UPSTASH_URL!, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upstash command failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { result: T };
  return data.result;
}

/* ── Local-file fallback (dev only — see warning above) ──────────────── */

const memoryFallback = new Map<string, unknown>();

function fallbackPath(key: string) {
  const dir = process.env.KV_FALLBACK_DIR || "/tmp/milindcal-kv";
  return path.join(dir, `${key.replace(/[^a-zA-Z0-9_.-]/g, "_")}.json`);
}

async function fallbackGet<T>(key: string): Promise<T | null> {
  if (memoryFallback.has(key)) return memoryFallback.get(key) as T;
  try {
    const raw = await readFile(fallbackPath(key), "utf-8");
    const value = JSON.parse(raw) as T;
    memoryFallback.set(key, value);
    return value;
  } catch {
    return null;
  }
}

async function fallbackSet<T>(key: string, value: T): Promise<void> {
  memoryFallback.set(key, value);
  const filePath = fallbackPath(key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value), "utf-8");
}

/* ── Public API ────────────────────────────────────────────────────── */

export async function kvGet<T>(key: string): Promise<T | null> {
  if (!hasUpstash) {
    warnFallbackOnce();
    return fallbackGet<T>(key);
  }
  const raw = await upstashCommand<string | null>(["GET", key]);
  return raw ? (JSON.parse(raw) as T) : null;
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  if (!hasUpstash) {
    warnFallbackOnce();
    await fallbackSet(key, value);
    return;
  }
  await upstashCommand(["SET", key, JSON.stringify(value)]);
}
