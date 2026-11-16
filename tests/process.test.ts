import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { runJsonProcess } from "../apps/api/src/worker-process";

it("kills the media process group, including an active encoder, on timeout", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cliplane-process-"));
  try {
    const script = path.join(root, "sleep.py"),
      marker = path.join(root, "pid.txt");
    await writeFile(
      script,
      "import subprocess,sys,time\np=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'])\nopen(sys.argv[1],'w').write(str(p.pid))\ntime.sleep(60)\n",
    );
    await expect(runJsonProcess("python3", [script, marker], {}, 500)).rejects.toThrow("timed out");
    const pid = Number(await readFile(marker, "utf8"));
    let state = "gone";
    try {
      state = (await readFile(`/proc/${pid}/stat`, "utf8")).split(") ")[1].split(" ")[0];
    } catch {}
    expect(["gone", "Z", "X"]).toContain(state);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects oversized worker output without parsing it", async () => {
  await expect(runJsonProcess("python3", ["-c", "print('x'*50000)"], {}, 3000, 4096)).rejects.toThrow(
    "output limit",
  );
});
