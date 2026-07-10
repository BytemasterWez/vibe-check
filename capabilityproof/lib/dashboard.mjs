// Lightweight status dashboard: one server-rendered HTML page summarising
// every registered capability's latest receipt and history. Human-facing
// convenience only — the receipts are the product; software should consume
// the REST/MCP surfaces.

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ago(iso) {
  if (!iso) return '—';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

const STATUS_LABEL = {
  verified: 'Verified',
  failed_checks: 'Failed checks',
  unreachable: 'Unreachable',
  never_verified: 'Never verified',
};

export function renderDashboard(service) {
  const rows = service.listCapabilities().map((c) => {
    const receipt = c.latest_receipt ? service.store.getReceipt(c.latest_receipt.receipt_id) : null;
    const stats = service.store.historyStats(c.capability_id);
    return { c, receipt, stats };
  });

  const counts = { verified: 0, failed: 0, never: 0 };
  for (const { c } of rows) {
    if (!c.latest_receipt) counts.never++;
    else if (c.latest_receipt.status === 'verified') counts.verified++;
    else counts.failed++;
  }

  const tr = rows
    .map(({ c, receipt, stats }) => {
      const status = c.latest_receipt?.status || 'never_verified';
      const stale = c.latest_receipt && !c.latest_receipt.fresh ? ' (stale)' : '';
      const failures = receipt?.failures?.length
        ? `<details><summary>${receipt.failures.length} failing check${receipt.failures.length > 1 ? 's' : ''}</summary><ul>${receipt.failures.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></details>`
        : '';
      return `<tr>
        <td><code>${esc(c.capability_id)}</code><div class="claim">${esc(c.claim)}</div>${failures}</td>
        <td>${esc(c.category)}</td>
        <td class="s-${esc(status)}">${esc(STATUS_LABEL[status] || status)}${stale}</td>
        <td>${ago(c.latest_receipt?.verified_at)}</td>
        <td>${receipt?.results?.latency_ms != null ? receipt.results.latency_ms + 'ms' : '—'}</td>
        <td>${receipt?.results?.completeness_score ?? '—'}</td>
        <td>${stats.success_rate_30d ?? '—'}${stats.probes_30d ? ` <span class="dim">(${stats.probes_30d} probes)</span>` : ''}</td>
        <td>${stats.schema_changes_30d}</td>
      </tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="60">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CapabilityProof status</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 2rem auto; max-width: 72rem; padding: 0 1rem; line-height: 1.45; }
  h1 { font-size: 1.3rem; } .sub { opacity: .7; margin-bottom: 1.5rem; }
  table { border-collapse: collapse; width: 100%; font-size: .85rem; }
  th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent); vertical-align: top; }
  code { font-size: .85em; }
  .claim { opacity: .65; font-size: .85em; max-width: 28rem; }
  .dim { opacity: .55; }
  .s-verified { color: #1a7f37; } .s-failed_checks, .s-unreachable { color: #cf222e; } .s-never_verified { opacity: .6; }
  @media (prefers-color-scheme: dark) { .s-verified { color: #3fb950; } .s-failed_checks, .s-unreachable { color: #f85149; } }
  details ul { margin: .3rem 0 0; padding-left: 1.2rem; }
</style>
</head>
<body>
<h1>CapabilityProof — capability status</h1>
<p class="sub">${counts.verified} verified · ${counts.failed} failing · ${counts.never} never verified · rendered ${new Date().toISOString()} · refreshes every 60s</p>
<table>
<thead><tr><th>Capability</th><th>Category</th><th>Status</th><th>Verified</th><th>Latency</th><th>Completeness</th><th>30d success</th><th>Drift 30d</th></tr></thead>
<tbody>
${tr}
</tbody>
</table>
</body>
</html>`;
}
