import { useState } from "react";
import Layout from "@/components/Layout";
import { patch, post, usePoll } from "@/lib/api";

const CATEGORIES = [
  "false_positive", "false_negative", "sensor_failure", "signal_conflict",
  "privacy", "regulatory", "user_misunderstanding", "technical",
];
const STATUSES = ["open", "mitigated", "accepted", "needs_review"];

const STATUS_TONES: Record<string, string> = {
  open: "text-amber-300",
  mitigated: "text-emerald-300",
  accepted: "text-sky-300",
  needs_review: "text-rose-300",
};

export default function RiskRegister() {
  const { data: risks, refresh } = usePoll<any[]>("/risk-register", 5000);
  const [form, setForm] = useState({
    risk_title: "",
    risk_category: "technical",
    description: "",
    possible_cause: "",
    impact: "",
    mitigation: "",
  });
  const set = (k: string) => (e: any) => setForm({ ...form, [k]: e.target.value });

  return (
    <Layout title="Risk register">
      <div className="space-y-6">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-300">Add risk</h2>
          <div className="grid gap-2 md:grid-cols-2">
            <input placeholder="Risk title" value={form.risk_title} onChange={set("risk_title")}
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100" />
            <select value={form.risk_category} onChange={set("risk_category")}
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100">
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <input placeholder="Description" value={form.description} onChange={set("description")}
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100" />
            <input placeholder="Possible cause" value={form.possible_cause} onChange={set("possible_cause")}
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100" />
            <input placeholder="Impact" value={form.impact} onChange={set("impact")}
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100" />
            <input placeholder="Mitigation" value={form.mitigation} onChange={set("mitigation")}
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100" />
          </div>
          <button
            className="mt-3 rounded bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500 disabled:opacity-40"
            disabled={!form.risk_title}
            onClick={() =>
              post("/risk-register", form).then(() => {
                setForm({ risk_title: "", risk_category: "technical", description: "",
                          possible_cause: "", impact: "", mitigation: "" });
                refresh();
              })
            }
          >
            Add risk
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-2">Risk</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Impact</th>
                <th className="px-3 py-2">Mitigation</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {(risks ?? []).map((r) => (
                <tr key={r.id} className="border-t border-slate-800/60 align-top">
                  <td className="px-3 py-2 font-medium text-slate-200">{r.risk_title}</td>
                  <td className="px-3 py-2 text-slate-400">{r.risk_category}</td>
                  <td className="px-3 py-2 text-slate-400">{r.description}</td>
                  <td className="px-3 py-2 text-slate-400">{r.impact}</td>
                  <td className="px-3 py-2 text-slate-400">{r.mitigation}</td>
                  <td className="px-3 py-2">
                    <select
                      value={r.status}
                      onChange={(e) =>
                        patch(`/risk-register/${r.id}`, { status: e.target.value }).then(refresh)
                      }
                      className={`rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs ${STATUS_TONES[r.status] ?? ""}`}
                    >
                      {STATUSES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
              {!risks?.length && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">Risk register is empty.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
