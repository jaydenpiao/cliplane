import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { watchJobLease } from "../apps/api/src/job-lease";

function deferredRenewal() {
  let resolve!: (owned: boolean) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<boolean>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
});

afterEach(() => {
  vi.useRealTimers();
});

it("uses five-second renewals and aborts a stalled renewal within the initial ownership budget", async () => {
  const pending = deferredRenewal();
  const requests: number[] = [];
  const watcher = watchJobLease(() => {
    requests.push(performance.now());
    return pending.promise;
  });

  await vi.advanceTimersByTimeAsync(4999);
  expect(requests).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(requests).toEqual([5000]);
  await vi.advanceTimersByTimeAsync(84999);
  expect(watcher.signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(watcher.signal.aborted).toBe(true);
  expect(requests).toEqual([5000]);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["lost", "failed"])("aborts and clears timers when renewal is %s", async (result) => {
  const watcher = watchJobLease(
    () => (result === "lost" ? Promise.resolve(false) : Promise.reject(new Error("database unavailable"))),
    { intervalMs: 10, budgetMs: 100 },
  );

  await vi.advanceTimersByTimeAsync(10);
  expect(watcher.signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("serializes renewals even when one request lasts longer than the polling interval", async () => {
  const pending = deferredRenewal();
  const requests: number[] = [];
  const watcher = watchJobLease(
    () => {
      requests.push(performance.now());
      return requests.length === 1 ? pending.promise : Promise.resolve(true);
    },
    { intervalMs: 10, budgetMs: 100 },
  );

  await vi.advanceTimersByTimeAsync(35);
  expect(requests).toEqual([10]);
  pending.resolve(true);
  await vi.advanceTimersByTimeAsync(9);
  expect(requests).toEqual([10]);
  await vi.advanceTimersByTimeAsync(1);
  expect(requests).toEqual([10, 45]);
  expect(watcher.signal.aborted).toBe(false);
  watcher.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("dates renewed ownership from the request start, even after a slow successful response", async () => {
  const pending = deferredRenewal();
  const requests: number[] = [];
  const watcher = watchJobLease(
    () => {
      requests.push(performance.now());
      return requests.length === 1 ? pending.promise : new Promise<boolean>(() => {});
    },
    { intervalMs: 20, budgetMs: 100 },
  );

  await vi.advanceTimersByTimeAsync(90);
  expect(requests).toEqual([20]);
  pending.resolve(true);
  await vi.advanceTimersByTimeAsync(29);
  expect(requests).toEqual([20, 110]);
  expect(watcher.signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(watcher.signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("does not revive or reschedule an expired watcher after a late successful renewal", async () => {
  const pending = deferredRenewal();
  let requests = 0;
  const watcher = watchJobLease(
    () => {
      requests += 1;
      return pending.promise;
    },
    { intervalMs: 10, budgetMs: 30 },
  );

  await vi.advanceTimersByTimeAsync(30);
  expect(watcher.signal.aborted).toBe(true);
  pending.resolve(true);
  await vi.advanceTimersByTimeAsync(100);
  expect(requests).toBe(1);
  expect(watcher.signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["succeeds", "fails"])("stays stopped when an outstanding renewal later %s", async (result) => {
  const pending = deferredRenewal();
  let requests = 0;
  const watcher = watchJobLease(
    () => {
      requests += 1;
      return pending.promise;
    },
    { intervalMs: 10, budgetMs: 30 },
  );

  await vi.advanceTimersByTimeAsync(10);
  expect(requests).toBe(1);
  watcher.stop();
  expect(vi.getTimerCount()).toBe(0);
  if (result === "succeeds") pending.resolve(true);
  else pending.reject(new Error("database unavailable"));
  await vi.advanceTimersByTimeAsync(100);
  expect(requests).toBe(1);
  expect(watcher.signal.aborted).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it("stops before the first renewal without aborting a successful job", async () => {
  let requests = 0;
  const watcher = watchJobLease(
    async () => {
      requests += 1;
      return true;
    },
    { intervalMs: 10, budgetMs: 30 },
  );

  watcher.stop();
  watcher.stop();
  await vi.advanceTimersByTimeAsync(100);
  expect(requests).toBe(0);
  expect(watcher.signal.aborted).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it("aborts explicitly and prevents further renewals", async () => {
  let requests = 0;
  const watcher = watchJobLease(
    async () => {
      requests += 1;
      return true;
    },
    { intervalMs: 10, budgetMs: 30 },
  );

  watcher.abort();
  watcher.abort();
  watcher.stop();
  await vi.advanceTimersByTimeAsync(100);
  expect(requests).toBe(0);
  expect(watcher.signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("aborts immediately when the claim already exhausted its ownership budget", async () => {
  let requests = 0;
  const watcher = watchJobLease(
    async () => {
      requests += 1;
      return true;
    },
    { intervalMs: 10, budgetMs: 100, startedAt: -100 },
  );

  expect(watcher.signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(100);
  expect(requests).toBe(0);
});

it("includes time spent claiming the job in the initial ownership budget", async () => {
  const watcher = watchJobLease(() => new Promise<boolean>(() => {}), {
    intervalMs: 10,
    budgetMs: 100,
    startedAt: -80,
  });

  await vi.advanceTimersByTimeAsync(19);
  expect(watcher.signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(watcher.signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
