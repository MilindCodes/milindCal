import { kvGet, kvSet } from "@/lib/kv";

export interface WatchChannel {
  channelId: string;
  resourceId: string;
  userEmail: string;
  calendarId: string;
  expiration: number;
  token: string;
  createdAt: number;
}

interface WatchState {
  channels: WatchChannel[];
  userSyncVersion: Record<string, number>;
}

const KV_KEY = "milindcal:watch-state";

// No in-memory cache here on purpose: this runs across many independent
// serverless instances (e.g. the webhook route and the version-poll route
// are separate warm containers), and a per-process cache with no
// invalidation would let a warm instance serve stale data indefinitely —
// and worse, clobber concurrent writes from other instances when it next
// saves from its stale snapshot. Always reading fresh from KV costs one
// extra round-trip (~10-50ms) per request, which is a non-issue at this
// app's traffic.
async function loadState(): Promise<WatchState> {
  const stored = await kvGet<WatchState>(KV_KEY);
  return {
    channels: stored?.channels ?? [],
    userSyncVersion: stored?.userSyncVersion ?? {}
  };
}

async function saveState(state: WatchState) {
  await kvSet(KV_KEY, state);
}

export async function listUserChannels(userEmail: string) {
  const state = await loadState();
  const now = Date.now();

  const active = state.channels.filter((channel) => channel.expiration > now);
  if (active.length !== state.channels.length) {
    await saveState({
      ...state,
      channels: active
    });
  }

  return active.filter((channel) => channel.userEmail === userEmail);
}

export async function getChannel(channelId: string) {
  const state = await loadState();
  return state.channels.find((channel) => channel.channelId === channelId);
}

export async function putChannels(channels: WatchChannel[]) {
  const state = await loadState();
  const nextById = new Map(state.channels.map((item) => [item.channelId, item]));

  for (const channel of channels) {
    nextById.set(channel.channelId, channel);
  }

  await saveState({
    ...state,
    channels: Array.from(nextById.values())
  });
}

export async function removeChannels(channelIds: string[]) {
  if (!channelIds.length) return;

  const removeSet = new Set(channelIds);
  const state = await loadState();
  await saveState({
    ...state,
    channels: state.channels.filter((channel) => !removeSet.has(channel.channelId))
  });
}

export async function touchUserSync(userEmail: string) {
  const state = await loadState();
  state.userSyncVersion[userEmail] = Date.now();
  await saveState(state);
}

export async function readUserSyncVersion(userEmail: string) {
  const state = await loadState();
  return state.userSyncVersion[userEmail] ?? 0;
}
