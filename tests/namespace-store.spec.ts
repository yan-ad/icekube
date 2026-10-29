import { expect, test } from "@playwright/test";

test("session store deduplicates reads, ignores invalidated responses and clears revoked data", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves the source module for this isolated store fixture.
    const { createNamespaceStore } = await import("/src/app/cluster/namespaceStore.ts");
    type Request = import("../src/app/cluster/api").ResourceRequest;
    type ResourcePage = import("../src/app/cluster/api").ResourcePage;
    const reads: Request[] = [];
    const cancelled: Request[] = [];
    const waiters: ((names: string[]) => void)[] = [];
    const owner = createNamespaceStore({ clusterId: "fixture", sessionId: "session" }, {
      load: (request: Request) => {
        reads.push(request);
        return new Promise<ResourcePage>(resolve => waiters.push(names => resolve({ ...request,
          namespace: null, continueToken: null, truncated: false, fetchedAt: Date.now(), metrics: null,
          items: names.map(name => ({ name, namespace: null, status: "Active", createdAt: null, columns: {}, node: null })),
        })));
      },
      cancel: async (request: Request) => { cancelled.push(request); },
    });
    const releaseOwner = owner.retain();
    const state = owner.store.getState;
    state().setAccess({ decision: "allowed", loading: false, epoch: "one" });
    const unsubscribe = state().subscribeSelector();
    const releaseSecond = state().subscribeSelector();
    const deduplicated = reads.length;
    unsubscribe(); releaseSecond();
    const retainedWithoutConsumers = cancelled.length;
    const resubscribe = state().subscribeSelector();
    const reusedPending = reads.length;
    state().refresh();
    const replaced = { reads: reads.length, cancelled: [...cancelled] };
    waiters[1](["fresh"]);
    await new Promise(resolve => setTimeout(resolve, 0));
    waiters[0](["obsolete"]);
    await new Promise(resolve => setTimeout(resolve, 0));
    const afterStale = [...state().namespaces];
    state().setAccess({ decision: "allowed", loading: true, epoch: "one" });
    state().setAccess({ decision: "allowed", loading: false, epoch: "one" });
    const afterRenewal = reads.length;
    state().setAccess({ decision: "denied", loading: false, epoch: "one" });
    const denied = { names: [...state().namespaces], reads: reads.length };
    state().retry();
    const deniedRetryReads = reads.length;
    state().setAccess({ decision: "allowed", loading: false, epoch: "two" });
    const epochReads = reads.length;
    waiters[2](["new-identity"]);
    await new Promise(resolve => setTimeout(resolve, 0));
    const epochNames = [...state().namespaces];
    state().refresh();
    const retainedDuringRefresh = [...state().namespaces];
    const disposing = reads.at(-1)!;
    resubscribe(); releaseOwner();
    await new Promise(resolve => setTimeout(resolve, 0));
    waiters[3](["after-disposal"]);
    await new Promise(resolve => setTimeout(resolve, 0));
    return { deduplicated, retainedWithoutConsumers, reusedPending, replaced,
      afterStale, afterRenewal, denied, deniedRetryReads, epochReads, epochNames, retainedDuringRefresh,
      cancelledDisposed: cancelled.some(request => request.readId === disposing.readId),
      disposedNames: state().namespaces, allScopes: reads.every(request => request.clusterId === "fixture" && request.sessionId === "session"),
    };
  });
  expect(result.deduplicated).toBe(1);
  expect(result.retainedWithoutConsumers).toBe(0);
  expect(result.reusedPending).toBe(1);
  expect(result.replaced.reads).toBe(2);
  expect(result.replaced.cancelled).toHaveLength(1);
  expect(result.afterStale).toEqual(["fresh"]);
  expect(result.afterRenewal).toBe(2);
  expect(result.denied).toEqual({ names: [], reads: 2 });
  expect(result.deniedRetryReads).toBe(2);
  expect(result.epochReads).toBe(3);
  expect(result.epochNames).toEqual(["new-identity"]);
  expect(result.retainedDuringRefresh).toEqual(["new-identity"]);
  expect(result.cancelledDisposed).toBe(true);
  expect(result.disposedNames).toEqual([]);
  expect(result.allScopes).toBe(true);
});

test("Strict Mode release/reacquire retains the pending read; separate sessions never share state", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves the source module for this isolated store fixture.
    const { createNamespaceStore } = await import("/src/app/cluster/namespaceStore.ts");
    type Request = import("../src/app/cluster/api").ResourceRequest;
    const reads: Request[] = [], cancelled: Request[] = [];
    const dependencies = { load: (request: Request) => { reads.push(request); return new Promise(() => {}); },
      cancel: async (request: Request) => { cancelled.push(request); } };
    const owner = createNamespaceStore({ clusterId: "one", sessionId: "old" }, dependencies);
    const release = owner.retain();
    owner.store.getState().setAccess({ decision: "allowed", loading: false, epoch: "epoch" });
    const unsubscribe = owner.store.getState().subscribeSelector();
    unsubscribe(); release();
    const releaseAgain = owner.retain();
    const unsubscribeAgain = owner.store.getState().subscribeSelector();
    await new Promise(resolve => setTimeout(resolve, 0));
    const strict = { reads: reads.length, cancelled: cancelled.length };
    const other = createNamespaceStore({ clusterId: "one", sessionId: "new" }, dependencies);
    const releaseOther = other.retain();
    other.store.getState().setAccess({ decision: "allowed", loading: false, epoch: "epoch-new" });
    const unsubscribeOther = other.store.getState().subscribeSelector();
    const independent = { scopes: reads.map(request => request.sessionId), shared: owner.store === other.store };
    unsubscribeAgain(); releaseAgain(); unsubscribeOther(); releaseOther();
    await new Promise(resolve => setTimeout(resolve, 0));
    return { strict, independent, cancelled: cancelled.length };
  });
  expect(result.strict).toEqual({ reads: 1, cancelled: 0 });
  expect(result.independent).toEqual({ scopes: ["old", "new"], shared: false });
  expect(result.cancelled).toBe(2);
});
