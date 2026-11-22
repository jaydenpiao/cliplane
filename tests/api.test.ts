import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Config } from "../apps/api/src/config";
import { expireSources, JobRunner } from "../apps/api/src/jobs";
import { type MediaExecutor, type MediaRequest, media } from "../apps/api/src/media";
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
  app = await buildApp(config, db, media);
  runner = new JobRunner(db, app.store, { executeMedia: media });
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
  it("reserves the sample identity during registration", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "DEMO@cliplane.local",
        password: "a-good-test-password",
        name: "Private creator",
        workspace: "Private studio",
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers["set-cookie"]).toBeUndefined();
  });
  it("demo access requires an explicit seed marker for the exact user and workspace", async () => {
    const demoUser = randomUUID(),
      demoWorkspace = randomUUID();
    await db.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,'demo@cliplane.local','Unmarked creator','unused')",
      [demoUser],
    );
    await db.query("INSERT INTO workspaces(id,name) VALUES($1,'Unmarked workspace')", [demoWorkspace]);
    await db.query("INSERT INTO memberships(user_id,workspace_id) VALUES($1,$2)", [demoUser, demoWorkspace]);
    app.config.demoEnabled = true;
    try {
      const denied = await app.inject({ method: "POST", url: "/api/auth/demo" });
      expect(denied.statusCode).toBe(503);
      expect(denied.headers["set-cookie"]).toBeUndefined();
      await db.query(
        "INSERT INTO audit_events(id,workspace_id,user_id,kind,entity_id) VALUES($1,$2,$3,'demo.seeded',$3)",
        [randomUUID(), demoWorkspace, demoUser],
      );
      const allowed = await app.inject({ method: "POST", url: "/api/auth/demo" });
      expect(allowed.statusCode).toBe(200);
      const cookie = String(allowed.headers["set-cookie"]).split(";")[0];
      const identity = (await app.inject({ url: "/api/me", headers: { cookie } })).json();
      expect(identity.userId).toBe(demoUser);
      expect(identity.workspaceId).toBe(demoWorkspace);
      await db.query("DELETE FROM audit_events WHERE kind='demo.seeded' AND user_id=$1", [demoUser]);
      expect((await app.inject({ method: "POST", url: "/api/auth/demo" })).statusCode).toBe(503);
    } finally {
      app.config.demoEnabled = false;
    }
  });

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
  it("rejects unsupported media with the upload validation message", async () => {
    const body = multipart(metadata, Buffer.from("fake media"));
    const response = await app.inject({
      method: "POST",
      url: "/api/sources",
      ...body,
      headers: { ...body.headers, cookie: cookieA },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "This file is not a supported playable video recording" });
  });
  it.each(["rejects valid media", "returns malformed metadata"] as const)(
    "fails closed when the upload probe executor %s",
    async (outcome) => {
      const dataDir = await mkdtemp(path.join(root, "failed-probe-store-"));
      const probes: { source: string; bytes: Buffer; permissions: number }[] = [];
      const executeMedia: MediaExecutor = async <T>(request: MediaRequest): Promise<T> => {
        if (request.operation !== "probe") throw new Error("Expected an upload probe");
        probes.push({
          source: request.source,
          bytes: await readFile(request.source),
          permissions: (await stat(request.source)).mode & 0o777,
        });
        if (outcome === "rejects valid media") throw new Error("private decoder diagnostic");
        return {
          durationMs: 3000,
          width: -1,
          height: 180,
          hasAudio: false,
          fps: 24,
          codec: "private malformed worker payload",
          audioTracks: [],
        } as T;
      };
      const failingApp = await buildApp({ ...app.config, dataDir }, db, executeMedia);
      try {
        const { workspaceId } = (
          await failingApp.inject({ url: "/api/me", headers: { cookie: cookieB } })
        ).json<{ workspaceId: string }>();
        const body = multipart(metadata, video);
        const response = await failingApp.inject({
          method: "POST",
          url: "/api/sources",
          ...body,
          headers: { ...body.headers, cookie: cookieB },
        });
        expect(response.statusCode).toBe(503);
        expect(response.json()).toEqual({ error: "The request could not be completed. Please retry." });

        expect(probes).toHaveLength(1);
        const [probe] = probes;
        expect(path.relative(dataDir, probe.source).split(path.sep)).toEqual([
          workspaceId,
          expect.stringMatching(/^[a-f0-9-]{36}$/),
          "original",
          "master.bin",
        ]);
        expect(probe.bytes).toEqual(video);
        expect(probe.permissions).toBe(0o600);
        await expect(stat(probe.source)).rejects.toMatchObject({ code: "ENOENT" });
        expect(
          await db.query(
            `SELECT
              (SELECT count(*)::int FROM source_assets WHERE workspace_id=$1) AS sources,
              (SELECT count(*)::int FROM rights_attestations WHERE workspace_id=$1) AS attestations,
              (SELECT count(*)::int FROM processing_jobs WHERE workspace_id=$1) AS jobs,
              (SELECT count(*)::int FROM audit_events WHERE workspace_id=$1 AND kind='source.uploaded') AS uploads`,
            [workspaceId],
          ),
        ).toEqual([{ sources: 0, attestations: 0, jobs: 0, uploads: 0 }]);
      } finally {
        await failingApp.close();
      }
    },
  );
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
