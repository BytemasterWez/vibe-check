const RISK_STYLES: Record<string, string> = {
  low: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  medium: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  high: "bg-rose-500/15 text-rose-300 border-rose-500/40",
  unknown: "bg-slate-700/40 text-slate-300 border-slate-600",
};

export default function RiskStateBadge({ risk }: { risk?: string | null }) {
  const key = risk && RISK_STYLES[risk] ? risk : "unknown";
  return (
    <span className={`inline-block rounded-full border px-3 py-0.5 text-sm font-medium capitalize ${RISK_STYLES[key]}`}>
      {key}
    </span>
  );
}
