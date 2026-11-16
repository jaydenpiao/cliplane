import { randomUUID } from "node:crypto";
import type { Database } from "../../../packages/db/src/index";
import { defaultEditPlan } from "../../../packages/domain/src/index";
import { checksum, media } from "./media";
import type { LocalObjectStore } from "./storage";

export async function audit(
  db: Database,
  workspace: string,
  user: string | null,
  kind: string,
  entity: string | null,
  data: object = {},
): Promise<void> {
  await db.query(
    "INSERT INTO audit_events(id,workspace_id,user_id,kind,entity_id,data) VALUES($1,$2,$3,$4,$5,$6)",
    [randomUUID(), workspace, user, kind, entity, data],
  );
}

export class JobRunner {
  private active = false;
  private timer?: ReturnType<typeof setTimeout>;
  private stopping = false;
  constructor(
    private db: Database,
    private store: LocalObjectStore,
  ) {}
  start(): void {
    const tick = async () => {
      if (this.stopping) return;
      try {
        await this.processOne();
      } catch {
        /* Failures persist on the job; no media or secrets in logs. */
      } finally {
        if (!this.stopping) this.timer = setTimeout(tick, 1000);
      }
    };
    void tick();
  }
  stop(): void {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
  }

  async processOne(): Promise<boolean> {
    if (this.active) return false;
    this.active = true;
    const owner = randomUUID();
    let job: any;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      await this.db.transaction(async (client) => {
        const exhausted = (
          await client.query(
            "UPDATE processing_jobs SET status='failed',error='Job lease exhausted; manual retry required',finished_at=now() WHERE status='running' AND lease_until<now() AND attempts>=3 RETURNING source_id,workspace_id,candidate_id,kind",
          )
        ).rows;
        for (const j of exhausted) {
          if (j.kind === "analyze")
            await client.query(
              "UPDATE source_assets SET status='failed',error='Worker lease exhausted; retry from Activity' WHERE id=$1 AND workspace_id=$2 AND status='processing'",
              [j.source_id, j.workspace_id],
            );
          else
            await client.query(
              "UPDATE candidate_moments SET status='approved' WHERE id=$1 AND workspace_id=$2 AND status='rendering'",
              [j.candidate_id, j.workspace_id],
            );
        }
      });
      const rows = await this.db.query(
        `UPDATE processing_jobs SET status='running',attempts=attempts+1,lease_owner=$1,lease_until=now()+interval '2 minutes'
        WHERE id=(SELECT j.id FROM processing_jobs j JOIN source_assets s ON s.id=j.source_id AND s.workspace_id=j.workspace_id
          WHERE ((j.status='pending' AND j.available_at<=now()) OR (j.status='running' AND j.lease_until<now()))
          AND j.attempts<3 AND s.status NOT IN ('expired','deleting','deleted') ORDER BY j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1) RETURNING *`,
        [owner],
      );
      job = rows[0];
      if (!job) return false;
      heartbeat = setInterval(() => {
        void this.db
          .query(
            "UPDATE processing_jobs SET lease_until=now()+interval '2 minutes' WHERE id=$1 AND lease_owner=$2 AND status='running'",
            [job.id, owner],
          )
          .catch(() => {});
      }, 20000);
      const source = (
        await this.db.query("SELECT * FROM source_assets WHERE id=$1 AND workspace_id=$2", [
          job.source_id,
          job.workspace_id,
        ])
      )[0];
      if (job.kind === "analyze") await this.analyze(job, source, owner);
      else await this.render(job, source, owner);
      return true;
    } catch {
      if (job) {
        const final = job.attempts >= 3;
        await this.db.transaction(async (client) => {
          const updated = await client.query(
            "UPDATE processing_jobs SET status=$3,error=$4,available_at=now()+interval '10 seconds',finished_at=CASE WHEN $3='failed' THEN now() ELSE NULL END WHERE id=$1 AND lease_owner=$2 AND status='running' RETURNING id",
            [
              job.id,
              owner,
              final ? "failed" : "pending",
              "Media processing failed. Check encoding or retry the job.",
            ],
          );
          if (updated.rowCount && final && job.kind === "analyze")
            await client.query(
              "UPDATE source_assets SET status='failed',error='Media processing failed' WHERE id=$1 AND workspace_id=$2 AND status NOT IN ('deleted','deleting','expired')",
              [job.source_id, job.workspace_id],
            );
          if (updated.rowCount && final && job.kind === "render")
            await client.query(
              "UPDATE candidate_moments SET status='approved' WHERE id=$1 AND workspace_id=$2 AND status='rendering'",
              [job.candidate_id, job.workspace_id],
            );
        });
      }
      return !!job;
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      this.active = false;
    }
  }

  private async analyze(job: any, source: any, owner: string): Promise<void> {
    await this.db.query(
      "UPDATE source_assets SET status='processing' WHERE id=$1 AND workspace_id=$2 AND status='queued'",
      [source.id, source.workspace_id],
    );
    const prefix = `${source.workspace_id}/${source.id}/analysis/${job.id}-${owner}`;
    let valid = false;
    try {
      const result = await media({
        operation: "analyze",
        source: this.store.resolve(source.storage_key),
        outputDir: this.store.resolve(prefix),
      });
      await this.db.transaction(async (client) => {
        const current = (
          await client.query(
            "SELECT s.status,j.status AS job_status,j.lease_owner FROM source_assets s JOIN processing_jobs j ON j.source_id=s.id AND j.workspace_id=s.workspace_id WHERE s.id=$1 AND s.workspace_id=$2 AND j.id=$3 FOR UPDATE OF s,j",
            [source.id, source.workspace_id, job.id],
          )
        ).rows[0];
        if (
          !current ||
          ["expired", "deleting", "deleted"].includes(current.status) ||
          current.job_status !== "running" ||
          current.lease_owner !== owner
        )
          return;
        for (let index = 0; index < result.candidates.length; index++) {
          const c = result.candidates[index];
          await client.query(
            `INSERT INTO candidate_moments(id,workspace_id,source_id,title,start_ms,end_ms,score,component_scores,reason,thumbnail_key,edit_plan)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(source_id,start_ms,end_ms) DO NOTHING`,
            [
              randomUUID(),
              source.workspace_id,
              source.id,
              c.components.audio > 60
                ? "A reaction worth a second look"
                : c.components.scene > 30
                  ? "A change of pace"
                  : `Moment ${index + 1} · ${source.title}`,
              c.startMs,
              c.endMs,
              c.score,
              c.components,
              c.reason,
              `${prefix}/${c.thumbnail}`,
              defaultEditPlan(c.startMs, c.endMs),
            ],
          );
        }
        await client.query(
          "UPDATE source_assets SET status='ready',error=NULL,analysis=$3 WHERE id=$1 AND workspace_id=$2",
          [
            source.id,
            source.workspace_id,
            { artifactPrefix: prefix, signals: result.signals, telemetry: result.telemetry },
          ],
        );
        await client.query(
          "UPDATE processing_jobs SET status='succeeded',finished_at=now(),telemetry=$3,error=NULL WHERE id=$1 AND lease_owner=$2",
          [job.id, owner, result.telemetry],
        );
        await client.query(
          "INSERT INTO audit_events(id,workspace_id,kind,entity_id,data) VALUES($1,$2,'analysis.completed',$3,$4)",
          [
            randomUUID(),
            source.workspace_id,
            source.id,
            { candidates: result.candidates.length, jobId: job.id },
          ],
        );
        valid = true;
      });
    } finally {
      if (!valid) await this.store.remove(prefix);
    }
  }

  private async render(job: any, source: any, owner: string): Promise<void> {
    const candidate = (
      await this.db.query("SELECT * FROM candidate_moments WHERE id=$1 AND workspace_id=$2", [
        job.candidate_id,
        job.workspace_id,
      ])
    )[0];
    const revision = job.payload.revision;
    if (
      !candidate ||
      candidate.edit_revision !== revision ||
      candidate.approved_revision !== revision ||
      candidate.approved_rights_revision !== source.rights_revision
    ) {
      await this.db.query(
        "UPDATE processing_jobs SET status='cancelled',finished_at=now() WHERE id=$1 AND lease_owner=$2",
        [job.id, owner],
      );
      return;
    }
    const key = `${source.workspace_id}/${source.id}/renders/${candidate.id}-r${revision}-${job.id}-${owner}.mp4`;
    const target = await this.store.prepare(key);
    const started = Date.now();
    let valid = false;
    try {
      const metadata = await media({
        operation: "render",
        source: this.store.resolve(source.storage_key),
        output: target,
        plan: candidate.edit_plan,
      });
      const digest = await checksum(target);
      await this.db.transaction(async (client) => {
        const row = (
          await client.query(
            "SELECT c.*,s.status AS source_status,s.rights_revision,j.lease_owner,j.status AS job_status FROM candidate_moments c JOIN source_assets s ON s.id=c.source_id AND s.workspace_id=c.workspace_id JOIN processing_jobs j ON j.candidate_id=c.id AND j.workspace_id=c.workspace_id WHERE c.id=$1 AND c.workspace_id=$2 AND j.id=$3 FOR UPDATE OF s,c,j",
            [candidate.id, candidate.workspace_id, job.id],
          )
        ).rows[0];
        if (
          !row ||
          ["deleting", "deleted", "expired"].includes(row.source_status) ||
          row.job_status !== "running" ||
          row.lease_owner !== owner ||
          row.edit_revision !== revision ||
          row.approved_revision !== revision ||
          row.approved_rights_revision !== row.rights_revision
        ) {
          await client.query(
            "UPDATE processing_jobs SET status='cancelled',finished_at=now() WHERE id=$1 AND lease_owner=$2",
            [job.id, owner],
          );
          return;
        }
        await client.query(
          "INSERT INTO rendered_clips(id,workspace_id,candidate_id,edit_revision,storage_key,checksum,metadata) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(candidate_id,edit_revision) DO UPDATE SET storage_key=excluded.storage_key,checksum=excluded.checksum,metadata=excluded.metadata",
          [randomUUID(), source.workspace_id, candidate.id, revision, key, digest, metadata],
        );
        await client.query("UPDATE candidate_moments SET status='rendered' WHERE id=$1 AND workspace_id=$2", [
          candidate.id,
          source.workspace_id,
        ]);
        await client.query(
          "UPDATE processing_jobs SET status='succeeded',finished_at=now(),error=NULL,telemetry=$3 WHERE id=$1 AND lease_owner=$2",
          [job.id, owner, { wallSeconds: (Date.now() - started) / 1000 }],
        );
        await client.query(
          "INSERT INTO audit_events(id,workspace_id,kind,entity_id,data) VALUES($1,$2,'render.completed',$3,$4)",
          [randomUUID(), source.workspace_id, candidate.id, { revision }],
        );
        valid = true;
      });
    } finally {
      if (!valid) {
        await this.store.remove(key);
        await this.store.remove(key.replace(/\.mp4$/, ".partial.mp4"));
      }
    }
  }
}

