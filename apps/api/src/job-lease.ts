export function watchJobLease(
  renew: () => Promise<boolean>,
  {
    intervalMs = 5000,
    budgetMs = 90000,
    startedAt = performance.now(),
  }: { intervalMs?: number; budgetMs?: number; startedAt?: number } = {},
): { signal: AbortSignal; abort(): void; stop(): void } {
  const controller = new AbortController();
  let deadline = startedAt + budgetMs;
  let stopped = false;
  let renewalTimer: ReturnType<typeof setTimeout> | undefined;
  let budgetTimer: ReturnType<typeof setTimeout> | undefined;

  function stop() {
    stopped = true;
    clearTimeout(renewalTimer);
    clearTimeout(budgetTimer);
    renewalTimer = undefined;
    budgetTimer = undefined;
  }

  function abort() {
    stop();
    controller.abort();
  }

  function armBudget() {
    clearTimeout(budgetTimer);
    const remaining = deadline - performance.now();
    if (remaining <= 0) abort();
    else budgetTimer = setTimeout(abort, Math.ceil(remaining));
  }

  function scheduleRenewal() {
    if (stopped) return;
    renewalTimer = setTimeout(() => {
      renewalTimer = undefined;
      void renewLease();
    }, intervalMs);
  }

  async function renewLease() {
    if (stopped) return;
    const requestedAt = performance.now();
    if (requestedAt >= deadline) {
      abort();
      return;
    }
    try {
      // The previous budget remains active while this request is outstanding.
      const owned = await renew();
      if (stopped) return;
      if (!owned || performance.now() >= deadline) {
        abort();
        return;
      }
      // A slow response must not grant execution time beyond its request's budget.
      deadline = requestedAt + budgetMs;
      armBudget();
      scheduleRenewal();
    } catch {
      if (!stopped) abort();
    }
  }

  armBudget();
  scheduleRenewal();
  return { signal: controller.signal, abort, stop };
}
