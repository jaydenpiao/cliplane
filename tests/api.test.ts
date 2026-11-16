import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Config } from "../apps/api/src/config";
import { expireSources, JobRunner } from "../apps/api/src/jobs";
import { buildApp } from "../apps/api/src/server";
import { Database } from "../packages/db/src/index";

const schema = `test_${randomUUID().replaceAll("-", "")}`;
const url = process.env.TEST_DATABASE_URL || "postgres://cliplane:cliplane_local@127.0.0.1:54329/cliplane";
const admin = new Database(url);
const db = new Database(url, schema);
let app: Awaited<ReturnType<typeof buildApp>>;
let runner: JobRunner;
let root: string;
let cookieA: string;
let cookieB: string;
let sourceId: string;
let candidateId: string;
let video: Buffer;
async function review(decision = "approved", reason = "Human reviewed this exact revision") {
  const c = (
    await app.inject({ url: `/api/candidates/${candidateId}`, headers: { cookie: cookieA } })
  ).json();
  return app.inject({
    method: "POST",
    url: `/api/candidates/${candidateId}/review`,
    headers: { cookie: cookieA },
    payload: {
      decision,
      reason,
      expectedRevision: c.edit_revision,
      expectedRightsRevision: c.rights_revision,
    },
  });
}
const metadata = {
  title: "Synthetic creator footage",
  creator: "Avery",
  game: "Synthetic demo",
  platform: "local",
  capturedAt: "2026-11-15T00:00:00Z",
  authorizationBasis: "I created this original test recording",
  attestation: true,
  voiceAuthorized: true,
  embargoed: false,
};

function multipart(meta: object, content: Buffer, fileFirst = false) {
  const boundary = `clip${randomUUID()}`;
  const field = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(meta)}\r\n`,
  );
  const file = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="../../tricky 'file.mp4"\r\nContent-Type: video/mp4\r\n\r\n`,
    ),
    content,
    Buffer.from("\r\n"),
  ]);
  return {
    payload: Buffer.concat([
      ...(fileFirst ? [file, field] : [field, file]),
      Buffer.from(`--${boundary}--\r\n`),
    ]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await db.migrate();
  root = await mkdtemp(path.join(os.tmpdir(), "cliplane-api-"));
  const fixture = path.join(root, "fixture.mp4");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x180:r=24:d=3",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    fixture,
  ]);
  video = await readFile(fixture);
  const config: Config = {
    databaseUrl: url,
    dataDir: path.join(root, "store"),
    origin: "http://localhost:3000",
    apiPort: 4000,
    cookieSecure: false,
    demoEnabled: false,
    maxUploadBytes: 2_000_000,
    retentionDays: 7,
  };
  app = await buildApp(config, db);
  runner = new JobRunner(db, app.store);
  for (const [suffix, setCookie] of [
    [
      "a",
      (c: string) => {
        cookieA = c;
      },
    ],
    [
      "b",
      (c: string) => {
        cookieB = c;
      },
    ],
  ] as const) {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: `${suffix}@example.test`,
        password: "a-good-test-password",
        name: `Creator ${suffix}`,
        workspace: `Studio ${suffix}`,
      },
    });
    expect(res.statusCode).toBe(201);
    setCookie(String(res.headers["set-cookie"]).split(";")[0]);
  }
});
afterAll(async () => {
  await app?.close();
  await db.close();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.close();
  if (root) await rm(root, { recursive: true, force: true });
});

