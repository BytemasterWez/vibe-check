import { useState } from "react";
import Layout from "@/components/Layout";
import ExperimentControls from "@/components/ExperimentControls";
import ReportExportButton from "@/components/ReportExportButton";
import { fmtDateTime, patch, usePoll } from "@/lib/api";

const PASS_TONES: Record<string, string> = {
  pass: "text-emerald-400",
  fail: "text-rose-400",
  partial: "text-amber-400",
  not_assessed: "text-slate-500",
};

function AssessButtons({ id, onChanged }: { id: string; onChanged: () => void }) {
  return (
    <span className="flex gap-1" title="Operator final assessment">
      {["pass", "partial", "fail"].map((v) => (
        <button
          key={v}
          className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-800"
          onClick={() => patch(`/experiments/${id}/assess`, { pass_fail: v }).then(onChanged)}
        >
          {v}
        </button>
      ))}
    </span>
  );
}

export default function Experiments() {
  const { data: experiments, refresh } = usePoll<any[]>("/experiments", 3000);
  const [expanded, setExpanded] = useState<string | null>(null);

  const active = experiments?.find((e) => !e.ended_at) ?? null;

  return (
    <Layout title="Experiment runner">
      <div className="space-y-6">
        <ExperimentControls
          activeSession={active ? { id: active.id, name: active.name } : null}
          onChanged={refresh}
        />

        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-300">Sessions</h2>
          <div className="space-y-2">
            {(experiments ?? []).map((s) => (
              <div key={s.id} className="rounded-lg border border-slate-800 bg-slate-900 p-3">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-medium text-slate-100">{s.name}</span>
                  <span className="text-xs text-slate-400">{s.scenario}</span>
                  <span className="text-xs text-slate-500">
                    {fmtDateTime(s.started_at)} → {s.ended_at ? fmtDateTime(s.ended_at) : "running"}
                  </span>
                  <span className={`text-xs font-semibold uppercase ${PASS_TONES[s.pass_fail] ?? ""}`}>
                    {s.pass_fail}
                  </span>
                  {s.actual_results?.suggested_pass_fail && (
                    <span className="text-xs text-slate-500">
                      suggested: {s.actual_results.suggested_pass_fail}
                    </span>
                  )}
                  {s.actual_results && (
                    <span className="text-xs text-slate-500">
                      fp {s.actual_results.false_positive_count} · fn{" "}
                      {s.actual_results.false_negative_count} · unscoped{" "}
                      {s.actual_results.unscoped_events_count ?? 0}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    {s.ended_at && <AssessButtons id={s.id} onChanged={refresh} />}
                    {s.ended_at && <ReportExportButton sessionId={s.id} onDone={refresh} />}
                    <button
                      className="text-xs text-sky-400 hover:underline"
                      onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                    >
                      {expanded === s.id ? "hide results" : "results"}
                    </button>
                  </span>
                </div>
                {expanded === s.id && (
                  <pre className="mt-2 overflow-x-auto rounded bg-slate-950 p-3 text-xs text-slate-400">
                    {JSON.stringify(
                      { expected_events: s.expected_events, actual_results: s.actual_results, notes: s.notes },
                      null,
                      2
                    )}
                  </pre>
                )}
              </div>
            ))}
            {!experiments?.length && (
              <p className="text-sm text-slate-500">No experiment sessions yet.</p>
            )}
          </div>
        </section>
      </div>
    </Layout>
  );
}
