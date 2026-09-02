import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";

export function isDevAuthBypassActive(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.DEV_AUTH_BYPASS === "true"
  );
}

export function mockDevSession(): Session {
  return {
    user: { name: "Dev", email: "dev@milindcal.local", image: null },
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  } as Session;
}

export async function getSessionOrDev(): Promise<Session | null> {
  const real = await getServerSession(authOptions);
  if (real) return real;
  if (isDevAuthBypassActive()) return mockDevSession();
  return null;
}
