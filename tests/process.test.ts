import { getEventListeners } from "node:events";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { cancelMediaProcesses, runJsonProcess } from "../apps/api/src/worker-process";

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

it("does not launch a media process when its signal is already aborted", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cliplane-aborted-"));
  const marker = path.join(root, "started");
  const controller = new AbortController();
  controller.abort(new Error("Private cancellation detail"));
  try {
    await expect(
      runJsonProcess(
        "python3",
        ["-c", "import sys;open(sys.argv[1],'w').write('started');print('{}')", marker],
        {},
        3000,
        4096,
        controller.signal,
      ),
    ).rejects.toThrow("Media job cancelled");
    await expect(access(marker)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("kills an active encoder descendant when the owning job is cancelled", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cliplane-cancelled-"));
  const marker = path.join(root, "pid.txt");
  const controller = new AbortController();
  try {
    const execution = runJsonProcess(
      "python3",
      [
        "-c",
        "import subprocess,sys,time\np=subprocess.Popen(['ffmpeg','-v','error','-re','-threads','1','-filter_threads','1','-f','lavfi','-i','color=s=32x32:r=1','-t','60','-f','null','-'])\nopen(sys.argv[1],'w').write(str(p.pid))\ntime.sleep(60)",
        marker,
      ],
      {},
      3000,
      4096,
      controller.signal,
    );
    const rejected = expect(execution).rejects.toThrow("Media job cancelled");
    await expect.poll(() => readFile(marker, "utf8")).toMatch(/^\d+$/);
    controller.abort();
    await rejected;
    const pid = Number(await readFile(marker, "utf8"));
    let state = "gone";
    try {
      state = (await readFile(`/proc/${pid}/stat`, "utf8")).split(") ")[1].split(" ")[0];
    } catch {}
    expect(["gone", "Z", "X"]).toContain(state);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  } finally {
    controller.abort();
    cancelMediaProcesses();
    await rm(root, { recursive: true, force: true });
  }
});

it("removes its abort listener after a successful worker response", async () => {
  const controller = new AbortController();
  expect(
    await runJsonProcess("python3", ["-c", "print('{\"ok\":true}')"], {}, 3000, 4096, controller.signal),
  ).toEqual({ ok: true });
  expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  controller.abort();
});
