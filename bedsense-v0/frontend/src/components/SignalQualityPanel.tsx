const QUALITY_TONES: Record<string, string> = {
  good: "text-emerald-300",
  fair: "text-sky-300",
  poor: "text-amber-300",
  missing: "text-slate-400",
  conflicting: "text-rose-300",
};

function Bar({ label, score }: { label: string; score?: number | null }) {
  const pct = score == null ? 0 : Math.round(score * 100);
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-400">
        <span>{label}</span>
        <span>{score == null ? "—" : `${pct}%`}</span>
      </div>
      <div className="mt-1 h-2 rounded bg-slate-800">
        <div
          className={`h-2 rounded ${pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-sky-500" : pct >= 30 ? "bg-amber-500" : "bg-rose-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function SignalQualityPanel({
  quality,
  sourceSummary,
}: {
  quality?: string | null;
  sourceSummary?: Record<string, any> | null;
}) {
  const tone = QUALITY_TONES[quality ?? "missing"] ?? "text-slate-400";
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-300">Signal quality</h2>
        <span className={`text-lg font-semibold capitalize ${tone}`}>{quality ?? "missing"}</span>
      </div>
      <div className="mt-3 space-y-3">
        <Bar label="Pressure sensor" score={sourceSummary?.pressure_quality} />
        <Bar label="Radar sensor" score={sourceSummary?.radar_quality} />
      </div>
      {sourceSummary?.conflict && (
        <p className="mt-3 text-xs text-rose-300">
          Sensors disagree about occupancy — review sensor streams.
        </p>
      )}
    </div>
  );
}
