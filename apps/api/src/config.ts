import "dotenv/config";
import path from "node:path";

export interface Config {
  databaseUrl: string;
  dataDir: string;
  origin: string;
  apiPort: number;
  demoEnabled: boolean;
  cookieSecure: boolean;
  maxUploadBytes: number;
  retentionDays: number;
}
export function getConfig(): Config {
  const production = process.env.NODE_ENV === "production";
  if (
    production &&
    (!process.env.DATABASE_URL ||
      !process.env.APP_ORIGIN?.startsWith("https://") ||
      process.env.COOKIE_SECURE !== "1" ||
      process.env.DEMO_ENABLED === "1")
  )
    throw new Error("Production requires DATABASE_URL, HTTPS APP_ORIGIN, COOKIE_SECURE=1 and DEMO_ENABLED=0");
  return {
    databaseUrl: process.env.DATABASE_URL || "postgres://cliplane:cliplane_local@127.0.0.1:54329/cliplane",
    dataDir: path.resolve(process.env.DATA_DIR || "data"),
    origin: process.env.APP_ORIGIN || "http://localhost:3000",
    apiPort: Number(process.env.API_PORT || 4000),
    demoEnabled: !production && process.env.DEMO_ENABLED !== "0",
    cookieSecure: process.env.COOKIE_SECURE === "1",
    maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 2147483648),
    retentionDays: Number(process.env.RAW_RETENTION_DAYS || 7),
  };
}