export async function expireSources(db: Database, store: LocalObjectStore): Promise<number> {
  const expired = await db.transaction(async (client) => {
    const rows = (
      await client.query(
        "SELECT id,workspace_id,storage_key,analysis FROM source_assets WHERE retention_deadline<now() AND status IN ('queued','processing','ready','failed') FOR UPDATE SKIP LOCKED",
      )
    ).rows;
    for (const s of rows) {
      await client.query(
        "UPDATE source_assets SET status='expired',cleanup_pending=true WHERE id=$1 AND workspace_id=$2",
        [s.id, s.workspace_id],
      );
      await client.query(
        "UPDATE processing_jobs SET status='cancelled',finished_at=now() WHERE source_id=$1 AND workspace_id=$2 AND status IN ('running','pending')",
        [s.id, s.workspace_id],
      );
      await client.query(
        "UPDATE candidate_moments SET status='expired' WHERE source_id=$1 AND workspace_id=$2 AND status<>'rendered'",
        [s.id, s.workspace_id],
      );
    }
    return rows;
  });
  const pending = await db.query(
    "SELECT id,workspace_id,storage_key,status FROM source_assets WHERE (status='expired' AND cleanup_pending=true) OR status='deleting'",
  );
  for (const s of pending) {
    try {
      if (s.status === "deleting") {
        await store.remove(`${s.workspace_id}/${s.id}`);
        const updated = await db.query(
          "UPDATE source_assets SET status='deleted',analysis=NULL,cleanup_pending=false WHERE id=$1 AND workspace_id=$2 AND status='deleting' RETURNING id",
          [s.id, s.workspace_id],
        );
        if (updated.length) await audit(db, s.workspace_id, null, "source.deleted", s.id);
      } else {
        await store.remove(s.storage_key);
        await store.remove(`${s.workspace_id}/${s.id}/analysis`);
        const updated = await db.query(
          "UPDATE source_assets SET cleanup_pending=false,analysis=NULL WHERE id=$1 AND workspace_id=$2 AND status='expired' AND cleanup_pending=true RETURNING id",
          [s.id, s.workspace_id],
        );
        if (updated.length) await audit(db, s.workspace_id, null, "source.expired", s.id);
      }
    } catch {
      await audit(db, s.workspace_id, null, "retention.failed", s.id);
    }
  }
  return expired.length;
}
