import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import sharp from "sharp";
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
const themes = [
  {
    name: "Sunset sprint",
    title: "Last light, one more lap",
    sky: "#a7a7bd",
    horizon: "#efb48d",
    sun: "#ffe3a1",
    ground: "#777f6c",
    road: "#515d65",
    car: "#c46e56",
    accent: "#aecab8",
  },
  {
    name: "Coastal run",
    title: "Taking the long way home",
    sky: "#8aafba",
    horizon: "#c8dace",
    sun: "#f2e3b3",
    ground: "#849e87",
    road: "#4f6666",
    car: "#d9d1ae",
    accent: "#789a82",
  },
  {
    name: "After hours",
    title: "The city has a different rhythm",
    sky: "#625e84",
    horizon: "#d39f9c",
    sun: "#e8baaa",
    ground: "#5e6e77",
    road: "#3b485b",
    car: "#9da7bd",
    accent: "#899eb7",
  },
];
function illustration(theme: (typeof themes)[number], index: number): string {
  const buildings = Array.from({ length: 17 }, (_, i) => {
    const x = i * 85 - 30,
      height = 50 + ((i * 43 + index * 19) % 145);
    return `<rect x="${x}" y="${390 - height}" width="${55 + (i % 3) * 12}" height="${height}" fill="${i % 2 ? "#596b72" : "#6e7b79"}" opacity=".75"/>${Array.from({ length: 5 }, (_, j) => `<rect x="${x + 10 + j * 9}" y="${410 - height}" width="3" height="5" fill="${theme.sun}" opacity=".5"/>`).join("")}`;
  }).join("");
  const palm = (x: number, y: number, scale: number) =>
    `<g transform="translate(${x},${y}) scale(${scale})"><path d="M0 0Q-12-90 0-185" fill="none" stroke="#3c5a57" stroke-width="12"/><path d="M0-183Q-55-228-105-187Q-45-202-10-178Q-84-183-95-130Q-38-178 0-178Q0-240 42-246Q9-210 6-183Q62-231 107-195Q40-208 11-177Q82-190 98-144Q45-180 0-177Z" fill="#3d625b"/></g>`;
  return `<svg width="1280" height="720" viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${theme.sky}"/><stop offset="1" stop-color="${theme.horizon}"/></linearGradient><linearGradient id="land" x2="0" y2="1"><stop stop-color="${theme.ground}"/><stop offset="1" stop-color="#53685c"/></linearGradient></defs><rect width="1280" height="720" fill="url(#sky)"/><circle cx="845" cy="260" r="70" fill="${theme.sun}" opacity=".8"/><path d="M0 350L100 297 220 336 340 290 410 352 550 302 660 350 800 310 910 356 1100 290 1280 330V430H0Z" fill="#778980" opacity=".4"/>${buildings}<rect y="389" width="1280" height="331" fill="url(#land)"/><path d="M560 385H686L1100 720H160Z" fill="${theme.road}"/><path d="M561 385L158 720M687 385L1103 720" stroke="#c5b48f" stroke-width="4"/><path d="M625 391L620 420M620 443L613 485M609 514L598 575M591 615L579 700" stroke="#e8d5a6" stroke-width="5"/><path d="M0 476L533 407M1280 480L713 406" stroke="${theme.accent}" stroke-width="5" opacity=".7"/>${palm(180, 490, 1.18)}${palm(1110, 540, 1.5)}${palm(375, 438, 0.6)}${palm(900, 442, 0.72)}<g transform="translate(550,537)"><ellipse cx="57" cy="79" rx="93" ry="14" fill="#263942" opacity=".3"/><rect x="-12" y="27" width="18" height="58" rx="5" fill="#27363c"/><rect x="113" y="27" width="18" height="58" rx="5" fill="#27363c"/><path d="M-9 36L5-1Q60-17 112-1L128 36 124 79Q60 91-7 79Z" fill="${theme.car}" stroke="#464e52" stroke-width="4"/><path d="M13 4Q61-6 105 4L114 36Q61 29 4 36Z" fill="#49626a" stroke="#a7b8b5" stroke-width="2"/><path d="M-3 57H25M94 57H122" stroke="#f3b99c" stroke-width="7"/><rect x="43" y="71" width="32" height="11" rx="2" fill="#d3c9ac"/></g><g opacity=".8"><rect x="34" y="31" width="168" height="30" rx="4" fill="#233f41" opacity=".5"/><circle cx="49" cy="46" r="4" fill="#eeb797"/><text x="61" y="50" font-family="monospace" font-size="11" fill="#f3e6c8">SYNTHETIC DEMO</text><text x="1244" y="50" text-anchor="end" font-family="monospace" font-size="11" fill="#e8ead9">CLIPLANE / ORIGINAL ART</text><rect x="34" y="573" width="124" height="110" rx="8" fill="#30474b" opacity=".55"/><path d="M48 654L63 618 102 631 145 601M48 600L141 668" fill="none" stroke="#b5c9ac" stroke-width="3"/><circle cx="94" cy="637" r="5" fill="#eed7aa"/><text x="1208" y="653" text-anchor="end" font-family="monospace" font-size="40" fill="#e3e9dd">${71 + index * 12}</text><text x="1208" y="674" text-anchor="end" font-family="monospace" font-size="10" fill="#c6d7cd">DEMO KM/H</text></g></svg>`;
}

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
    });
    user = { id: userId, workspace_id: workspaceId };
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
      const png = await store.prepare(`${user.workspace_id}/${sourceId}/original/art.png`);
      await sharp(Buffer.from(illustration(theme, index)))
        .png()
        .toFile(png);
      execFileSync(
        "ffmpeg",
        [
          "-hide_banner",
          "-v",
          "error",
          "-y",
          "-loop",
          "1",
          "-framerate",
          "24",
          "-i",
          png,
          "-f",
          "lavfi",
          "-i",
          `sine=frequency=${330 + index * 110}:duration=65`,
          "-t",
          "65",
          "-vf",
          "scale=960:540",
          "-af",
          "volume='if(between(t,12,16)+between(t,45,49),1,0.05)':eval=frame",
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
          "Original synthetic artwork and generated test tone, created for the Cliplane sample workspace; no game footage.",
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
