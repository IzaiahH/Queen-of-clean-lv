import "server-only";
import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth/session";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function errorResponse(e: unknown) {
  if (e instanceof AuthError) return json({ error: e.message }, e.status);
  console.error(e);
  return json({ error: "Something went wrong on our side. Please try again." }, 500);
}

export async function readJson(req: Request, maxBytes = 64_000): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw new Error("Request too large");
  return JSON.parse(text);
}

/** Bots submit instantly; people take a few seconds. */
export function tooFast(startedAt: number, minMs = 3000) {
  return Date.now() - startedAt < minMs;
}
