import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Database } from "../../../packages/db/src/index";
import type { Identity } from "./auth";
import type { Config } from "./config";
import type { MediaExecutor } from "./media";
import type { LocalObjectStore } from "./storage";
import { parseRange } from "./storage";

declare module "fastify" {
  interface FastifyRequest {
    identity: Identity;
  }
}
export type App = FastifyInstance & {
  db: Database;
  store: LocalObjectStore;
  config: Config;
  executeMedia: MediaExecutor;
};
export function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}
export async function sourceFor(app: App, id: string, workspace: string): Promise<any> {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw httpError(404, "Source not found");
  const row = (
    await app.db.query(
      "SELECT s.*,c.name AS creator FROM source_assets s JOIN creator_identities c ON c.id=s.creator_id AND c.workspace_id=s.workspace_id WHERE s.id=$1 AND s.workspace_id=$2 AND s.status NOT IN ('deleting','deleted')",
      [id, workspace],
    )
  )[0];
  if (!row) throw httpError(404, "Source not found");
  return row;
}
export async function candidateFor(app: App, id: string, workspace: string): Promise<any> {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw httpError(404, "Moment not found");
  const row = (
    await app.db.query(
      `SELECT c.*,s.title AS source_title,s.game,s.rights,s.rights_revision,s.metadata,s.status AS source_status,ci.name AS creator
    FROM candidate_moments c JOIN source_assets s ON s.id=c.source_id AND s.workspace_id=c.workspace_id
    JOIN creator_identities ci ON ci.id=s.creator_id AND ci.workspace_id=s.workspace_id
    WHERE c.id=$1 AND c.workspace_id=$2 AND s.status NOT IN ('deleting','deleted')`,
      [id, workspace],
    )
  )[0];
  if (!row) throw httpError(404, "Moment not found");
  return row;
}
export async function sendObject(
  app: App,
  req: FastifyRequest,
  reply: FastifyReply,
  key: string,
  contentType: string,
  download = false,
): Promise<FastifyReply> {
  let info: Awaited<ReturnType<LocalObjectStore["info"]>>;
  try {
    info = await app.store.info(key);
  } catch {
    throw httpError(404, "Media file is no longer available");
  }
  reply
    .header("Cache-Control", "private, no-store")
    .header("Accept-Ranges", "bytes")
    .header("Content-Type", contentType)
    .header("X-Content-Type-Options", "nosniff");
  if (download) reply.header("Content-Disposition", 'attachment; filename="cliplane-clip.mp4"');
  if (req.headers.range) {
    const range = parseRange(req.headers.range, info.size);
    if (!range) return reply.status(416).header("Content-Range", `bytes */${info.size}`).send();
    return reply
      .status(206)
      .header("Content-Range", `bytes ${range.start}-${range.end}/${info.size}`)
      .header("Content-Length", range.end - range.start + 1)
      .send(app.store.stream(key, range));
  }
  return reply.header("Content-Length", info.size).send(app.store.stream(key));
}
