import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
export type Queryable = Pick<pg.Pool, "query">;

export class Database {
  readonly pool: pg.Pool;
  constructor(url: string, schema?: string) {
    if (schema && !/^[a-z0-9_]+$/.test(schema)) throw new Error("Invalid schema");
    this.pool = new pg.Pool({
      connectionString: url,
      max: 8,
      ...(schema ? { options: `-c search_path=${schema}` } : {}),
    });
  }
  async query<T extends pg.QueryResultRow = any>(sql: string, params: any[] = []): Promise<T[]> {
    return (await this.pool.query<T>(sql, params)).rows;
  }
  async transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async migrate(): Promise<void> {
    const sql = await readFile(new URL("../migrations/001_initial.sql", import.meta.url), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    await this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(139314823)");
      await client.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz DEFAULT now())",
      );
      const { rows } = await client.query("SELECT checksum FROM schema_migrations WHERE version=1");
      if (rows[0] && rows[0].checksum !== checksum) throw new Error("Applied migration checksum mismatch");
      if (!rows[0]) {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(version,checksum) VALUES(1,$1)", [checksum]);
      }
    });
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
}
