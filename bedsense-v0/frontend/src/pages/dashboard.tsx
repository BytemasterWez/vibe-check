import Layout from "@/components/Layout";
import BedStatusCard from "@/components/BedStatusCard";
import SignalQualityPanel from "@/components/SignalQualityPanel";
import EventTimeline, { EventRow } from "@/components/EventTimeline";
import SensorStreamTable, { ReadingRow } from "@/components/SensorStreamTable";
import RiskStateBadge from "@/components/RiskStateBadge";
import { fmtDateTime, triLabel, usePoll } from "@/lib/api";

const MOVEMENT_LABELS: Record<string, string> = {
  empty: "Empty",
  still: "Still",
  low_movement: "Low",
  active_movement: "Active",
  unknown: "Unknown",
};

export default function Dashboard() {
  const { data: current } = usePoll<any>("/state/current", 1000);
  const { data: mock } = usePoll<any>("/mock/status", 3000);
  const { data: readings } = usePoll<ReadingRow[]>("/readings?limit=18", 2000);
  const { data: events, refresh: refreshEvents } = usePoll<EventRow[]>("/events?limit=6", 2000);
  const { data: experiments } = usePoll<any[]>("/experiments", 5000);

  const state = current?.state;
  const activeSession = experiments?.find((e) => e.id === mock?.session_id || (!e.ended_at && mock?.session_id === e.id));
  const sessionName =
    activeSession?.name ?? experiments?.find((e) => !e.ended_at)?.name ?? "No active session";

  const occupiedTone = state?.occupied === true ? "good" : state?.occupied === false ? "info" : "neutral";
  const breathingTone =
    state?.breathing_like_detected === true
      ? "good"
      : state?.breathing_like_detected === false
        ? "warn"
        : "neutral";

  return (
    <Layout title="Dashboard">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
          <span>
            Session: <span className="text-slate-200">{sessionName}</span>
          </span>
          <span>
            Mock:{" "}
            <span className="text-slate-200">
              {mock?.mock_running ? `running (${mock.scenario}, ${mock.speed})` : "stopped"}
            </span>
          </span>
          <span className="ml-auto">
            Last reading: <span className="text-slate-200">{fmtDateTime(current?.last_reading_at)}</span>
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          <BedStatusCard
            label="Bed occupied"
            value={triLabel(state?.occupied, "Yes", "No")}
            tone={occupiedTone as any}
          />
          <BedStatusCard
            label="Movement"
            value={MOVEMENT_LABELS[state?.movement_state ?? "unknown"] ?? "Unknown"}
            tone={state?.movement_state === "active_movement" ? "warn" : "neutral"}
          />
          <BedStatusCard
            label="Breathing-like motion"
            value={triLabel(state?.breathing_like_detected, "Detected", "Not detected")}
            tone={breathingTone as any}
          />
          <div className="rounded-xl border border-slate-600 bg-slate-800/60 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-400">Bed-exit risk</div>
            <div className="mt-2">
              <RiskStateBadge risk={state?.bed_exit_risk} />
            </div>
          </div>
          <BedStatusCard
            label="Overall state"
            value={(state?.overall_state ?? "unknown").replaceAll("_", " ")}
            tone={state?.overall_state === "possible_bed_exit" ? "bad" : "info"}
            detail={
              state?.confidence_score != null
                ? `confidence ${Math.round(state.confidence_score * 100)}%`
                : undefined
            }
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <SignalQualityPanel quality={state?.signal_quality} sourceSummary={state?.source_summary} />
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 lg:col-span-2">
            <h2 className="text-sm font-semibold text-slate-300">Why this state?</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              {state?.explanation ?? "No bed state yet — start a mock scenario from the Experiments page."}
            </p>
            <div className="mt-3 text-xs text-slate-500">
              Last event:{" "}
              {current?.last_event ? (
                <span className="text-slate-300">
                  {current.last_event.event_type} ({current.last_event.severity}) at{" "}
                  {fmtDateTime(current.last_event.timestamp_utc)}
                </span>
              ) : (
                "none"
              )}
              <span className="ml-4">Prototype status: {current?.prototype_status ?? "—"}</span>
            </div>
          </div>
        </div>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-300">Recent events</h2>
          <EventTimeline events={events ?? []} onChanged={refreshEvents} compact />
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-300">Sensor streams</h2>
          <SensorStreamTable readings={readings ?? []} />
        </section>
      </div>
    </Layout>
  );
}
