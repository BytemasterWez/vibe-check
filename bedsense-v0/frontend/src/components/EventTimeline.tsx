import { fmtDateTime, patch } from "@/lib/api";

const SEVERITY_STYLES: Record<string, string> = {
  info: "bg-slate-700/50 text-slate-300",
  low: "bg-sky-500/15 text-sky-300",
  medium: "bg-amber-500/15 text-amber-300",
  high: "bg-rose-500/15 text-rose-300",
  review: "bg-purple-500/15 text-purple-300",
};

export interface EventRow {
  id: string;
  timestamp_utc: string;
  event_type: string;
  severity: string;
  confidence_score?: number | null;
  title?: string | null;
  description?: string | null;
  evidence?: Record<string, any> | null;
  acknowledged: boolean;
}

export default function EventTimeline({
  events,
  onChanged,
  compact = false,
}: {
  events: EventRow[];
  onChanged?: () => void;
  compact?: boolean;
}) {
  if (!events.length) {
    return <p className="text-sm text-slate-500">No events recorded yet.</p>;
  }
  return (
    <ol className="space-y-2">
      {events.map((e) => (
        <li key={e.id} className="rounded-lg border border-slate-800 bg-slate-900 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono text-xs text-slate-400">{fmtDateTime(e.timestamp_utc)}</span>
            <span className="font-medium text-slate-100">{e.event_type}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${SEVERITY_STYLES[e.severity] ?? SEVERITY_STYLES.info}`}>
              {e.severity}
            </span>
            {e.confidence_score != null && (
              <span className="text-xs text-slate-400">conf {Math.round(e.confidence_score * 100)}%</span>
            )}
            <span className="ml-auto text-xs">
              {e.acknowledged ? (
                <span className="text-emerald-400">acknowledged</span>
              ) : (
                onChanged && (
                  <button
                    className="rounded border border-slate-600 px-2 py-0.5 text-slate-300 hover:bg-slate-800"
                    onClick={() => patch(`/events/${e.id}/acknowledge`).then(onChanged)}
                  >
                    Acknowledge
                  </button>
                )
              )}
            </span>
          </div>
          {!compact && (
            <>
              {e.description && <p className="mt-1 text-sm text-slate-400">{e.description}</p>}
              {e.evidence && (
                <details className="mt-1 text-xs text-slate-500">
                  <summary className="cursor-pointer hover:text-slate-300">Evidence</summary>
                  <pre className="mt-1 overflow-x-auto rounded bg-slate-950 p-2">
                    {JSON.stringify(e.evidence, null, 2)}
                  </pre>
                </details>
              )}
            </>
          )}
        </li>
      ))}
    </ol>
  );
}
