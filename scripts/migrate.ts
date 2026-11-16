import { getConfig } from "../apps/api/src/config";
import { Database } from "../packages/db/src/index";

const db = new Database(getConfig().databaseUrl);
try {
  await db.migrate();
  console.log("PostgreSQL migrations are current.");
} finally {
  await db.close();
}
