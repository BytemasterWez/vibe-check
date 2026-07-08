const TONE_STYLES: Record<string, string> = {
  good: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  info: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  bad: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  neutral: "border-slate-600 bg-slate-800/60 text-slate-300",
};

export default function BedStatusCard({
  label,
  value,
  tone = "neutral",
  detail,
}: {
  label: string;
  value: string;
  tone?: keyof typeof TONE_STYLES;
  detail?: string;
}) {
  return (
    <div className={`rounded-xl border p-4 ${TONE_STYLES[tone]}`}>
      <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {detail && <div className="mt-1 text-xs opacity-70">{detail}</div>}
    </div>
  );
}
