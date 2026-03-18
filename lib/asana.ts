import { mkdir, readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import type { Task, TaskImportance } from "@/lib/models";

/* ------------------------------------------------------------------ */
/*  Token Storage                                                       */
/* ------------------------------------------------------------------ */

export interface AsanaToken {
  accessToken: string;
  refreshToken: string;
  /** Unix ms timestamp when the access token expires */
  expiresAt: number;
  workspaceGid: string;
  userId: string;
  userName: string;
}

interface AsanaStore {
  token: AsanaToken | null;
  webhookSecret: string | null;
  syncVersion: number;
}

let memoryStore: AsanaStore | null = null;

function getStorePath() {
  return process.env.ASANA_TOKEN_PATH ?? "/tmp/milindcal-asana-store.json";
}

async function loadStore(): Promise<AsanaStore> {
  if (memoryStore) return memoryStore;

  try {
    const raw = await readFile(getStorePath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<AsanaStore>;
    memoryStore = {
      token: parsed.token ?? null,
      webhookSecret: parsed.webhookSecret ?? null,
      syncVersion: parsed.syncVersion ?? 0,
    };
  } catch {
    memoryStore = { token: null, webhookSecret: null, syncVersion: 0 };
  }

  return memoryStore;
}

async function saveStore(store: AsanaStore) {
  const filePath = getStorePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(store, null, 2), "utf-8");
  memoryStore = store;
}

export async function getStoredToken(): Promise<AsanaToken | null> {
  const store = await loadStore();
  return store.token;
}

export async function saveToken(token: AsanaToken) {
  const store = await loadStore();
  await saveStore({ ...store, token });
}

export async function clearToken() {
  const store = await loadStore();
  await saveStore({ ...store, token: null, webhookSecret: null });
}

export async function getWebhookSecret(): Promise<string | null> {
  const store = await loadStore();
  return store.webhookSecret;
}

export async function saveWebhookSecret(secret: string) {
  const store = await loadStore();
  await saveStore({ ...store, webhookSecret: secret });
}

export async function getAsanaSyncVersion(): Promise<number> {
  const store = await loadStore();
  return store.syncVersion;
}

export async function touchAsanaSync() {
  const store = await loadStore();
  await saveStore({ ...store, syncVersion: Date.now() });
}

/* ------------------------------------------------------------------ */
/*  OAuth                                                              */
/* ------------------------------------------------------------------ */

const ASANA_OAUTH_URL = "https://app.asana.com/-/oauth_authorize";
const ASANA_TOKEN_URL = "https://app.asana.com/-/oauth_token";

export function buildOAuthURL(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.ASANA_CLIENT_ID ?? "",
    redirect_uri: process.env.ASANA_REDIRECT_URI ?? "",
    response_type: "code",
    scope: "default",
    state,
  });
  return `${ASANA_OAUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string): Promise<AsanaToken> {
  const response = await fetch(ASANA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.ASANA_CLIENT_ID ?? "",
      client_secret: process.env.ASANA_CLIENT_SECRET ?? "",
      redirect_uri: process.env.ASANA_REDIRECT_URI ?? "",
      code,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${text}`);
  }

  const data = await response.json() as {
    access_token: string;
    refresh_token: string;
    expires_in?: number;
    data?: {
      gid?: string;
      name?: string;
      workspaces?: Array<{ gid: string; name: string }>;
    };
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    workspaceGid: data.data?.workspaces?.[0]?.gid ?? "",
    userId: data.data?.gid ?? "",
    userName: data.data?.name ?? "",
  };
}

