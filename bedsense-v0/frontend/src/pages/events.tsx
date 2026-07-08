import { useState } from "react";
import Layout from "@/components/Layout";
import EventTimeline, { EventRow } from "@/components/EventTimeline";
import { usePoll } from "@/lib/api";

const EVENT_TYPES = [
  "", "bed_empty", "bed_entry", "movement_detected", "stillness_detected",
  "breathing_like_detected", "breathing_like_not_detected", "possible_bed_exit",
  "bed_exit", "signal_quality_warning", "sensor_conflict", "manual_note", "test_marker",
];
const SEVERITIES = ["", "info", "low", "medium", "high", "review"];

export default function Events() {
  const [eventType, setEventType] = useState("");
  const [severity, setSeverity] = useState("");
  const query = `/events?limit=200${eventType ? `&event_type=${eventType}` : ""}${severity ? `&severity=${severity}` : ""}`;
  const { data: events, refresh } = usePoll<EventRow[]>(query, 3000);

  return (
    <Layout title="Event timeline">
      <div className="mb-4 flex flex-wrap gap-3 text-xs text-slate-400">
        <label>
          Event type
          <select
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="ml-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
          >
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t || "all"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Severity
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="ml-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s || "all"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <EventTimeline events={events ?? []} onChanged={refresh} />
    </Layout>
  );
}
