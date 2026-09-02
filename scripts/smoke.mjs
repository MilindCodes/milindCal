/**
 * Smoke test: boot the production server and assert the real routes render.
 *
 * Exists because `tsc --noEmit` and `next build` both passed while `/` was
 * returning 500 on every request — a `motion.div` in a component that had no
 * "use client" directive. `/` is dynamic (ƒ), so the build never prerendered
 * it, and nothing else in CI ever asked the server for a page.
 *
 * Usage: npm run smoke   (expects `next build` to have run first)
 */
import { spawn } from "node:child_process";
import process from "node:process";

const PORT = process.env.SMOKE_PORT ?? "3939";
const BASE = `http://127.0.0.1:${PORT}`;
const BOOT_TIMEOUT_MS = 60_000;

/** Each route with the status we require. 401 is a pass for the Google-backed
 *  API routes: unauthenticated is the correct answer there, and demanding 200
 *  would make the suite depend on live OAuth credentials. */
const ROUTES = [
  { path: "/", expect: [200], label: "landing / workspace" },
  { path: "/manifest.webmanifest", expect: [200], label: "PWA manifest" },
  { path: "/icon.svg", expect: [200], label: "app icon" },
  { path: "/this-route-does-not-exist", expect: [404], label: "404 page" },
  { path: "/api/google/calendars", expect: [200, 401], label: "calendars API" },
  { path: "/api/google/events", expect: [200, 401], label: "events API" },
  { path: "/api/asana/status", expect: [200, 401], label: "asana status API" },
];

const server = spawn("npx", ["next", "start", "-p", PORT], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, NODE_ENV: "production" },
});

let serverLog = "";
server.stdout.on("data", (d) => { serverLog += d; });
server.stderr.on("data", (d) => { serverLog += d; });

function shutdown() {
  if (!server.killed) server.kill("SIGTERM");
}
process.on("exit", shutdown);
process.on("SIGINT", () => { shutdown(); process.exit(130); });

async function waitForBoot() {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await fetch(BASE, { signal: AbortSignal.timeout(2000) });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return false;
}

if (!(await waitForBoot())) {
  console.error(`✗ server did not boot within ${BOOT_TIMEOUT_MS}ms\n${serverLog}`);
  shutdown();
  process.exit(1);
}

let failed = 0;
for (const { path, expect, label } of ROUTES) {
  let status = 0;
  let detail = "";
  try {
    const res = await fetch(BASE + path, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    status = res.status;
    // A 200 that renders Next's client-exception shell is still a failure.
    if (status === 200 && res.headers.get("content-type")?.includes("text/html")) {
      const body = await res.text();
      if (body.includes("Application error: a client-side exception")) {
        detail = " (rendered client-exception shell)";
        status = -1;
      }
    }
  } catch (err) {
    detail = ` (${err.message})`;
  }

  const ok = expect.includes(status);
  if (!ok) failed++;
  console.log(
    `${ok ? "✓" : "✗"} ${String(status).padStart(3)} ${path}  — ${label}${detail}` +
      (ok ? "" : `  [expected ${expect.join(" or ")}]`)
  );
}

shutdown();

if (failed) {
  console.error(`\n${failed} route check(s) failed.\n--- server log ---\n${serverLog}`);
  process.exit(1);
}
console.log(`\nAll ${ROUTES.length} route checks passed.`);
process.exit(0);
