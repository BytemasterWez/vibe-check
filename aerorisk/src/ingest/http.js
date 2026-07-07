// Thin fetch wrapper used by all adapters. Injectable (ctx.fetchImpl) so
// tests can simulate 403s, timeouts, and page fixtures without a network.

const DEFAULT_TIMEOUT_MS = 120_000;

export async function httpGetBuffer(fetchImpl, url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const res = await fetchImpl(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return { buffer: Buffer.from(await res.arrayBuffer()), status: res.status };
}

export async function httpGetText(fetchImpl, url, opts) {
  const { buffer, status } = await httpGetBuffer(fetchImpl, url, opts);
  return { text: buffer.toString('utf8'), status };
}

// Extracts hrefs from an HTML page, resolved against the page URL.
export function extractLinks(html, pageUrl) {
  const links = [];
  const re = /href\s*=\s*["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      links.push(new URL(m[1], pageUrl).href);
    } catch {
      // ignore malformed hrefs
    }
  }
  return links;
}