describe("authenticated authorized clipping", () => {
  it("requires a session and rejects cross-site mutations", async () => {
    expect((await app.inject({ url: "/api/sources" })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: { cookie: cookieA, origin: "https://evil.test" },
        })
      ).statusCode,
    ).toBe(403);
  });
  it("rejects missing authorization without retaining an asset", async () => {
    const body = multipart({ ...metadata, attestation: false }, video);
    const res = await app.inject({
      method: "POST",
      url: "/api/sources",
      ...body,
      headers: { ...body.headers, cookie: cookieA },
    });
    expect(res.statusCode).toBe(400);
    expect((await db.query("SELECT count(*)::int AS n FROM source_assets"))[0].n).toBe(0);
  });
  it("validates actual media rather than extension", async () => {
    const body = multipart(metadata, Buffer.from("fake media"));
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/sources",
          ...body,
          headers: { ...body.headers, cookie: cookieA },
        })
      ).statusCode,
    ).toBe(400);
  });
  it("uploads with file before metadata, persists provenance, and processes once", async () => {
    const body = multipart(metadata, video, true);
    const res = await app.inject({
      method: "POST",
      url: "/api/sources",
      ...body,
      headers: { ...body.headers, cookie: cookieA },
    });
    expect(res.statusCode).toBe(201);
    sourceId = res.json().id;
    const source = (await db.query("SELECT * FROM source_assets WHERE id=$1", [sourceId]))[0];
    expect(source.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(source.authorization_basis).toContain("original");
    expect(source.rights.gameRights).toBe("unknown");
    expect(await runner.processOne()).toBe(true);
    expect(await runner.processOne()).toBe(false);
    const candidates = (await app.inject({ url: "/api/candidates", headers: { cookie: cookieA } })).json();
    expect(candidates.length).toBeGreaterThan(0);
    candidateId = candidates[0].id;
    expect(candidates[0].component_scores).toHaveProperty("audio");
    expect(candidates[0].status).toBe("needs_review");
  });
  it("isolates preview ranges, candidate edits, jobs and source access", async () => {
    for (const route of [
      `/api/sources/${sourceId}`,
      `/api/sources/${sourceId}/media`,
      `/api/candidates/${candidateId}`,
      `/api/candidates/${candidateId}/thumbnail`,
      `/api/candidates/${candidateId}/download`,
    ]) {
      expect(
        (await app.inject({ url: route, headers: { cookie: cookieB, range: "bytes=0-100" } })).statusCode,
      ).toBe(404);
    }
    expect((await app.inject({ url: "/api/jobs", headers: { cookie: cookieB } })).json()).toHaveLength(0);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/candidates/${candidateId}`,
          headers: { cookie: cookieB },
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
  });
  it("blocks approval of unknown rights and binds reviewed approval to exact edits", async () => {
    const unknown = await review();
    expect(unknown.statusCode).toBe(409);
    const rights = {
      sourceAuthorized: true,
      voiceAuthorized: true,
      gameRights: "authorized",
      musicDetected: "unknown",
      musicRights: "licensed",
      spoilerRisk: "low",
      embargoed: false,
      thirdParty: false,
      evidence: "Synthetic test media created by us",
    };
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/sources/${sourceId}/rights`,
          headers: { cookie: cookieA },
          payload: { ...rights, expectedRevision: 1 },
        })
      ).statusCode,
    ).toBe(200);
    expect((await review()).statusCode).toBe(200);
    const existing = (
      await app.inject({ url: `/api/candidates/${candidateId}`, headers: { cookie: cookieA } })
    ).json();
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/candidates/${candidateId}`,
          headers: { cookie: cookieA },
          payload: {
            title: existing.title,
            editPlan: { ...existing.edit_plan, endMs: 2000 },
            expectedRevision: existing.edit_revision,
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/candidates/${candidateId}/render`,
          headers: { cookie: cookieA },
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
  });
  it("rejects stale edits and approval of an unseen edit or rights revision", async () => {
    const c = (
      await app.inject({ url: `/api/candidates/${candidateId}`, headers: { cookie: cookieA } })
    ).json();
    const payload = {
      title: c.title,
      editPlan: { ...c.edit_plan, endMs: 1800 },
      expectedRevision: c.edit_revision,
    };
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/candidates/${candidateId}`,
          headers: { cookie: cookieA },
          payload,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/candidates/${candidateId}`,
          headers: { cookie: cookieA },
          payload,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/candidates/${candidateId}/review`,
          headers: { cookie: cookieA },
          payload: {
            decision: "approved",
            reason: "I saw the old edit",
            expectedRevision: c.edit_revision,
            expectedRightsRevision: c.rights_revision,
          },
        })
      ).statusCode,
    ).toBe(409);
    const rightsPayload = { ...c.rights, expectedRevision: c.rights_revision };
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/sources/${sourceId}/rights`,
          headers: { cookie: cookieA },
          payload: rightsPayload,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/sources/${sourceId}/rights`,
          headers: { cookie: cookieA },
          payload: rightsPayload,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/candidates/${candidateId}/review`,
          headers: { cookie: cookieA },
          payload: {
            decision: "approved",
            reason: "Old rights approval",
            expectedRevision: c.edit_revision + 1,
            expectedRightsRevision: c.rights_revision,
          },
        })
      ).statusCode,
    ).toBe(409);
  });
  it("resumes a cancelled render after a fresh approval", async () => {
    await review();
    const queued = await app.inject({
      method: "POST",
      url: `/api/candidates/${candidateId}/render`,
      headers: { cookie: cookieA },
      payload: {},
    });
    await review("rejected", "Changed my mind before export");
    await review();
    const requeued = await app.inject({
      method: "POST",
      url: `/api/candidates/${candidateId}/render`,
      headers: { cookie: cookieA },
      payload: {},
    });
    expect(requeued.json().id).toBe(queued.json().id);
    expect(requeued.json().status).toBe("pending");
  });
  it("renders an approved revision idempotently and downloads authenticated bytes", async () => {
    await review();
    const a = await app.inject({
      method: "POST",
      url: `/api/candidates/${candidateId}/render`,
      headers: { cookie: cookieA },
      payload: {},
    });
    const b = await app.inject({
      method: "POST",
      url: `/api/candidates/${candidateId}/render`,
      headers: { cookie: cookieA },
      payload: {},
    });
    expect(a.statusCode).toBe(202);
    expect(a.json().id).toBe(b.json().id);
    await runner.processOne();
    const download = await app.inject({
      url: `/api/candidates/${candidateId}/download`,
      headers: { cookie: cookieA, range: "bytes=0-99" },
    });
    expect(download.statusCode).toBe(206);
    expect(download.rawPayload.length).toBe(100);
    expect(download.headers["content-range"]).toMatch(/^bytes 0-99\//);
  });
  it("preserves a finished export on repeated approval", async () => {
    expect((await review()).statusCode).toBe(200);
    await app.inject({
      method: "POST",
      url: `/api/candidates/${candidateId}/render`,
      headers: { cookie: cookieA },
      payload: {},
    });
    expect(
      (await app.inject({ url: `/api/candidates/${candidateId}/download`, headers: { cookie: cookieA } }))
        .statusCode,
    ).toBe(200);
  });
  it("surfaces exhausted worker leases as a failed source, then allows manual retry", async () => {
    const body = multipart(metadata, video);
    const uploaded = (
      await app.inject({
        method: "POST",
        url: "/api/sources",
        ...body,
        headers: { ...body.headers, cookie: cookieA },
      })
    ).json();
    await db.query("UPDATE source_assets SET status='processing' WHERE id=$1", [uploaded.id]);
    const job = (
      await db.query(
        "UPDATE processing_jobs SET status='running',attempts=3,lease_until=now()-interval '1 minute' WHERE source_id=$1 RETURNING id",
        [uploaded.id],
      )
    )[0];
    await runner.processOne();
    expect((await db.query("SELECT status FROM source_assets WHERE id=$1", [uploaded.id]))[0].status).toBe(
      "failed",
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/jobs/${job.id}/retry`,
          headers: { cookie: cookieA },
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect((await db.query("SELECT status FROM source_assets WHERE id=$1", [uploaded.id]))[0].status).toBe(
      "queued",
    );
    await app.inject({ method: "DELETE", url: `/api/sources/${uploaded.id}`, headers: { cookie: cookieA } });
  });
  it("retries raw cleanup after a transient storage failure", async () => {
    const body = multipart(metadata, video);
    const uploaded = (
      await app.inject({
        method: "POST",
        url: "/api/sources",
        ...body,
        headers: { ...body.headers, cookie: cookieA },
      })
    ).json();
    await db.query("UPDATE source_assets SET retention_deadline=now()-interval '1 day' WHERE id=$1", [
      uploaded.id,
    ]);
    const remove = app.store.remove.bind(app.store);
    let failed = false;
    app.store.remove = async (key: string) => {
      if (!failed) {
        failed = true;
        throw new Error("Temporary disk failure");
      }
      return remove(key);
    };
    await expireSources(db, app.store);
    app.store.remove = remove;
    await expireSources(db, app.store);
    const s = (await db.query("SELECT * FROM source_assets WHERE id=$1", [uploaded.id]))[0];
    await expect(app.store.info(s.storage_key)).rejects.toThrow();
  });
  it("deletes all source objects and records the deletion", async () => {
    const remove = app.store.remove.bind(app.store);
    app.store.remove = async () => {
      throw new Error("Temporary disk failure");
    };
    expect(
      (await app.inject({ method: "DELETE", url: `/api/sources/${sourceId}`, headers: { cookie: cookieA } }))
        .statusCode,
    ).toBe(500);
    app.store.remove = remove;
    expect(
      (await app.inject({ method: "DELETE", url: `/api/sources/${sourceId}`, headers: { cookie: cookieA } }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: `/api/sources/${sourceId}/media`, headers: { cookie: cookieA } })).statusCode,
    ).toBe(404);
    expect((await db.query("SELECT status FROM source_assets WHERE id=$1", [sourceId]))[0].status).toBe(
      "deleted",
    );
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM audit_events WHERE kind='source.deleted' AND entity_id=$1",
          [sourceId],
        )
      )[0].n,
    ).toBe(1);
  });
});
