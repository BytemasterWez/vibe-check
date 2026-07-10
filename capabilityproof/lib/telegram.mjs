// Telegram transport for alerts and daily reports.
//
// Configure with TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.
// One-time setup (see README): create a bot with @BotFather, message it once,
// then run `node capabilityproof/report.mjs setup-telegram` to discover the
// chat id automatically.

const API_TIMEOUT_MS = 10000;

export function telegramConfigured(env = process.env) {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
}

function apiBase(env = process.env) {
  const root = env.TELEGRAM_API_URL || 'https://api.telegram.org';
  return `${root}/bot${env.TELEGRAM_BOT_TOKEN}`;
}

export async function sendTelegram(text, { env = process.env, silent = false } = {}) {
  if (!telegramConfigured(env)) return { sent: false, reason: 'telegram not configured' };
  try {
    const res = await fetch(`${apiBase(env)}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: text.slice(0, 4000), // Telegram hard limit is 4096
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        disable_notification: silent,
      }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return { sent: false, reason: `telegram API: HTTP ${res.status} ${data.description || ''}`.trim() };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

// Poll getUpdates once to discover the chat id after the user messages the bot.
export async function discoverChatId(env = process.env) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('set TELEGRAM_BOT_TOKEN first');
  const res = await fetch(`${apiBase(env)}/getUpdates`, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  const data = await res.json();
  if (!data.ok) throw new Error(`telegram API: ${data.description || 'getUpdates failed'}`);
  const chats = new Map();
  for (const u of data.result || []) {
    const chat = u.message?.chat || u.channel_post?.chat;
    if (chat) chats.set(chat.id, `${chat.first_name || chat.title || ''} ${chat.username ? '@' + chat.username : ''}`.trim());
  }
  return [...chats.entries()].map(([id, name]) => ({ chat_id: id, name }));
}

function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

export function formatEventMessage(event) {
  if (event.event === 'capability_status_changed') {
    const bad = event.to !== 'verified';
    const head = bad ? '🔴 <b>Capability failing</b>' : '🟢 <b>Capability recovered</b>';
    const lines = [
      `${head}`,
      `<code>${esc(event.capability_id)}</code>`,
      `${esc(event.from ?? 'new')} → <b>${esc(event.to)}</b>`,
    ];
    for (const f of (event.failures || []).slice(0, 3)) lines.push(`• ${esc(f)}`);
    if (bad && event.fallback_capability_ids?.length) {
      lines.push(`Fallbacks: ${event.fallback_capability_ids.map((id) => `<code>${esc(id)}</code>`).join(', ')}`);
    }
    return lines.join('\n');
  }
  if (event.event === 'capability_schema_drift') {
    return [
      '🟡 <b>Schema drift detected</b>',
      `<code>${esc(event.capability_id)}</code>`,
      'The response shape changed between probes. Checks still pass, but downstream pipelines may need review.',
    ].join('\n');
  }
  if (event.event === 'doctor_alert') {
    return [
      `${event.severity === 'critical' ? '🚨' : '⚠️'} <b>Doctor: ${esc(event.title)}</b>`,
      esc(event.detail || ''),
      event.remediation ? `Action taken: ${esc(event.remediation)}` : '',
    ].filter(Boolean).join('\n');
  }
  return `<b>${esc(event.event)}</b>\n<code>${esc(JSON.stringify(event).slice(0, 500))}</code>`;
}
