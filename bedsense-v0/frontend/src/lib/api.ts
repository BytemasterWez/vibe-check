import { useEffect, useState } from "react";

const BASE = "/api/bedsense";

export async function api<T = any>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json();
}

export const get = <T = any>(path: string) => api<T>(path);
export const post = <T = any>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = <T = any>(path: string, body?: unknown) =>
  api<T>(path, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) });

/** Poll a GET endpoint every `intervalMs` ms. */
export function usePoll<T = any>(path: string, intervalMs = 2000): {
  data: T | null;
  error: string | null;
  refresh: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    const load = () =>
      get<T>(path)
        .then((d) => live && (setData(d), setError(null)))
        .catch((e) => live && setError(String(e)));
    load();
    const id = setInterval(load, intervalMs);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [path, intervalMs, tick]);

  return { data, error, refresh: () => setTick((t) => t + 1) };
}

export const fmtTime = (ts?: string | null) =>
  ts ? new Date(ts).toLocaleTimeString("en-GB", { hour12: false }) + " UTC" : "—";

export const fmtDateTime = (ts?: string | null) =>
  ts ? new Date(ts).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "—";

export const triLabel = (v: boolean | null | undefined, yes: string, no: string) =>
  v === true ? yes : v === false ? no : "Unknown";
