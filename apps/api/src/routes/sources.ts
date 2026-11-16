import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { rightsSchema, uploadMetadataSchema } from "../../../../packages/domain/src/index";
import type { App } from "../context";
import { httpError, sendObject, sourceFor } from "../context";
import { audit } from "../jobs";
import { checksum, media } from "../media";

export function sourceRoutes(app: App): void {
  app.get("/api/sources", async (req) =>
    app.db.query(
      `SELECT s.id,s.title,s.game,s.source_platform,s.capture_time,s.metadata,s.rights,s.rights_revision,s.retention_deadline,s.status,s.error,s.created_at,s.byte_size,c.name AS creator,
    (SELECT count(*)::int FROM candidate_moments cm WHERE cm.source_id=s.id AND cm.workspace_id=s.workspace_id) AS candidate_count
    FROM source_assets s JOIN creator_identities c ON c.id=s.creator_id AND c.workspace_id=s.workspace_id WHERE s.workspace_id=$1 AND s.status NOT IN ('deleted','deleting') ORDER BY s.created_at DESC LIMIT 200`,
      [req.identity.workspaceId],
    ),
  );
  app.get<{ Params: { id: string } }>("/api/sources/:id", async (req) => {
    const { storage_key: _key, ...source } = await sourceFor(app, req.params.id, req.identity.workspaceId);
    return source;
  });
  app.post("/api/sources", async (req, reply) => {
    const { workspaceId, userId } = req.identity;
    const id = randomUUID();
    const key = `${workspaceId}/${id}/original/master.bin`;
    let completed = false;
    let fileFound = false;
    let rawMetadata: unknown;
    let bytes = 0;
    try {
      for await (const part of req.parts()) {
        if (part.type === "file") {
          if (part.fieldname !== "file" || fileFound) throw httpError(400, "Upload one video file");
          fileFound = true;
          const target = await app.store.prepare(key);
          part.file.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
          });
          await pipeline(part.file, createWriteStream(target, { flags: "wx", mode: 0o600 }));
          if (part.file.truncated) throw httpError(413, "Video exceeds the upload size limit");
        } else {
          if (part.fieldname !== "metadata" || rawMetadata !== undefined)
            throw httpError(400, "Invalid upload metadata fields");
          try {
            rawMetadata = JSON.parse(String(part.value));
          } catch {
            throw httpError(400, "Metadata must be JSON");
          }
        }
      }
      if (!fileFound || bytes === 0) throw httpError(400, "A video recording is required");
      const metadata = uploadMetadataSchema.parse(rawMetadata);
      let info: import("../../../../packages/domain/src/index").MediaMetadata;
      try {
        info = await media({ operation: "probe", source: app.store.resolve(key) });
      } catch {
        throw httpError(400, "This file is not a supported playable video recording");
      }
      const digest = await checksum(app.store.resolve(key));
      const rights = {
        sourceAuthorized: true,
        voiceAuthorized: true,
        gameRights: "unknown",
        musicDetected: "unknown",
        musicRights: "unknown",
        spoilerRisk: "medium",
        embargoed: metadata.embargoed,
        thirdParty: false,
        evidence: metadata.authorizationBasis,
      };
      await app.db.transaction(async (client) => {
        const creator = (
          await client.query(
            "INSERT INTO creator_identities(id,workspace_id,name) VALUES($1,$2,$3) ON CONFLICT(workspace_id,name) DO UPDATE SET name=excluded.name RETURNING id",
            [randomUUID(), workspaceId, metadata.creator],
          )
        ).rows[0];
        await client.query(
          `INSERT INTO source_assets(id,workspace_id,creator_id,title,game,source_platform,capture_time,authorization_basis,attestation_version,storage_key,checksum,byte_size,metadata,rights,retention_deadline,status)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,'creator-upload-v1',$9,$10,$11,$12,$13,now()+$14*interval '1 day','queued')`,
          [
            id,
            workspaceId,
            creator.id,
            metadata.title,
            metadata.game,
            metadata.platform,
            metadata.capturedAt,
            metadata.authorizationBasis,
            key,
            digest,
            bytes,
            info,
            rights,
            app.config.retentionDays,
          ],
        );
        await client.query(
          "INSERT INTO rights_attestations(id,workspace_id,source_id,user_id,version,statement) VALUES($1,$2,$3,$4,'creator-upload-v1',$5)",
          [randomUUID(), workspaceId, id, userId, metadata.authorizationBasis],
        );
        await client.query(
          "INSERT INTO processing_jobs(id,workspace_id,source_id,kind,idempotency_key) VALUES($1,$2,$3,'analyze',$4)",
          [randomUUID(), workspaceId, id, `analyze:${id}`],
        );
        await client.query(
          "INSERT INTO audit_events(id,workspace_id,user_id,kind,entity_id,data) VALUES($1,$2,$3,'source.uploaded',$4,$5)",
          [randomUUID(), workspaceId, userId, id, { bytes, platform: metadata.platform }],
        );
      });
      completed = true;
      return reply.status(201).send({ id });
    } finally {
      if (!completed) await app.store.remove(`${workspaceId}/${id}`);
    }
  });
  app.get<{ Params: { id: string } }>("/api/sources/:id/media", async (req, reply) => {
    const source = await sourceFor(app, req.params.id, req.identity.workspaceId);
    if (source.status === "expired") throw httpError(404, "Original recording has expired");
    const proxy = source.analysis?.artifactPrefix;
    return sendObject(
      app,
      req,
      reply,
      proxy ? `${proxy}/proxy.mp4` : source.storage_key,
      proxy ? "video/mp4" : "application/octet-stream",
    );
  });
  app.get<{ Params: { id: string } }>("/api/sources/:id/poster", async (req, reply) => {
    const source = await sourceFor(app, req.params.id, req.identity.workspaceId);
    if (!source.analysis?.artifactPrefix || source.status === "expired")
      throw httpError(404, "Poster unavailable");
    return sendObject(app, req, reply, `${source.analysis.artifactPrefix}/poster.jpg`, "image/jpeg");
  });
  app.patch<{ Params: { id: string } }>("/api/sources/:id/rights", async (req) => {
    await sourceFor(app, req.params.id, req.identity.workspaceId);
    const { expectedRevision, ...rights } = rightsSchema
      .extend({ expectedRevision: z.number().int().positive() })
      .parse(req.body);
    await app.db.transaction(async (client) => {
      const source = (
        await client.query(
          "SELECT * FROM source_assets WHERE id=$1 AND workspace_id=$2 AND status NOT IN ('deleted','deleting','expired') FOR UPDATE",
          [req.params.id, req.identity.workspaceId],
        )
      ).rows[0];
      if (!source) throw httpError(409, "Source is no longer editable");
      if (source.rights_revision !== expectedRevision)
        throw httpError(409, "Rights changed in another session. Refresh before saving.");
      if (source.rights.embargoed && !rights.embargoed)
        throw httpError(409, "An embargo lock cannot be cleared through the review workflow");
      await client.query(
        "UPDATE source_assets SET rights=$3,rights_revision=rights_revision+1 WHERE id=$1 AND workspace_id=$2",
        [source.id, req.identity.workspaceId, rights],
      );
      await client.query(
        "UPDATE candidate_moments SET approved_revision=NULL,approved_rights_revision=NULL,status=CASE WHEN status='rejected' THEN 'rejected' ELSE 'needs_review' END WHERE source_id=$1 AND workspace_id=$2",
        [source.id, req.identity.workspaceId],
      );
      await client.query(
        "UPDATE processing_jobs SET status='cancelled',finished_at=now() WHERE source_id=$1 AND workspace_id=$2 AND kind='render' AND status IN ('pending','running')",
        [source.id, req.identity.workspaceId],
      );
      await client.query(
        "INSERT INTO audit_events(id,workspace_id,user_id,kind,entity_id,data) VALUES($1,$2,$3,'rights.updated',$4,$5)",
        [
          randomUUID(),
          req.identity.workspaceId,
          req.identity.userId,
          source.id,
          { gameRights: rights.gameRights, musicRights: rights.musicRights, embargoed: rights.embargoed },
        ],
      );
    });
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>("/api/sources/:id", async (req) => {
    if (!/^[a-f0-9-]{36}$/.test(req.params.id)) throw httpError(404, "Source not found");
    const source = (
      await app.db.query(
        "SELECT id FROM source_assets WHERE id=$1 AND workspace_id=$2 AND status<>'deleted'",
        [req.params.id, req.identity.workspaceId],
      )
    )[0];
    if (!source) throw httpError(404, "Source not found");
    await app.db.transaction(async (client) => {
      await client.query("UPDATE source_assets SET status='deleting' WHERE id=$1 AND workspace_id=$2", [
        source.id,
        req.identity.workspaceId,
      ]);
      await client.query(
        "UPDATE processing_jobs SET status='cancelled',finished_at=now() WHERE source_id=$1 AND workspace_id=$2 AND status IN ('running','pending')",
        [source.id, req.identity.workspaceId],
      );
      await client.query(
        "UPDATE candidate_moments SET status='expired',approved_revision=NULL WHERE source_id=$1 AND workspace_id=$2",
        [source.id, req.identity.workspaceId],
      );
    });
    await app.store.remove(`${req.identity.workspaceId}/${source.id}`);
    await app.db.query(
      "UPDATE source_assets SET status='deleted',analysis=NULL WHERE id=$1 AND workspace_id=$2",
      [source.id, req.identity.workspaceId],
    );
    await audit(app.db, req.identity.workspaceId, req.identity.userId, "source.deleted", source.id);
    return { ok: true };
  });
}