export async function refreshAccessToken(token: AsanaToken): Promise<AsanaToken> {
  const response = await fetch(ASANA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.ASANA_CLIENT_ID ?? "",
      client_secret: process.env.ASANA_CLIENT_SECRET ?? "",
      refresh_token: token.refreshToken,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed: ${text}`);
  }

  const data = await response.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  return {
    ...token,
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
  };
}

/* ------------------------------------------------------------------ */
/*  API Client                                                          */
/* ------------------------------------------------------------------ */

const ASANA_API_BASE = "https://app.asana.com/api/1.0";

/** Returns a valid (possibly refreshed) token, throws if not connected.
 *  If ASANA_ACCESS_TOKEN env var is set, that PAT takes priority over OAuth. */
export async function getValidToken(): Promise<AsanaToken> {
  // Personal Access Token shortcut — no OAuth needed
  const pat = process.env.ASANA_ACCESS_TOKEN;
  if (pat) {
    return {
      accessToken: pat,
      refreshToken: "",
      expiresAt: Number.MAX_SAFE_INTEGER,
      workspaceGid: process.env.ASANA_WORKSPACE_GID ?? "",
      userId: "pat",
      userName: "Asana (PAT)",
    };
  }

  const token = await getStoredToken();
  if (!token) throw new Error("ASANA_NOT_CONNECTED");

  // Refresh proactively if expiring within 60 seconds
  if (token.expiresAt - 60_000 < Date.now()) {
    const refreshed = await refreshAccessToken(token);
    await saveToken(refreshed);
    return refreshed;
  }

  return token;
}

/** Authenticated fetch to the Asana REST API. */
export async function asanaFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const token = await getValidToken();
  return fetch(`${ASANA_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers as Record<string, string> | undefined),
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Task Mapping                                                        */
/* ------------------------------------------------------------------ */

const TASK_OPT_FIELDS = [
  "gid",
  "name",
  "notes",
  "due_on",
  "completed",
  "assignee",
  "assignee.name",
  "assignee.email",
  "projects",
  "projects.name",
  "memberships",
  "memberships.section",
  "memberships.section.name",
].join(",");

export interface AsanaTaskShape {
  gid: string;
  name: string;
  notes?: string;
  due_on?: string | null;
  completed: boolean;
  assignee?: { gid: string; name: string; email: string } | null;
  projects?: Array<{ gid: string; name: string }>;
  memberships?: Array<{ section?: { gid: string; name: string } }>;
}

/** Derive TaskImportance from an Asana section name using simple keyword matching. */
function inferImportance(sectionName: string): TaskImportance {
  const lower = sectionName.toLowerCase();
  if (lower.includes("high") || lower.includes("urgent") || lower.includes("critical")) return "high";
  if (lower.includes("low") || lower.includes("backlog") || lower.includes("nice")) return "low";
  return "medium";
}

export function mapAsanaTaskToLocal(asanaTask: AsanaTaskShape): Task {
  const sectionName = asanaTask.memberships?.[0]?.section?.name ?? "";
  const importance = inferImportance(sectionName);

  return {
    id: `asana_${asanaTask.gid}`,
    title: asanaTask.name,
    description: asanaTask.notes || undefined,
    completed: asanaTask.completed,
    createdAt: Date.now(),
    importance,
    dueDate: asanaTask.due_on ?? undefined,
    assigneeEmail: asanaTask.assignee?.email ?? undefined,
    asanaGid: asanaTask.gid,
    asanaProjectName: asanaTask.projects?.[0]?.name,
    asanaAssigneeName: asanaTask.assignee?.name ?? undefined,
    source: "asana",
  };
}

export async function fetchAsanaTasks(): Promise<AsanaTaskShape[]> {
  const token = await getValidToken();
  const params = new URLSearchParams({
    assignee: "me",
    workspace: token.workspaceGid,
    completed_since: "now",
    opt_fields: TASK_OPT_FIELDS,
    limit: "100",
  });

  const response = await asanaFetch(`/tasks?${params.toString()}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch Asana tasks: ${text}`);
  }

  const data = await response.json() as { data: AsanaTaskShape[] };
  return Array.isArray(data.data) ? data.data : [];
}

/* ------------------------------------------------------------------ */
/*  Webhook Verification                                               */
/* ------------------------------------------------------------------ */

export function verifyAsanaWebhookSignature(
  body: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
