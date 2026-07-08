import Link from "next/link";
import Layout from "@/components/Layout";
import { usePoll } from "@/lib/api";

export default function Home() {
  const { data: health } = usePoll<{ status: string; local_only: boolean; version: string }>(
    "/health",
    5000
  );
  return (
    <Layout title="Home">
      <div className="mx-auto max-w-2xl space-y-6 py-10 text-center">
        <h1 className="text-3xl font-semibold text-sky-300">CableLight BedSense V0</h1>
        <p className="text-slate-300">
          Non-clinical research demonstrator for camera-less bed occupancy, movement and
          breathing-like motion detection.
        </p>
        <p className="text-sm text-slate-500">
          This prototype does not monitor health, diagnose, predict deterioration, replace medical
          devices or support clinical decisions.
        </p>
        <div className="flex justify-center gap-3">
          <Link
            href="/dashboard"
            className="rounded bg-sky-600 px-5 py-2.5 font-medium hover:bg-sky-500"
          >
            Open dashboard
          </Link>
          <Link
            href="/experiments"
            className="rounded border border-slate-600 px-5 py-2.5 font-medium text-slate-300 hover:bg-slate-800"
          >
            Run experiments
          </Link>
        </div>
        <div className="text-xs text-slate-500">
          API status:{" "}
          {health ? (
            <span className="text-emerald-400">
              {health.status} · v{health.version} · local-only {String(health.local_only)}
            </span>
          ) : (
            <span className="text-amber-400">connecting…</span>
          )}
        </div>
      </div>
    </Layout>
  );
}
