import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { get, patch } from "@/lib/api";

export default function Settings() {
  const [settings, setSettings] = useState<any | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = () => get("/settings").then(setSettings).catch((e) => setMessage(String(e)));
  useEffect(() => {
    load();
  }, []);

  const save = (updates: Record<string, unknown>) =>
    patch("/settings", updates)
      .then((s) => {
        setSettings(s);
        setMessage("Saved.");
      })
      .catch((e) => setMessage(String(e)));

  if (!settings) {
    return (
      <Layout title="Settings">
        <p className="text-sm text-slate-500">{message ?? "Loading settings…"}</p>
      </Layout>
    );
  }

  const numberField = (key: string, label: string, step = 0.05) => (
    <label className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-slate-300">{label}</span>
      <input
        type="number"
        step={step}
        defaultValue={settings[key]}
        onBlur={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v) && v !== settings[key]) save({ [key]: v });
        }}
        className="w-28 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-right text-slate-100"
      />
    </label>
  );

  const boolField = (key: string, label: string) => (
    <label className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-slate-300">{label}</span>
      <input
        type="checkbox"
        checked={!!settings[key]}
        onChange={(e) => save({ [key]: e.target.checked })}
        className="h-4 w-4"
      />
    </label>
  );

  return (
    <Layout title="Settings">
      <div className="mx-auto max-w-xl space-y-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 divide-y divide-slate-800">
          <div className="flex items-center justify-between gap-4 py-2 text-sm">
            <span className="text-slate-300">Local-only mode</span>
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-0.5 text-xs text-emerald-300">
              locked: true
            </span>
          </div>
          {boolField("enable_mock_sensor", "Mock sensor enabled")}
          {boolField("enable_ai_explanations", "AI explanations enabled")}
          {numberField("fusion_interval_seconds", "Fusion interval (seconds)", 0.5)}
          {numberField("breathing_like_threshold", "Breathing-like threshold")}
          {numberField("occupancy_threshold", "Occupancy threshold")}
          {numberField("bed_exit_confirmation_seconds", "Bed-exit confirmation (seconds)", 1)}
          <label className="flex items-center justify-between gap-4 py-2 text-sm">
            <span className="text-slate-300">Export path</span>
            <input
              defaultValue={settings.evidence_dir}
              onBlur={(e) => e.target.value !== settings.evidence_dir && save({ evidence_dir: e.target.value })}
              className="w-56 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
            />
          </label>
        </div>
        {message && <p className="text-xs text-slate-500">{message}</p>}
        <p className="text-xs text-slate-600">
          Settings apply immediately to the running prototype. Local-only mode cannot be disabled
          in BedSense V0.
        </p>
      </div>
    </Layout>
  );
}
