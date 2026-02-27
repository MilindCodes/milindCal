import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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

let memoryState: WatchState | null = null;

function getStorePath() {
  return process.env.WATCH_STATE_PATH || "/tmp/milindcal-watch-state.json";
}

async function loadState(): Promise<WatchState> {
  if (memoryState) {
    return memoryState;
  }

  const filePath = getStorePath();

  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as WatchState;

    memoryState = {
      channels: parsed.channels ?? [],
      userSyncVersion: parsed.userSyncVersion ?? {}
    };
  } catch {
    memoryState = {
      channels: [],
      userSyncVersion: {}
    };
  }

  return memoryState;
}

async function saveState(state: WatchState) {
  const filePath = getStorePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
  memoryState = state;
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
