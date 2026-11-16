import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { z } from "zod";
import type { Database } from "../../../packages/db/src/index";
import { COOKIE, tokenHash } from "./auth";
import type { Config } from "./config";
import type { App } from "./context";
import { httpError } from "./context";
import { authRoutes } from "./routes/auth";
import { candidateRoutes } from "./routes/candidates";
import { sourceRoutes } from "./routes/sources";
import { LocalObjectStore } from "./storage";

export async function buildApp(config: Config, db: Database): Promise<App> {
  const app = Fastify({ logger: false, bodyLimit: 65536, requestTimeout: 600000 }) as unknown as App;
  app.decorate("db", db);
  app.decorate("store", new LocalObjectStore(config.dataDir));
  app.decorate("config", config);
  app.decorateRequest("identity");
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  await app.register(multipart, {
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 1, fieldSize: 12000, parts: 2 },
    throwFileSizeLimit: true,
  });
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "same-origin")
      .header("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (
        (req.headers.origin && req.headers.origin !== config.origin) ||
        req.headers["sec-fetch-site"] === "cross-site"
      )
        throw httpError(403, "Cross-site requests are not allowed");
    }
    const pathname = req.url.split("?")[0];
    if (["/api/health", "/api/auth/register", "/api/auth/login", "/api/auth/demo"].includes(pathname)) return;
    const token = req.cookies[COOKIE];
    if (!token) throw httpError(401, "Sign in to your workspace");
    const identity = (
      await db.query(
        `SELECT u.id AS "userId",s.workspace_id AS "workspaceId",u.email,u.name,w.name AS "workspaceName"
      FROM sessions s JOIN users u ON u.id=s.user_id JOIN workspaces w ON w.id=s.workspace_id
      JOIN memberships m ON m.user_id=s.user_id AND m.workspace_id=s.workspace_id
      WHERE s.token_hash=$1 AND s.expires_at>now()`,
        [tokenHash(token)],
      )
    )[0];
    if (!identity) throw httpError(401, "Your session has expired");
    req.identity = identity as any;
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof z.ZodError)
      return reply.status(400).send({ error: "Invalid input", details: error.issues.map((i) => i.message) });
    const known = error as Error & { statusCode?: number; code?: string };
    const status = known.statusCode || 500;
    return reply
      .status(status)
      .send({ error: status < 500 ? known.message : "The request could not be completed. Please retry." });
  });
  app.get("/api/health", async () => {
    await db.query("SELECT 1");
    return { status: "ok", version: "0.1.0" };
  });
  authRoutes(app);
  sourceRoutes(app);
  candidateRoutes(app);
  app.get("/api/jobs", async (req) =>
    db.query(
      "SELECT id,source_id,candidate_id,kind,status,attempts,error,telemetry,created_at,finished_at FROM processing_jobs WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 200",
      [req.identity.workspaceId],
    ),
  );
  app.post<{ Params: { id: string } }>("/api/jobs/:id/retry", async (req) => {
    if (!z.uuid().safeParse(req.params.id).success) throw httpError(404, "Job not found");
    const job = await db.transaction(async (client) => {
      const row = (
        await client.query(
          "SELECT j.*,s.status AS source_status FROM processing_jobs j JOIN source_assets s ON s.id=j.source_id AND s.workspace_id=j.workspace_id WHERE j.id=$1 AND j.workspace_id=$2 FOR UPDATE OF s,j",
          [req.params.id, req.identity.workspaceId],
        )
      ).rows[0];
      if (row?.status !== "failed" || ["deleted", "deleting", "expired"].includes(row.source_status))
        throw httpError(404, "Failed job not found");
      await client.query(
        "UPDATE processing_jobs SET status='pending',attempts=0,error=NULL,available_at=now(),finished_at=NULL WHERE id=$1 AND workspace_id=$2",
        [row.id, req.identity.workspaceId],
      );
      if (row.kind === "analyze")
        await client.query(
          "UPDATE source_assets SET status='queued',error=NULL WHERE id=$1 AND workspace_id=$2",
          [row.source_id, req.identity.workspaceId],
        );
      return row;
    });
    return { id: job.id };
  });
  app.get("/api/events", async (req) =>
    db.query(
      "SELECT id,kind,entity_id,data,created_at FROM audit_events WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100",
      [req.identity.workspaceId],
    ),
  );
  app.get("/api/dashboard", async (req) => {
    const workspace = req.identity.workspaceId;
    const stats = (
      await db.query(
        `SELECT
      (SELECT count(*)::int FROM source_assets WHERE workspace_id=$1 AND status NOT IN ('deleted','deleting')) AS sources,
      (SELECT coalesce(sum((metadata->>'durationMs')::numeric)/3600000,0)::float FROM source_assets WHERE workspace_id=$1 AND status NOT IN ('deleted','deleting')) AS source_hours,
      (SELECT count(*)::int FROM candidate_moments WHERE workspace_id=$1 AND status='needs_review') AS needs_review,
      (SELECT count(*)::int FROM candidate_moments WHERE workspace_id=$1 AND status='rendered') AS rendered,
      (SELECT count(*)::int FROM processing_jobs WHERE workspace_id=$1 AND status IN ('pending','running')) AS active_jobs,
      (SELECT count(*)::int FROM candidate_moments WHERE workspace_id=$1 AND status IN ('approved','rendered','rendering')) AS accepted,
      (SELECT count(*)::int FROM candidate_moments WHERE workspace_id=$1 AND status='rejected') AS rejected`,
        [workspace],
      )
    )[0];
    const activity = await db.query(
      `SELECT day::date::text AS day,count(e.id)::int AS events FROM generate_series(current_date-6,current_date,interval '1 day') day LEFT JOIN audit_events e ON e.workspace_id=$1 AND e.created_at::date=day::date GROUP BY day ORDER BY day`,
      [workspace],
    );
    return { stats, activity };
  });
  await app.ready();
  return app;
}
