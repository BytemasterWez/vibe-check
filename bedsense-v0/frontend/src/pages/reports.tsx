import Layout from "@/components/Layout";
import { fmtDateTime, usePoll } from "@/lib/api";

const CSV_KINDS = ["sensor_readings", "bed_states", "events", "experiment_summary", "risk_register"];

function DownloadLink({ reportId, kind, label }: { reportId: string; kind: string; label: string }) {
  return (
    <a
      href={`/api/bedsense/reports/${reportId}/download/${kind}`}
      className="rounded border border-slate-700 px-2 py-1 text-xs text-sky-300 hover:bg-slate-800"
    >
      {label}
    </a>
  );
}

export default function Reports() {
  const { data: reports } = usePoll<any[]>("/reports", 5000);

  return (
    <Layout title="Evidence reports">
      <div className="space-y-3">
        {(reports ?? []).map((r) => (
          <div key={r.id} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium text-slate-100">{r.name}</span>
              <span className="text-xs text-slate-500">session {r.session_id?.slice(0, 8) ?? "—"}</span>
              <span className="text-xs text-slate-500">{fmtDateTime(r.created_at)}</span>
            </div>
            {r.summary && (
              <p className="mt-1 text-xs text-slate-400">
                {r.summary.scenario} · {r.summary.events_count} events ·{" "}
                {r.summary.readings_count} readings · fp{" "}
                {r.summary.false_positive_count ?? "—"} · fn{" "}
                {r.summary.false_negative_count ?? "—"} · unscoped{" "}
                {r.summary.unscoped_events_count ?? "—"} · operator assessment:{" "}
                {r.summary.operator_final_assessment ?? r.summary.pass_fail}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <DownloadLink reportId={r.id} kind="markdown" label="Download Markdown" />
              <DownloadLink reportId={r.id} kind="json" label="Download JSON" />
              {CSV_KINDS.map((k) => (
                <DownloadLink key={k} reportId={r.id} kind={k} label={`CSV: ${k}`} />
              ))}
            </div>
          </div>
        ))}
        {!reports?.length && (
          <p className="text-sm text-slate-500">
            No evidence reports yet. Stop an experiment session, then export from the Experiments page.
          </p>
        )}
        <p className="pt-2 text-xs text-slate-600">
          Each pack covers exactly one session and includes the Markdown report, JSON summary,
          five CSV exports, event timeline, risk register snapshot, screenshot placeholder and the
          prototype boundary statement. Fusion confidence is an internal prototype scoring
          measure, not clinical accuracy.
        </p>
      </div>
    </Layout>
  );
}
