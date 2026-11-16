import { randomUUID } from "node:crypto";
import { z } from "zod";
import { approvalBlockers, editPlanSchema } from "../../../../packages/domain/src/index";
import type { App } from "../context";
import { candidateFor, httpError, sendObject } from "../context";

const candidateSelect = `SELECT c.*,s.title AS source_title,s.game,s.rights,s.rights_revision,s.metadata,s.status AS source_status,ci.name AS creator
  FROM candidate_moments c JOIN source_assets s ON s.id=c.source_id AND s.workspace_id=c.workspace_id
  JOIN creator_identities ci ON ci.id=s.creator_id AND ci.workspace_id=s.workspace_id`;

export function candidateRoutes(app: App): void {
  app.get("/api/candidates", async (req) =>
    app.db.query(
      `${candidateSelect} WHERE c.workspace_id=$1 AND s.status NOT IN ('deleted','deleting') ORDER BY c.score DESC,c.created_at DESC LIMIT 500`,
      [req.identity.workspaceId],
    ),
  );
  app.get<{ Params: { id: string } }>("/api/candidates/:id", async (req) =>
    candidateFor(app, req.params.id, req.identity.workspaceId),
  );
  app.get<{ Params: { id: string } }>("/api/candidates/:id/thumbnail", async (req, reply) => {
    const c = await candidateFor(app, req.params.id, req.identity.workspaceId);
    if (c.source_status === "expired") throw httpError(404, "Preview expired");
    return sendObject(app, req, reply, c.thumbnail_key, "image/jpeg");
  });
  app.patch<{ Params: { id: string } }>("/api/candidates/:id", async (req) => {
    await candidateFor(app, req.params.id, req.identity.workspaceId);
    const body = z
      .object({
        title: z.string().trim().min(1).max(160),
        editPlan: editPlanSchema,
        expectedRevision: z.number().int().positive(),
      })
      .strict()
      .parse(req.body);
    await app.db.transaction(async (client) => {
      const c = (
        await client.query(`${candidateSelect} WHERE c.id=$1 AND c.workspace_id=$2 FOR UPDATE OF s,c`, [
          req.params.id,
          req.identity.workspaceId,
        ])
      ).rows[0];
      if (c?.source_status !== "ready") throw httpError(409, "Original media is not available for editing");
      if (c.edit_revision !== body.expectedRevision)
        throw httpError(409, "This edit changed in another session. Refresh before saving.");
      if (body.editPlan.endMs > c.metadata.durationMs)
        throw httpError(400, "Trim exceeds the source duration");
      await client.query(
        "UPDATE candidate_moments SET title=$3,edit_plan=$4,edit_revision=edit_revision+1,approved_revision=NULL,approved_rights_revision=NULL,status='needs_review' WHERE id=$1 AND workspace_id=$2",
        [c.id, req.identity.workspaceId, body.title, body.editPlan],
      );
      await client.query(
        "UPDATE processing_jobs SET status='cancelled',finished_at=now() WHERE candidate_id=$1 AND workspace_id=$2 AND status IN ('pending','running')",
        [c.id, req.identity.workspaceId],
      );
      await client.query(
        "INSERT INTO audit_events(id,workspace_id,user_id,kind,entity_id,data) VALUES($1,$2,$3,'candidate.edited',$4,$5)",
        [
          randomUUID(),
          req.identity.workspaceId,
          req.identity.userId,
          c.id,
          { revision: c.edit_revision + 1, layout: body.editPlan.layout, muted: body.editPlan.muteAudio },
        ],
      );
    });
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>("/api/candidates/:id/review", async (req) => {
    await candidateFor(app, req.params.id, req.identity.workspaceId);
    const body = z
      .object({
        decision: z.enum(["approved", "rejected"]),
        reason: z.string().trim().min(3).max(1000),
        expectedRevision: z.number().int().positive(),
        expectedRightsRevision: z.number().int().positive(),
      })
      .strict()
      .parse(req.body);
    await app.db.transaction(async (client) => {
      const c = (
        await client.query(`${candidateSelect} WHERE c.id=$1 AND c.workspace_id=$2 FOR UPDATE OF s,c`, [
          req.params.id,
          req.identity.workspaceId,
        ])
      ).rows[0];
      if (c?.source_status !== "ready") throw httpError(409, "Source must be available for review");
      if (c.edit_revision !== body.expectedRevision || c.rights_revision !== body.expectedRightsRevision)
        throw httpError(409, "The edit or rights changed. Review the latest revision before approving.");
      if (body.decision === "approved") {
        const blockers = approvalBlockers(c.rights, c.edit_plan);
        if (blockers.length) throw httpError(409, blockers.join(". "));
      }
      await client.query(
        "UPDATE candidate_moments SET status=CASE WHEN $3='approved' AND EXISTS(SELECT 1 FROM rendered_clips r WHERE r.candidate_id=candidate_moments.id AND r.workspace_id=$2 AND r.edit_revision=candidate_moments.edit_revision) THEN 'rendered' WHEN $3='approved' AND status='rendering' THEN 'rendering' ELSE $3 END,approved_revision=$4,approved_rights_revision=$5 WHERE id=$1 AND workspace_id=$2",
        [
          c.id,
          req.identity.workspaceId,
          body.decision,
          body.decision === "approved" ? c.edit_revision : null,
          body.decision === "approved" ? c.rights_revision : null,
        ],
      );
      if (body.decision === "rejected")
        await client.query(
          "UPDATE processing_jobs SET status='cancelled',finished_at=now() WHERE candidate_id=$1 AND workspace_id=$2 AND status IN ('pending','running')",
          [c.id, req.identity.workspaceId],
        );
      await client.query(
        "INSERT INTO review_decisions(id,workspace_id,candidate_id,user_id,decision,edit_revision,rights_revision,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          randomUUID(),
          req.identity.workspaceId,
          c.id,
          req.identity.userId,
          body.decision,
          c.edit_revision,
          c.rights_revision,
          body.reason,
        ],
      );
      await client.query(
        "INSERT INTO audit_events(id,workspace_id,user_id,kind,entity_id,data) VALUES($1,$2,$3,$4,$5,$6)",
        [
          randomUUID(),
          req.identity.workspaceId,
          req.identity.userId,
          `candidate.${body.decision}`,
          c.id,
          { revision: c.edit_revision, reason: body.reason },
        ],
      );
    });
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>("/api/candidates/:id/render", async (req, reply) => {
    await candidateFor(app, req.params.id, req.identity.workspaceId);
    const job = await app.db.transaction(async (client) => {
      const c = (
        await client.query(`${candidateSelect} WHERE c.id=$1 AND c.workspace_id=$2 FOR UPDATE OF s,c`, [
          req.params.id,
          req.identity.workspaceId,
        ])
      ).rows[0];
      if (
        c?.source_status !== "ready" ||
        c.status === "rejected" ||
        c.approved_revision !== c.edit_revision ||
        c.approved_rights_revision !== c.rights_revision ||
        approvalBlockers(c.rights, c.edit_plan).length
      )
        throw httpError(409, "Review and approve this exact edit before rendering");
      const result = (
        await client.query(
          `INSERT INTO processing_jobs(id,workspace_id,source_id,candidate_id,kind,idempotency_key,payload) VALUES($1,$2,$3,$4,'render',$5,$6)
        ON CONFLICT(idempotency_key) DO UPDATE SET
          status=CASE WHEN processing_jobs.status IN ('cancelled','failed') THEN 'pending' ELSE processing_jobs.status END,
          attempts=CASE WHEN processing_jobs.status IN ('cancelled','failed') THEN 0 ELSE processing_jobs.attempts END,
          lease_owner=CASE WHEN processing_jobs.status IN ('cancelled','failed') THEN NULL ELSE processing_jobs.lease_owner END,
          available_at=now(),error=NULL RETURNING id,status`,
          [
            randomUUID(),
            req.identity.workspaceId,
            c.source_id,
            c.id,
            `render:${c.id}:${c.edit_revision}:${c.rights_revision}`,
            { revision: c.edit_revision },
          ],
        )
      ).rows[0];
      await client.query("UPDATE candidate_moments SET status=$3 WHERE id=$1 AND workspace_id=$2", [
        c.id,
        req.identity.workspaceId,
        result.status === "succeeded" ? "rendered" : "rendering",
      ]);
      return result;
    });
    return reply.status(202).send(job);
  });
  for (const suffix of ["download", "rendered"]) {
    app.get<{ Params: { id: string } }>(`/api/candidates/:id/${suffix}`, async (req, reply) => {
      const c = await candidateFor(app, req.params.id, req.identity.workspaceId);
      if (
        c.status !== "rendered" ||
        c.approved_revision !== c.edit_revision ||
        c.approved_rights_revision !== c.rights_revision
      )
        throw httpError(404, "A reviewed render is not available");
      const render = (
        await app.db.query(
          "SELECT storage_key FROM rendered_clips WHERE candidate_id=$1 AND workspace_id=$2 AND edit_revision=$3",
          [c.id, req.identity.workspaceId, c.edit_revision],
        )
      )[0];
      if (!render) throw httpError(404, "Rendered clip not found");
      return sendObject(app, req, reply, render.storage_key, "video/mp4", suffix === "download");
    });
  }
}
