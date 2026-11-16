import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JobRunner } from "../apps/api/src/jobs";
import type { media } from "../apps/api/src/media";
import { LocalObjectStore } from "../apps/api/src/storage";
import { Database } from "../packages/db/src/index";
import { defaultEditPlan } from "../packages/domain/src/index";

const schema = `test_jobs_${randomUUID().replaceAll("-", "")}`;
const url = process.env.TEST_DATABASE_URL || "postgres://cliplane:cliplane_local@127.0.0.1:54329/cliplane";
const admin = new Database(url);
const db = new Database(url, schema);
let root: string;
let store: LocalObjectStore;
type Kind = "analyze" | "render";
type Fixture = {
  kind: Kind;
  workspace: string;
  source: string;
  candidate: string;
  job: string;
  marker: string;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

async function within<T>(promise: Promise<T>, label: string, milliseconds = 1500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function eventually(check: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = performance.now() + 1500;
  while (!(await check())) {
    if (performance.now() >= deadline) throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

class ControlledMedia {
  readonly started = deferred<{ signal: AbortSignal; artifacts: string[] }>();
  readonly aborted = deferred<void>();
  readonly released = deferred<void>();
  calls = 0;
  constructor(private cooperative = true) {}

  readonly executeMedia: typeof media = async <T = any>(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> => {
    this.calls += 1;
    if (!signal) throw new Error("JobRunner must pass its ownership AbortSignal");
    const artifacts =
      input.operation === "analyze"
        ? [
            path.join(String(input.outputDir), "thumbnail.jpg"),
            path.join(String(input.outputDir), "analysis.partial"),
          ]
        : [String(input.output), String(input.output).replace(/\.mp4$/, ".partial.mp4")];
    for (const filename of artifacts) {
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, "unpublished synthetic media");
    }
    const onAbort = () => this.aborted.resolve();
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    this.started.resolve({ signal, artifacts });
    try {
      if (this.cooperative) {
        await Promise.race([
          this.released.promise,
          this.aborted.promise.then(() => {
            throw new Error("Media execution aborted");
          }),
        ]);
      } else {
        await this.released.promise;
      }
      return (
        input.operation === "analyze"
          ? {
              candidates: [
                {
                  startMs: 0,
                  endMs: 1000,
                  score: 80,
                  components: { audio: 80, scene: 40 },
                  reason: "Synthetic fixture",
                  thumbnail: "thumbnail.jpg",
                },
              ],
              signals: { synthetic: true },
              telemetry: { wallSeconds: 0.1 },
            }
          : { duration: 1, synthetic: true }
      ) as T;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  };
}

async function fixture(kind: Kind): Promise<Fixture> {
  const workspace = randomUUID(),
    source = randomUUID(),
    candidate = randomUUID(),
    job = randomUUID();
  const creator = randomUUID();
  await db.query("INSERT INTO workspaces(id,name) VALUES($1,'Cancellation tests')", [workspace]);
  await db.query("INSERT INTO creator_identities(id,workspace_id,name) VALUES($1,$2,'Synthetic creator')", [
    creator,
    workspace,
  ]);
  const key = `${workspace}/${source}/master.mp4`;
  await writeFile(await store.prepare(key), "synthetic fixture; the injected executor does not decode");
  await db.query(
    `INSERT INTO source_assets(id,workspace_id,creator_id,title,game,source_platform,capture_time,authorization_basis,attestation_version,storage_key,checksum,byte_size,metadata,rights,retention_deadline,status)
     VALUES($1,$2,$3,'Synthetic source','Synthetic','local',now(),'Original synthetic fixture','test',$4,'synthetic',1,'{}','{}',now()+interval '1 day',$5)`,
    [source, workspace, creator, key, kind === "analyze" ? "queued" : "ready"],
  );
  if (kind === "render") {
    await db.query(
      `INSERT INTO candidate_moments(id,workspace_id,source_id,title,start_ms,end_ms,score,component_scores,reason,thumbnail_key,edit_plan,status,approved_revision,approved_rights_revision)
       VALUES($1,$2,$3,'Synthetic moment',0,1000,80,'{}','Synthetic fixture',$4,$5,'rendering',1,1)`,
      [candidate, workspace, source, `${workspace}/${source}/thumbnail.jpg`, defaultEditPlan(0, 1000)],
    );
  }
  await db.query(
    "INSERT INTO processing_jobs(id,workspace_id,source_id,candidate_id,kind,status,idempotency_key,payload) VALUES($1,$2,$3,$4,$5,'pending',$6,$7)",
    [
      job,
      workspace,
      source,
      kind === "render" ? candidate : null,
      kind,
      job,
      kind === "render" ? { revision: 1 } : {},
    ],
  );
  const marker = `${workspace}/${source}/${kind === "analyze" ? "analysis/other-owner/marker" : "renders/other-owner.mp4"}`;
  await writeFile(await store.prepare(marker), "another owner's published artifact");
  return { kind, workspace, source, candidate, job, marker };
}

function begin(control: ControlledMedia, lease = { intervalMs: 50, budgetMs: 2500 }) {
  const runner = new JobRunner(db, store, { executeMedia: control.executeMedia, lease });
  // Attach a rejection handler immediately, including while the test waits for media startup.
  const completed = runner.processOne().then(
    (value) => ({ value, error: undefined }),
    (error: unknown) => ({ value: undefined, error }),
  );
  return {
    runner,
    completed,
    async cleanup() {
      const stopped = Promise.resolve(runner.stop());
      control.released.resolve();
      await within(completed, "runner cleanup", 3000);
      await within(stopped, "runner stop", 3000);
    },
  };
}

async function expectNoPublication(f: Fixture, artifacts: string[]) {
  expect(
    (await db.query("SELECT count(*)::int n FROM rendered_clips WHERE candidate_id=$1", [f.candidate]))[0].n,
  ).toBe(0);
  expect(
    (await db.query("SELECT count(*)::int n FROM candidate_moments WHERE source_id=$1", [f.source]))[0].n,
  ).toBe(f.kind === "render" ? 1 : 0);
  expect(
    (
      await db.query(
        "SELECT count(*)::int n FROM audit_events WHERE workspace_id=$1 AND kind IN ('analysis.completed','render.completed')",
        [f.workspace],
      )
    )[0].n,
  ).toBe(0);
  const source = (await db.query("SELECT status,analysis FROM source_assets WHERE id=$1", [f.source]))[0];
  expect(source.analysis).toBeNull();
  expect(source.status).toBe(f.kind === "analyze" ? "processing" : "ready");
  if (f.kind === "render")
    expect(
      (await db.query("SELECT status FROM candidate_moments WHERE id=$1", [f.candidate]))[0].status,
    ).toBe("rendering");
  for (const artifact of artifacts)
    await expect(readFile(artifact)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(store.resolve(f.marker), "utf8")).toBe("another owner's published artifact");
}

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await db.migrate();
  root = await mkdtemp(path.join(os.tmpdir(), "cliplane-jobs-"));
  store = new LocalObjectStore(root);
});

beforeEach(async () => {
  await db.query("TRUNCATE workspaces CASCADE");
});

afterAll(async () => {
  await db.close();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.close();
  if (root) await rm(root, { recursive: true, force: true });
});

describe.each(["analyze", "render"] as const)("%s job ownership", (kind) => {
  it.each([true, false])(
    "preserves durable cancellation and cleans unpublished artifacts (cooperative media: %s)",
    async (cooperative) => {
      const f = await fixture(kind);
      const control = new ControlledMedia(cooperative);
      const running = begin(control);
      try {
        const { signal, artifacts } = await within(
          control.started.promise,
          "injected media executor startup",
        );
        await db.query(
          "UPDATE processing_jobs SET status='cancelled',error='Cancelled elsewhere',finished_at=now() WHERE id=$1",
          [f.job],
        );
        const cancelled = (await db.query("SELECT * FROM processing_jobs WHERE id=$1", [f.job]))[0];
        await within(control.aborted.promise, "database cancellation abort");
        expect(signal.aborted).toBe(true);
        control.released.resolve();
        expect((await within(running.completed, "cancelled work cleanup")).error).toBeUndefined();
        expect((await db.query("SELECT * FROM processing_jobs WHERE id=$1", [f.job]))[0]).toEqual(cancelled);
        await expectNoPublication(f, artifacts);
      } finally {
        await running.cleanup();
      }
    },
  );

  it.each([true, false])(
    "preserves the replacement owner's state (cooperative media: %s)",
    async (cooperative) => {
      const f = await fixture(kind);
      const control = new ControlledMedia(cooperative);
      const running = begin(control);
      try {
        const { artifacts } = await within(control.started.promise, "injected media executor startup");
        await db.query(
          "UPDATE processing_jobs SET lease_owner=$2,lease_until=now()+interval '2 minutes',error='Replacement owner owns this state',telemetry=$3 WHERE id=$1",
          [f.job, randomUUID(), { replacement: true }],
        );
        const replacement = (await db.query("SELECT * FROM processing_jobs WHERE id=$1", [f.job]))[0];
        await within(control.aborted.promise, "lease replacement abort");
        control.released.resolve();
        expect((await within(running.completed, "replaced work cleanup")).error).toBeUndefined();
        expect((await db.query("SELECT * FROM processing_jobs WHERE id=$1", [f.job]))[0]).toEqual(
          replacement,
        );
        await expectNoPublication(f, artifacts);
      } finally {
        await running.cleanup();
      }
    },
  );

  it("cannot renew an expired lease or rewrite it while handling the abort", async () => {
    const f = await fixture(kind);
    const control = new ControlledMedia();
    const running = begin(control);
    try {
      const { artifacts } = await within(control.started.promise, "injected media executor startup");
      await db.query("UPDATE processing_jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [f.job]);
      const expired = (await db.query("SELECT * FROM processing_jobs WHERE id=$1", [f.job]))[0];
      await within(control.aborted.promise, "expired lease abort");
      expect((await within(running.completed, "expired work cleanup")).error).toBeUndefined();
      expect((await db.query("SELECT * FROM processing_jobs WHERE id=$1", [f.job]))[0]).toEqual(expired);
      await expectNoPublication(f, artifacts);
    } finally {
      await running.cleanup();
    }
  });

  it("does not publish a media result returned after its database lease expired", async () => {
    const f = await fixture(kind);
    const control = new ControlledMedia(false);
    // Leave renewal dormant so this exercises the completion fence itself.
    const running = begin(control, { intervalMs: 2000, budgetMs: 2500 });
    try {
      const { artifacts } = await within(control.started.promise, "injected media executor startup");
      await db.query("UPDATE processing_jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [f.job]);
      const expired = (await db.query("SELECT * FROM processing_jobs WHERE id=$1", [f.job]))[0];
      control.released.resolve();
      expect((await within(running.completed, "late result cleanup")).error).toBeUndefined();
      expect((await db.query("SELECT * FROM processing_jobs WHERE id=$1", [f.job]))[0]).toEqual(expired);
      await expectNoPublication(f, artifacts);
    } finally {
      await running.cleanup();
    }
  });

  it("rolls back publication if ownership expires inside the completion transaction", async () => {
    const f = await fixture(kind);
    const control = new ControlledMedia(false);
    const running = begin(control, { intervalMs: 2000, budgetMs: 2500 });
    const table = kind === "analyze" ? "candidate_moments" : "rendered_clips";
    try {
      const { artifacts } = await within(control.started.promise, "injected media executor startup");
      // A database trigger forces lease loss after the completion SELECT has locked
      // ownership, but before its final UPDATE. No SQL or transaction is mocked.
      await db.query(
        `CREATE FUNCTION expire_completion_lease() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE processing_jobs SET lease_until=now()-interval '1 second' WHERE id=TG_ARGV[0]::uuid; RETURN NEW; END $$`,
      );
      await db.query(
        `CREATE TRIGGER expire_completion_lease BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION expire_completion_lease('${f.job}')`,
      );
      control.released.resolve();
      expect((await within(running.completed, "transactional completion fence")).error).toBeUndefined();
      expect((await db.query("SELECT status FROM processing_jobs WHERE id=$1", [f.job]))[0].status).not.toBe(
        "succeeded",
      );
      await expectNoPublication(f, artifacts);
    } finally {
      await running.cleanup();
      await db.query(`DROP TRIGGER IF EXISTS expire_completion_lease ON ${table}`);
      await db.query("DROP FUNCTION IF EXISTS expire_completion_lease()");
    }
  });

  it("removes unpublished artifacts when completion fails at COMMIT", async () => {
    const f = await fixture(kind);
    const control = new ControlledMedia();
    const running = begin(control, { intervalMs: 2000, budgetMs: 2500 });
    const table = kind === "analyze" ? "candidate_moments" : "rendered_clips";
    try {
      const { artifacts } = await within(control.started.promise, "injected media executor startup");
      // Deferred constraints run after the transaction callback has returned.
      // This verifies cleanup depends on COMMIT succeeding, not callback success.
      await db.query(
        `CREATE FUNCTION reject_publication_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test publication COMMIT failure'; RETURN NEW; END $$`,
      );
      await db.query(
        `CREATE CONSTRAINT TRIGGER reject_publication_commit AFTER INSERT ON ${table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_publication_commit()`,
      );
      control.released.resolve();
      expect((await within(running.completed, "failed COMMIT cleanup")).error).toBeUndefined();
      expect((await db.query("SELECT status,attempts FROM processing_jobs WHERE id=$1", [f.job]))[0]).toEqual(
        { status: "pending", attempts: 1 },
      );
      await expectNoPublication(f, artifacts);
    } finally {
      await running.cleanup();
      await db.query(`DROP TRIGGER IF EXISTS reject_publication_commit ON ${table}`);
      await db.query("DROP FUNCTION IF EXISTS reject_publication_commit()");
    }
  });

  it("rolls back shutdown while completion waits to insert its audit event", async () => {
    const f = await fixture(kind);
    const control = new ControlledMedia();
    const running = begin(control, { intervalMs: 2000, budgetMs: 2500 });
    const blocker = await db.pool.connect();
    let locked = false;
    try {
      const { signal, artifacts } = await within(control.started.promise, "injected media executor startup");
      await blocker.query("BEGIN");
      await blocker.query("LOCK TABLE audit_events IN ACCESS EXCLUSIVE MODE");
      locked = true;
      control.released.resolve();
      await eventually(
        async () =>
          (
            await db.query(
              "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE relation='audit_events'::regclass AND NOT granted) blocked",
            )
          )[0].blocked,
        "completion waiting to insert its audit event",
      );
      const stopped = running.runner.stop().then(
        () => ({ error: undefined }),
        (error: unknown) => ({ error }),
      );
      expect(signal.aborted).toBe(true);
      await blocker.query("ROLLBACK");
      locked = false;
      expect((await within(stopped, "shutdown during completion drain")).error).toBeUndefined();
      expect((await within(running.completed, "aborted completion cleanup")).error).toBeUndefined();
      expect((await db.query("SELECT status,attempts FROM processing_jobs WHERE id=$1", [f.job]))[0]).toEqual(
        { status: "pending", attempts: 1 },
      );
      await expectNoPublication(f, artifacts);
    } finally {
      const stopped = running.runner.stop().catch(() => {});
      if (locked) await blocker.query("ROLLBACK");
      blocker.release();
      control.released.resolve();
      await within(stopped, "blocked completion final drain", 3000);
      await running.cleanup();
    }
  });

  it("does not rewrite an expired lease after a retry lock wait", async () => {
    const f = await fixture(kind);
    const control = new ControlledMedia();
    const running = begin(control, { intervalMs: 2000, budgetMs: 2500 });
    const blocker = await db.pool.connect();
    let locked = false;
    try {
      const { artifacts } = await within(control.started.promise, "injected media executor startup");
      const expiring = (
        await db.query(
          "UPDATE processing_jobs SET lease_until=clock_timestamp()+interval '300 milliseconds' WHERE id=$1 RETURNING *",
          [f.job],
        )
      )[0];
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM processing_jobs WHERE id=$1 FOR UPDATE", [f.job]);
      locked = true;
      const blockerPid = (await blocker.query("SELECT pg_backend_pid() pid")).rows[0].pid;
      const stopped = running.runner.stop().then(
        () => ({ error: undefined }),
        (error: unknown) => ({ error }),
      );
      await within(control.aborted.promise, "shutdown before retry abort");
      await eventually(
        async () =>
          (
            await db.query(
              "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))) blocked",
              [blockerPid],
            )
          )[0].blocked,
        "retry waiting on the job row lock",
      );
      await eventually(
        async () =>
          (
            await db.query("SELECT lease_until<=clock_timestamp() expired FROM processing_jobs WHERE id=$1", [
              f.job,
            ])
          )[0].expired,
        "database lease expiration during retry lock wait",
      );
      await blocker.query("ROLLBACK");
      locked = false;
      expect((await within(stopped, "expired retry drain")).error).toBeUndefined();
      expect((await within(running.completed, "expired retry cleanup")).error).toBeUndefined();
      expect((await db.query("SELECT * FROM processing_jobs WHERE id=$1", [f.job]))[0]).toEqual(expiring);
      await expectNoPublication(f, artifacts);
    } finally {
      const stopped = running.runner.stop().catch(() => {});
      if (locked) await blocker.query("ROLLBACK");
      blocker.release();
      control.released.resolve();
      await within(stopped, "blocked retry final drain", 3000);
      await running.cleanup();
    }
  });
});

it("does not enter a pre-aborted database transaction or insert its workspace", async () => {
  const controller = new AbortController();
  controller.abort();
  const workspace = randomUUID();
  let entered = false;
  const result = await db
    .transaction(async (client) => {
      entered = true;
      await client.query("INSERT INTO workspaces(id,name) VALUES($1,'Must not be inserted')", [workspace]);
    }, controller.signal)
    .then(
      () => ({ error: undefined }),
      (error: unknown) => ({ error }),
    );
  expect(entered).toBe(false);
  expect(result.error).toBeInstanceOf(Error);
  expect((await db.query("SELECT count(*)::int n FROM workspaces WHERE id=$1", [workspace]))[0].n).toBe(0);
});

it("keeps the database outcome when cancellation arrives after COMMIT dispatch", async () => {
  const controller = new AbortController();
  const workspace = randomUUID();
  const blocker = await db.pool.connect();
  let locked = false;
  let completed: Promise<{ value?: string; error?: unknown }> | undefined;
  try {
    await blocker.query("BEGIN");
    locked = true;
    await blocker.query("SELECT pg_advisory_xact_lock(hashtext($1))", [workspace]);
    const blockerPid = (await blocker.query("SELECT pg_backend_pid() pid")).rows[0].pid;
    await db.query(
      "CREATE FUNCTION wait_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(hashtext(TG_ARGV[0])); RETURN NEW; END $$",
    );
    await db.query(
      `CREATE CONSTRAINT TRIGGER wait_commit AFTER INSERT ON workspaces DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wait_commit('${workspace}')`,
    );
    completed = db
      .transaction(async (client) => {
        await client.query("INSERT INTO workspaces(id,name) VALUES($1,'Committed fixture')", [workspace]);
        return "committed";
      }, controller.signal)
      .then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
    await eventually(
      async () =>
        (
          await db.query(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE query='COMMIT' AND $1::int=ANY(pg_blocking_pids(pid))) blocked",
            [blockerPid],
          )
        )[0].blocked,
      "COMMIT dispatched and waiting on its deferred trigger",
    );
    controller.abort();
    await blocker.query("ROLLBACK");
    locked = false;
    expect(await within(completed, "dispatched commit result")).toEqual({ value: "committed" });
    expect((await db.query("SELECT count(*)::int n FROM workspaces WHERE id=$1", [workspace]))[0].n).toBe(1);
  } finally {
    if (locked) await blocker.query("ROLLBACK");
    blocker.release();
    if (completed) await within(completed, "commit boundary cleanup", 3000);
    await db.query("DROP TRIGGER IF EXISTS wait_commit ON workspaces");
    await db.query("DROP FUNCTION IF EXISTS wait_commit()");
  }
});

it("aborts media when a real database renewal fails", async () => {
  const f = await fixture("analyze");
  await db.query(
    `CREATE FUNCTION reject_lease_renewal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.status='running' AND NEW.status='running' AND NEW.lease_until>OLD.lease_until THEN RAISE EXCEPTION 'test renewal failure'; END IF; RETURN NEW; END $$`,
  );
  await db.query(
    "CREATE TRIGGER reject_lease_renewal BEFORE UPDATE ON processing_jobs FOR EACH ROW EXECUTE FUNCTION reject_lease_renewal()",
  );
  const control = new ControlledMedia();
  const running = begin(control);
  try {
    const { artifacts } = await within(control.started.promise, "injected media executor startup");
    await within(control.aborted.promise, "renewal-error abort");
    expect((await within(running.completed, "renewal-error cleanup")).error).toBeUndefined();
    const job = (await db.query("SELECT status,attempts FROM processing_jobs WHERE id=$1", [f.job]))[0];
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(1);
    await expectNoPublication(f, artifacts);
  } finally {
    await running.cleanup();
    await db.query("DROP TRIGGER reject_lease_renewal ON processing_jobs");
    await db.query("DROP FUNCTION reject_lease_renewal()");
  }
});

it("shutdown aborts active media, drains cleanup and refuses further claims", async () => {
  const f = await fixture("render");
  const control = new ControlledMedia();
  const running = begin(control);
  try {
    const { signal, artifacts } = await within(control.started.promise, "injected media executor startup");
    const pending = await fixture("analyze");
    const stopped = Promise.resolve(running.runner.stop());
    await within(control.aborted.promise, "shutdown abort");
    await within(stopped, "shutdown drain");
    expect(signal.aborted).toBe(true);
    expect((await within(running.completed, "shutdown cleanup")).error).toBeUndefined();
    await expectNoPublication(f, artifacts);
    expect(await running.runner.processOne()).toBe(false);
    expect(control.calls).toBe(1);
    expect(
      (await db.query("SELECT status,attempts FROM processing_jobs WHERE id=$1", [pending.job]))[0],
    ).toEqual({ status: "pending", attempts: 0 });
  } finally {
    await running.cleanup();
  }
});

it("shutdown during the initial database transaction drains without claiming or starting media", async () => {
  const f = await fixture("analyze");
  const blocker = await db.pool.connect();
  await blocker.query("BEGIN");
  await blocker.query("LOCK TABLE processing_jobs IN ACCESS EXCLUSIVE MODE");
  let locked = true;
  const control = new ControlledMedia();
  const running = begin(control);
  try {
    await eventually(
      async () =>
        (
          await db.query(
            "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE relation='processing_jobs'::regclass AND NOT granted) blocked",
          )
        )[0].blocked,
      "runner waiting for PostgreSQL lock",
    );
    let drained = false;
    const stopped = Promise.resolve(running.runner.stop()).then(() => {
      drained = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(drained).toBe(false);
    await blocker.query("ROLLBACK");
    locked = false;
    await within(stopped, "shutdown after database lock release");
    expect((await within(running.completed, "stopped database work")).value).toBe(false);
    expect(control.calls).toBe(0);
    expect((await db.query("SELECT status,attempts FROM processing_jobs WHERE id=$1", [f.job]))[0]).toEqual({
      status: "pending",
      attempts: 0,
    });
    expect(await running.runner.processOne()).toBe(false);
  } finally {
    const stopped = Promise.resolve(running.runner.stop());
    if (locked) await blocker.query("ROLLBACK");
    blocker.release();
    control.released.resolve();
    await within(running.completed, "locked runner cleanup", 3000);
    await within(stopped, "locked runner stop", 3000);
  }
});
