import { useState } from "react";
import { fmtTime } from "@/lib/api";

export interface ReadingRow {
  id: string;
  timestamp_utc: string;
  sensor_type: string;
  metric: string;
  value_float?: number | null;
  value_text?: string | null;
  unit?: string | null;
  quality_score?: number | null;
  raw_payload?: Record<string, any> | null;
}

export default function SensorStreamTable({ readings }: { readings: ReadingRow[] }) {
  const [selected, setSelected] = useState<ReadingRow | null>(null);
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-400">
          <tr>
            <th className="px-3 py-2">Timestamp</th>
            <th className="px-3 py-2">Sensor type</th>
            <th className="px-3 py-2">Metric</th>
            <th className="px-3 py-2">Value</th>
            <th className="px-3 py-2">Unit</th>
            <th className="px-3 py-2">Quality</th>
            <th className="px-3 py-2">Raw</th>
          </tr>
        </thead>
        <tbody>
          {readings.map((r) => (
            <tr key={r.id} className="border-t border-slate-800/60 hover:bg-slate-900/60">
              <td className="px-3 py-1.5 font-mono text-xs text-slate-400">{fmtTime(r.timestamp_utc)}</td>
              <td className="px-3 py-1.5">{r.sensor_type}</td>
              <td className="px-3 py-1.5 text-slate-300">{r.metric}</td>
              <td className="px-3 py-1.5 font-mono">{r.value_float ?? r.value_text ?? "—"}</td>
              <td className="px-3 py-1.5 text-slate-400">{r.unit ?? "—"}</td>
              <td className="px-3 py-1.5 text-slate-400">{r.quality_score ?? "—"}</td>
              <td className="px-3 py-1.5">
                <button
                  className="text-xs text-sky-400 hover:underline"
                  onClick={() => setSelected(selected?.id === r.id ? null : r)}
                >
                  {selected?.id === r.id ? "hide" : "view"}
                </button>
              </td>
            </tr>
          ))}
          {!readings.length && (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                No readings yet. Start a mock scenario from the Experiments page.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {selected && (
        <pre className="border-t border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
          {JSON.stringify(selected.raw_payload ?? {}, null, 2)}
        </pre>
      )}
    </div>
  );
}
