import { Database } from "../../../packages/db/src/index";
import { getConfig } from "./config";
import { expireSources, JobRunner } from "./jobs";
import { media } from "./media";
import { buildApp } from "./server";
import { cancelMediaProcesses } from "./worker-process";

const config = getConfig();
const db = new Database(config.databaseUrl);
await db.migrate();
const app = await buildApp(config, db, media);
const runner = new JobRunner(db, app.store, { executeMedia: media });
await app.listen({ port: config.apiPort, host: "127.0.0.1" });
runner.start();
await expireSources(db, app.store);
const retention = setInterval(() => {
  void expireSources(db, app.store).catch(() =>
    console.error("Retention sweep failed; inspect audit events"),
  );
}, 60000);
console.log(`Cliplane API ready on http://127.0.0.1:${config.apiPort}`);
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const drained = runner.stop();
    cancelMediaProcesses();
    clearInterval(retention);
    void Promise.allSettled([drained, app.close()])
      .then(async (results) => {
        await db.close();
        if (results.some((result) => result.status === "rejected")) throw new Error("Shutdown failed");
      })
      .then(
        () => process.exit(0),
        () => {
          console.error("Shutdown cleanup failed");
          process.exit(1);
        },
      );
  });
