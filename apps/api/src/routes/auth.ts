import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { COOKIE, hashPassword, tokenHash, verifyPassword } from "../auth";
import type { App } from "../context";
import { httpError } from "../context";

const loginSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    password: z.string().min(12).max(200),
  })
  .strict();
const registerSchema = loginSchema.extend({
  name: z.string().trim().min(1).max(80),
  workspace: z.string().trim().min(1).max(100),
});
export function authRoutes(app: App): void {
  const session = async (reply: any, userId: string, workspaceId: string) => {
    const token = randomBytes(32).toString("base64url");
    await app.db.query(
      "INSERT INTO sessions(token_hash,user_id,workspace_id,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
      [tokenHash(token), userId, workspaceId],
    );
    reply.setCookie(COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: app.config.cookieSecure,
      maxAge: 604800,
    });
  };
  app.post(
    "/api/auth/register",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = registerSchema.parse(req.body);
      const userId = randomUUID(),
        workspaceId = randomUUID();
      const hash = await hashPassword(body.password);
      await app.db.transaction(async (client) => {
        const result = await client.query(
          "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING RETURNING id",
          [userId, body.email, body.name, hash],
        );
        if (!result.rowCount) throw httpError(409, "This email is already registered");
        await client.query("INSERT INTO workspaces(id,name) VALUES($1,$2)", [workspaceId, body.workspace]);
        await client.query("INSERT INTO memberships(user_id,workspace_id) VALUES($1,$2)", [
          userId,
          workspaceId,
        ]);
      });
      await session(reply, userId, workspaceId);
      return reply.status(201).send({ id: userId });
    },
  );
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = loginSchema.parse(req.body);
      const user = (
        await app.db.query(
          "SELECT u.*,m.workspace_id FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.email=$1 ORDER BY m.workspace_id LIMIT 1",
          [body.email],
        )
      )[0];
      const valid = await verifyPassword(
        body.password,
        user?.password_hash ||
          "00000000000000000000000000000000:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      );
      if (!user || !valid) throw httpError(401, "Email or password is incorrect");
      await session(reply, user.id, user.workspace_id);
      return { id: user.id };
    },
  );
  app.post("/api/auth/demo", async (_req, reply) => {
    if (!app.config.demoEnabled) throw httpError(404, "Sample workspace is disabled");
    const user = (
      await app.db.query(
        "SELECT u.id,m.workspace_id FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.email='demo@cliplane.local'",
      )
    )[0];
    if (!user) throw httpError(503, "Run npm run seed to create the sample workspace");
    await session(reply, user.id, user.workspace_id);
    return { id: user.id };
  });
  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) await app.db.query("DELETE FROM sessions WHERE token_hash=$1", [tokenHash(token)]);
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });
  app.get("/api/me", async (req) => ({ ...req.identity, demoEnabled: app.config.demoEnabled }));
}
