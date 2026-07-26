import { useState } from "react";
import { post } from "@/lib/api";

const SCENARIO_BUTTONS = [
  { scenario: "empty_bed", label: "Empty bed" },
  { scenario: "person_enters_bed", label: "Person enters bed" },
  { scenario: "person_still", label: "Still breathing-like" },
  { scenario: "person_moving", label: "Movement" },
  { scenario: "bed_exit", label: "Bed exit" },
  { scenario: "mixed_sequence", label: "Full mixed sequence" },
];

const SCENARIOS = [
  "empty_bed", "person_enters_bed", "person_still", "person_moving",
  "breathing_like_motion", "bed_exit", "restless_night", "mixed_sequence",
  "csv_replay", "manual_test",
];

export default function ExperimentControls({
  activeSession,
  onChanged,
}: {
  activeSession: { id: string; name: string } | null;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [scenario, setScenario] = useState("manual_test");
  const [operator, setOperator] = useState("");
  const [speed, setSpeed] = useState("realtime");
  const [marker, setMarker] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const run = (fn: () => Promise<any>) =>
    fn()
      .then(() => {
        setMessage(null);
        onChanged();
      })
      .catch((e) => setMessage(String(e)));

  return (
    <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-4">
      <h2 className="text-sm font-semibold text-slate-300">Experiment controls</h2>

      {!activeSession ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-400">
            Session name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="T001_empty_bed_10min"
              className="mt-1 block w-56 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
            />
          </label>
          <label className="text-xs text-slate-400">
            Scenario
            <select
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              className="mt-1 block rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
            >
              {SCENARIOS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-400">
            Operator
            <input
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
              className="mt-1 block w-36 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
            />
          </label>
          <button
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40"
            disabled={!name}
            onClick={() =>
              run(() =>
                post("/experiments/start", {
                  name,
                  scenario,
                  operator_name: operator || null,
                })
              )
            }
          >
            Start experiment
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-300">
            Running: <span className="font-medium text-sky-300">{activeSession.name}</span>
          </span>
          <button
            className="rounded bg-rose-600 px-4 py-2 text-sm font-medium hover:bg-rose-500"
            onClick={() => run(() => post(`/experiments/${activeSession.id}/stop`))}
          >
            Stop experiment
          </button>
          <input
            value={marker}
            onChange={(e) => setMarker(e.target.value)}
            placeholder="Marker note"
            className="w-48 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          />
          <button
            className="rounded border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800"
            onClick={() =>
              run(() =>
                post(`/experiments/${activeSession.id}/mark`, {
                  title: "Manual marker",
                  description: marker || null,
                }).then(() => setMarker(""))
              )
            }
          >
            Add manual marker
          </button>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center gap-3 text-xs text-slate-400">
          <span>
            {activeSession ? "Mock scenarios (feed current session)" : "One-click demos"}
          </span>
          <label className="flex items-center gap-1">
            Speed
            <select
              value={speed}
              onChange={(e) => setSpeed(e.target.value)}
              className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-slate-100"
            >
              <option value="realtime">realtime</option>
              <option value="fast">fast</option>
            </select>
          </label>
          {!activeSession && (
            <span className="text-slate-500">
              Each demo auto-creates its own session and finishes report-ready.
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {SCENARIO_BUTTONS.map((b) => (
            <button
              key={b.scenario}
              className="rounded border border-sky-700/60 bg-sky-600/10 px-3 py-1.5 text-sm text-sky-200 hover:bg-sky-600/25"
              onClick={() =>
                run(() =>
                  activeSession
                    ? post("/mock/scenario", { scenario: b.scenario, speed })
                    : post("/demo/run", { scenario: b.scenario, speed })
                )
              }
            >
              {activeSession ? `Run mock ${b.label.toLowerCase()}` : `${b.label} demo`}
            </button>
          ))}
          <button
            className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            onClick={() => run(() => post("/mock/stop"))}
          >
            Stop mock
          </button>
          <button
            className="rounded border border-rose-700/60 bg-rose-600/10 px-3 py-1.5 text-sm text-rose-200 hover:bg-rose-600/25"
            title="Stops the mock, closes open sessions and clears orphan data. Evidence reports are kept."
            onClick={() => {
              if (
                confirm(
                  "Reset demo data? This stops the mock, closes any open session and " +
                    "clears unscoped orphan data. Evidence reports are kept."
                )
              ) {
                run(() => post("/demo/reset", { delete_reports: false }));
              }
            }}
          >
            Reset demo data
          </button>
        </div>
      </div>

      {message && <p className="text-xs text-rose-400">{message}</p>}
    </div>
  );
}
