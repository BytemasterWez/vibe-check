// Runtime proxy to the BedSense API. A Next.js rewrite would bake the target
// URL in at build time; this route reads API_BASE_URL per request, which the
// Docker setup relies on (the dashboard image is built before compose sets
// API_BASE_URL=http://api:8088). Local-only: it only ever talks to the
// configured local API.
import type { NextApiRequest, NextApiResponse } from "next";

export const config = { api: { bodyParser: false } };

function readBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const base = (process.env.API_BASE_URL || "http://localhost:8088").replace(/\/$/, "");
  const suffix = (req.url || "").replace(/^\/api\/bedsense/, "");
  const method = req.method || "GET";

  const body = method === "GET" || method === "HEAD" ? undefined : await readBody(req);

  try {
    const upstream = await fetch(`${base}${suffix}`, {
      method,
      headers: { "content-type": (req.headers["content-type"] as string) || "application/json" },
      body: body && body.length ? new Uint8Array(body) : undefined,
    });
    res.status(upstream.status);
    for (const header of ["content-type", "content-disposition"]) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    res.status(502).json({ detail: `BedSense API unreachable at ${base}: ${String(error)}` });
  }
}
