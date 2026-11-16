import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { hashPassword } from "../apps/api/src/auth";
import { getConfig } from "../apps/api/src/config";
import { JobRunner } from "../apps/api/src/jobs";
import { checksum, media } from "../apps/api/src/media";
import { LocalObjectStore } from "../apps/api/src/storage";
import { Database } from "../packages/db/src/index";

const config = getConfig();
if (!config.demoEnabled) throw new Error("Demo seeding requires development mode and DEMO_ENABLED=1");
const db = new Database(config.databaseUrl);
await db.migrate();
const store = new LocalObjectStore(config.dataDir);
const sample = fileURLToPath(new URL("../packages/test-fixtures/nightdrift-original.mp4", import.meta.url));
const themes = [
  { name: "Nightdrift", title: "One clean pass", hue: 0 },
  { name: "Nightdrift · violet hour", title: "The late-night line", hue: 38 },
  { name: "Nightdrift · afterglow", title: "Just one more run", hue: -24 },
];

try {
  let user = (
    await db.query(
      "SELECT u.id,m.workspace_id FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.email='demo@cliplane.local'",
    )
  )[0];
  if (!user) {
    const userId = randomUUID(),
      workspaceId = randomUUID();
    await db.transaction(async (client) => {
      await client.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,'demo@cliplane.local','Alex Morgan',$2)",
        [userId, await hashPassword(randomBytes(32).toString("hex"))],
      );
      await client.query("INSERT INTO workspaces(id,name) VALUES($1,'Alex’s studio')", [workspaceId]);
      await client.query("INSERT INTO memberships(user_id,workspace_id) VALUES($1,$2)", [
        userId,
        workspaceId,
      ]);
      await client.query(
        "INSERT INTO audit_events(id,workspace_id,user_id,kind,entity_id) VALUES($1,$2,$3,'demo.seeded',$3)",
        [randomUUID(), workspaceId, userId],
      );
    });
    user = { id: userId, workspace_id: workspaceId };
  }
  // Upgrade only a proven legacy sample; never relabel a normal creator account.
  const marked = await db.query(
    "SELECT id FROM audit_events WHERE kind='demo.seeded' AND user_id=$1 AND entity_id=$1 AND workspace_id=$2",
    [user.id, user.workspace_id],
  );
  if (!marked.length) {
    const legacy = await db.query(
      "SELECT id FROM rights_attestations WHERE user_id=$1 AND workspace_id=$2 AND version='synthetic-demo-v1' LIMIT 1",
      [user.id, user.workspace_id],
    );
    if (!legacy.length)
      throw new Error("Reserved demo email belongs to an unmarked account; refusing to expose it");
    await db.query(
      "INSERT INTO audit_events(id,workspace_id,user_id,kind,entity_id) VALUES($1,$2,$3,'demo.seeded',$3)",
      [randomUUID(), user.workspace_id, user.id],
    );
  }
  const existing = await db.query("SELECT id FROM source_assets WHERE workspace_id=$1", [user.workspace_id]);
  if (existing.length) {
    console.log("Sample workspace already exists; existing footage preserved.");
  } else
    for (let index = 0; index < themes.length; index++) {
      const theme = themes[index];
      const sourceId = randomUUID(),
        creatorId = randomUUID();
      const key = `${user.workspace_id}/${sourceId}/original/master.bin`;
      const target = await store.prepare(key);
      // Original procedural footage, looped and color-varied for three sample recordings.
      execFileSync(
        "ffmpeg",
        [
          "-hide_banner",
          "-v",
          "error",
          "-y",
          "-stream_loop",
          "-1",
          "-i",
          sample,
          "-t",
          "65",
          "-vf",
          `scale=960:540,hue=h=${theme.hue}`,
          "-c:v",
          "libx264",
          "-threads",
          "2",
          "-preset",
          "ultrafast",
          "-crf",
          "25",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-b:a",
          "64k",
          "-f",
          "mp4",
          target,
        ],
        { timeout: 120000 },
      );
      const metadata = await media({ operation: "probe", source: target });
      const digest = await checksum(target),
        info = await stat(target);
      const rights = {
        sourceAuthorized: true,
        voiceAuthorized: true,
        gameRights: "authorized",
        musicDetected: "unlikely",
        musicRights: "licensed",
        spoilerRisk: "low",
        embargoed: false,
        thirdParty: false,
        evidence:
          "Original procedural motion and generated engine audio, created for the Cliplane sample workspace; no game footage or third-party assets.",
      };
      await db.transaction(async (client) => {
        await client.query("INSERT INTO creator_identities(id,workspace_id,name) VALUES($1,$2,$3)", [
          creatorId,
          user.workspace_id,
          `Demo creator ${index + 1}`,
        ]);
        await client.query(
          `INSERT INTO source_assets(id,workspace_id,creator_id,title,game,source_platform,capture_time,authorization_basis,attestation_version,storage_key,checksum,byte_size,metadata,rights,retention_deadline,status) VALUES($1,$2,$3,$4,$5,'local',now(),$6,'synthetic-demo-v1',$7,$8,$9,$10,$11,now()+interval '7 days','queued')`,
          [
            sourceId,
            user.workspace_id,
            creatorId,
            `${theme.title} · Synthetic demo`,
            theme.name,
            rights.evidence,
            key,
            digest,
            info.size,
            metadata,
            rights,
          ],
        );
        await client.query(
          "INSERT INTO rights_attestations(id,workspace_id,source_id,user_id,version,statement) VALUES($1,$2,$3,$4,'synthetic-demo-v1',$5)",
          [randomUUID(), user.workspace_id, sourceId, user.id, rights.evidence],
        );
        await client.query(
          "INSERT INTO processing_jobs(id,workspace_id,source_id,kind,idempotency_key) VALUES($1,$2,$3,'analyze',$4)",
          [randomUUID(), user.workspace_id, sourceId, `analyze:${sourceId}`],
        );
        await client.query(
          "INSERT INTO audit_events(id,workspace_id,user_id,kind,entity_id,data) VALUES($1,$2,$3,'source.uploaded',$4,$5)",
          [randomUUID(), user.workspace_id, user.id, sourceId, { synthetic: true }],
        );
      });
      console.log(`Created original sample: ${theme.name}`);
    }
  const runner = new JobRunner(db, store);
  while (await runner.processOne()) {
    /* Process real durable jobs. */
  }
  console.log("Sample studio ready. Choose ‘Explore the sample studio’ on the sign-in screen.");
} finally {
  await db.close();
}
