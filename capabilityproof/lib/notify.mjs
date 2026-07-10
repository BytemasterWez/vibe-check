// Notifications: tell subscribers when a capability's verification status
// changes (outage, recovery, first verification) or its response schema
// drifts while remaining nominally healthy.
//
// Transports: generic JSON webhook (CAPABILITYPROOF_WEBHOOK_URL) and
// Telegram (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID). Either, both, or neither.

import { telegramConfigured, sendTelegram, formatEventMessage } from './telegram.mjs';

const WEBHOOK_TIMEOUT_MS = 5000;

export function buildEvents(previous, receipt) {
  const events = [];
  const prevStatus = previous?.status ?? null;

  if (prevStatus !== receipt.status) {
    events.push({
      event: 'capability_status_changed',
      capability_id: receipt.capability_id,
      from: prevStatus,
      to: receipt.status,
      receipt_id: receipt.receipt_id,
      verified_at: receipt.verified_at,
      failures: (receipt.failures || []).slice(0, 5),
      fallback_capability_ids: receipt.fallback_capability_ids || [],
    });
  }

  const prevSchema = previous?.history?.schema_hash;
  const newSchema = receipt.history?.schema_hash;
  if (prevSchema && newSchema && prevSchema !== newSchema) {
    events.push({
      event: 'capability_schema_drift',
      capability_id: receipt.capability_id,
      receipt_id: receipt.receipt_id,
      verified_at: receipt.verified_at,
      previous_schema_hash: prevSchema,
      new_schema_hash: newSchema,
      status: receipt.status,
    });
  }
  return events;
}

export async function notify({ previous, receipt, webhookUrl }) {
  const url = webhookUrl ?? process.env.CAPABILITYPROOF_WEBHOOK_URL;
  const events = buildEvents(previous, receipt);
  if (events.length === 0) return { sent: 0, events };

  let sent = 0;
  for (const event of events) {
    if (url) {
      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
          signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        });
        sent++;
      } catch (err) {
        console.error(`[capabilityproof] webhook delivery failed (${event.event} for ${event.capability_id}): ${err.message}`);
      }
    }
    if (telegramConfigured()) {
      const result = await sendTelegram(formatEventMessage(event));
      if (result.sent) sent++;
      else console.error(`[capabilityproof] telegram delivery failed (${event.event} for ${event.capability_id}): ${result.reason}`);
    }
  }
  return { sent, events };
}
