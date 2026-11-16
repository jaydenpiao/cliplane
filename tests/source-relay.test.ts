import { afterEach, describe, expect, it, vi } from "vitest";
import { relaySources } from "../apps/web/lib/server/source-relay";

afterEach(() => vi.unstubAllEnvs());

describe("streamed source API relay", () => {
  it("starts forwarding before the upload stream has produced any bytes", async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    const request = new Request("http://localhost:3000/api/sources", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    let started = false;
    const send: typeof fetch = async (_url, init) => {
      started = true;
      expect(init?.body).toBe(request.body);
      expect(init?.signal).toBe(request.signal);
      return Response.json({ id: "test-source" }, { status: 201 });
    };
    const result = relaySources(request, send);
    expect(started).toBe(true);
    controller?.close();
    expect((await result).status).toBe(201);
  });
  it("preserves session and cross-site controls and fixes the upstream destination", async () => {
    const request = new Request("https://untrusted.invalid/api/sources?target=other", {
      method: "POST",
      body: "multipart-test",
      headers: {
        cookie: "cliplane_session=test-session",
        origin: "https://untrusted.invalid",
        "sec-fetch-site": "cross-site",
        "content-type": "multipart/form-data; boundary=test",
        "x-forwarded-for": "1.2.3.4",
        authorization: "unexpected",
      },
    });
    const response = await relaySources(request, async (url, init) => {
      expect(url).toBe("http://127.0.0.1:4000/api/sources");
      const headers = new Headers(init?.headers);
      expect(headers.get("cookie")).toBe("cliplane_session=test-session");
      expect(headers.get("origin")).toBe("https://untrusted.invalid");
      expect(headers.get("sec-fetch-site")).toBe("cross-site");
      expect(headers.has("x-forwarded-for")).toBe(false);
      expect(headers.has("authorization")).toBe(false);
      expect(init?.redirect).toBe("manual");
      return Response.json({ error: "Cross-site requests are not allowed" }, { status: 403 });
    });
    expect(response.status).toBe(403);
  });
  it("preserves API limits and private caching without forwarding hop headers", async () => {
    const response = await relaySources(new Request("http://localhost:3000/api/sources"), async () =>
      Response.json(
        { error: "Limit exceeded" },
        {
          status: 413,
          headers: {
            "retry-after": "30",
            "cache-control": "public",
            "content-length": "999",
            connection: "keep-alive",
          },
        },
      ),
    );
    expect(response.status).toBe(413);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.has("content-length")).toBe(false);
    expect(response.headers.has("connection")).toBe(false);
  });
  it("fails closed for invalid upstream config and hides transport details", async () => {
    vi.stubEnv("API_PORT", "4000@untrusted.invalid");
    const send = vi.fn();
    expect((await relaySources(new Request("http://localhost:3000/api/sources"), send)).status).toBe(502);
    expect(send).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    const result = await relaySources(new Request("http://localhost:3000/api/sources"), async () => {
      throw new Error("internal address and credentials");
    });
    expect(result.status).toBe(502);
    expect(await result.text()).not.toContain("credentials");
  });
});
