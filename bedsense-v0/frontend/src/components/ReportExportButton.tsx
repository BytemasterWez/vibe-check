import { useState } from "react";
import { post } from "@/lib/api";

export default function ReportExportButton({
  sessionId,
  onDone,
}: {
  sessionId: string;
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span>
      <button
        className="rounded border border-emerald-700/60 bg-emerald-600/10 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-600/25 disabled:opacity-40"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          post("/reports/evidence-pack", { session_id: sessionId })
            .then(() => onDone?.())
            .catch((e) => setError(String(e)))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Exporting…" : "Export evidence report"}
      </button>
      {error && <span className="ml-2 text-xs text-rose-400">{error}</span>}
    </span>
  );
}
