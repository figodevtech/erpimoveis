import { NextResponse } from "next/server";

export function usoConsumoError(error: unknown, fallback: string) {
  const value = error as { message?: string; code?: string; statusCode?: number };
  const message = value?.message?.trim() || fallback;
  const status = Number.isInteger(value?.statusCode) ? Number(value.statusCode)
    : value?.code === "P0002" ? 404
    : value?.code === "23505" ? 409
    : value?.code === "23514" || value?.code === "22023" || value?.code === "42501" ? 400
    : 500;
  return NextResponse.json({ error: message }, { status });
}

export function normalizeSearch(value: string | null) {
  return String(value ?? "").trim().slice(0, 200).replace(/[%,()]/g, " ");
}

