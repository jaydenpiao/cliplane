const requestHeaders = ["cookie", "origin", "sec-fetch-site", "content-type", "content-length"];
const responseHeaders = [
  "content-type",
  "retry-after",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
];

/** Stream uploads to the authenticated API without Next's external-rewrite body clone. */
export async function relaySources(request: Request, send: typeof fetch = fetch): Promise<Response> {
  const headers = new Headers();
  for (const name of requestHeaders) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const port = Number(process.env.API_PORT || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    return Response.json({ error: "Source API configuration is invalid" }, { status: 502 });
  try {
    const init: RequestInit & { duplex?: "half" } = {
      method: request.method,
      headers,
      cache: "no-store",
      redirect: "manual",
      signal: request.signal,
      ...(request.method === "POST" ? { body: request.body, duplex: "half" } : {}),
    };
    const upstream = await send(`http://127.0.0.1:${port}/api/sources`, init);
    const outgoing = new Headers({ "cache-control": "private, no-store" });
    for (const name of responseHeaders) {
      const value = upstream.headers.get(name);
      if (value !== null) outgoing.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers: outgoing });
  } catch {
    return Response.json(
      { error: request.signal.aborted ? "Upload interrupted" : "Source API temporarily unavailable" },
      { status: request.signal.aborted ? 499 : 502, headers: { "cache-control": "private, no-store" } },
    );
  }
}
