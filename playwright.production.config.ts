import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const origin = "https://localhost:3443";
const tlsPin = process.env.CLIPLANE_SMOKE_TLS_PIN;
if (process.env.E2E_BASE_URL !== origin || !tlsPin || !/^[A-Za-z0-9+/]{43}=$/.test(tlsPin))
  throw new Error("Start the production image smoke harness to configure loopback HTTPS.");

export default defineConfig({
  ...base,
  use: {
    ...base.use,
    baseURL: origin,
    launchOptions: {
      ...base.use?.launchOptions,
      executablePath: process.env.CI ? undefined : base.use?.launchOptions?.executablePath,
      args: [...(base.use?.launchOptions?.args ?? []), `--ignore-certificate-errors-spki-list=${tlsPin}`],
    },
    trace: "off",
  },
  outputDir: "work/production-smoke-results",
});
