import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalendarEvent } from "../../../backend/domain/calendarTypes";
import {
  createReminderPoller,
  createReminderQueue,
  type ReminderFetchFn,
  type ReminderPollerDeps,
  type ReminderVisibilityTarget,
} from "../../../frontend/hooks/useInAppReminders";

function makeReminder(id: string): CalendarEvent {
  return {
    id,
    title: `Reminder ${id}`,
    startAt: "2026-06-01T10:00:00.000Z",
    endAt: "2026-06-01T11:00:00.000Z",
    reminderMinutesBefore: 30,
    reminderTriggered: true,
    source: "text",
    createdAt: "2026-05-31T12:00:00.000Z",
    updatedAt: "2026-05-31T12:00:00.000Z",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

class FakeScheduler {
  private nextId = 1;
  private callbacks = new Map<number, () => void>();
  clearCount = 0;

  readonly deps = {
    setIntervalFn: (callback: () => void) => {
      const id = this.nextId++;
      this.callbacks.set(id, callback);
      return id as unknown as ReturnType<typeof setInterval>;
    },
    clearIntervalFn: (id: ReturnType<typeof setInterval>) => {
      this.clearCount++;
      this.callbacks.delete(id as unknown as number);
    },
  };

  tick(): void {
    for (const callback of [...this.callbacks.values()]) callback();
  }

  activeCount(): number {
    return this.callbacks.size;
  }
}

class FakeVisibilityTarget implements ReminderVisibilityTarget {
  visibilityState = "hidden";
  private listeners = new Set<() => void>();
  addCount = 0;
  removeCount = 0;

  addEventListener(_type: "visibilitychange", listener: () => void): void {
    this.addCount++;
    this.listeners.add(listener);
  }

  removeEventListener(_type: "visibilitychange", listener: () => void): void {
    this.removeCount++;
    this.listeners.delete(listener);
  }

  dispatch(): void {
    for (const listener of [...this.listeners]) listener();
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

function pollerDeps(
  scheduler: FakeScheduler,
  visibilityTarget = new FakeVisibilityTarget(),
): ReminderPollerDeps {
  return {
    ...scheduler.deps,
    visibilityTarget,
  };
}

test("queue preserves order and deduplicates by id", () => {
  const queue = createReminderQueue();
  queue.enqueue([makeReminder("1"), makeReminder("2"), makeReminder("1")]);

  assert.equal(queue.peek()?.id, "1");
  assert.equal(queue.dequeue()?.id, "1");
  assert.equal(queue.dequeue()?.id, "2");
  assert.equal(queue.dequeue(), null);
});

test("poller requests immediately and on interval", async () => {
  const scheduler = new FakeScheduler();
  const controller = new AbortController();
  let calls = 0;
  const fetchFn: ReminderFetchFn = async () => {
    calls++;
    return { reminders: [] };
  };

  createReminderPoller({
    fetchFn,
    onReminders: () => {},
    intervalMs: 30_000,
    signal: controller.signal,
    deps: pollerDeps(scheduler),
  });
  await flushPromises();
  assert.equal(calls, 1);

  scheduler.tick();
  await flushPromises();
  assert.equal(calls, 2);
  controller.abort();
});

test("poller prevents overlap and resumes after the request settles", async () => {
  const scheduler = new FakeScheduler();
  const controller = new AbortController();
  const first = deferred<{ reminders: CalendarEvent[] }>();
  let calls = 0;
  const fetchFn: ReminderFetchFn = () => {
    calls++;
    return calls === 1 ? first.promise : Promise.resolve({ reminders: [] });
  };

  const poller = createReminderPoller({
    fetchFn,
    onReminders: () => {},
    intervalMs: 30_000,
    signal: controller.signal,
    deps: pollerDeps(scheduler),
  });

  scheduler.tick();
  await poller.poll();
  assert.equal(calls, 1);

  first.resolve({ reminders: [] });
  await flushPromises();
  await poller.poll();
  assert.equal(calls, 2);
  controller.abort();
});

test("poller reacts only when the page becomes visible", async () => {
  const scheduler = new FakeScheduler();
  const visibility = new FakeVisibilityTarget();
  const controller = new AbortController();
  let calls = 0;

  createReminderPoller({
    fetchFn: async () => {
      calls++;
      return { reminders: [] };
    },
    onReminders: () => {},
    intervalMs: 30_000,
    signal: controller.signal,
    deps: pollerDeps(scheduler, visibility),
  });
  await flushPromises();

  visibility.dispatch();
  await flushPromises();
  assert.equal(calls, 1);

  visibility.visibilityState = "visible";
  visibility.dispatch();
  await flushPromises();
  assert.equal(calls, 2);
  controller.abort();
});

test("abort clears resources and blocks requests and late delivery", async () => {
  const scheduler = new FakeScheduler();
  const visibility = new FakeVisibilityTarget();
  const controller = new AbortController();
  const pending = deferred<{ reminders: CalendarEvent[] }>();
  let calls = 0;
  let deliveries = 0;

  const poller = createReminderPoller({
    fetchFn: () => {
      calls++;
      return pending.promise;
    },
    onReminders: () => deliveries++,
    intervalMs: 30_000,
    signal: controller.signal,
    deps: pollerDeps(scheduler, visibility),
  });
  assert.equal(calls, 1);
  assert.equal(scheduler.activeCount(), 1);
  assert.equal(visibility.listenerCount(), 1);

  controller.abort();
  assert.equal(scheduler.activeCount(), 0);
  assert.equal(scheduler.clearCount, 1);
  assert.equal(visibility.listenerCount(), 0);
  assert.equal(visibility.removeCount, 1);

  scheduler.tick();
  visibility.visibilityState = "visible";
  visibility.dispatch();
  await poller.poll();
  assert.equal(calls, 1);

  pending.resolve({ reminders: [makeReminder("1")] });
  await flushPromises();
  assert.equal(deliveries, 0);
});

test("already-aborted poller allocates nothing and never requests", async () => {
  const scheduler = new FakeScheduler();
  const visibility = new FakeVisibilityTarget();
  const controller = new AbortController();
  controller.abort();
  let calls = 0;

  const poller = createReminderPoller({
    fetchFn: async () => {
      calls++;
      return { reminders: [] };
    },
    onReminders: () => {},
    intervalMs: 30_000,
    signal: controller.signal,
    deps: pollerDeps(scheduler, visibility),
  });
  await poller.poll();

  assert.equal(calls, 0);
  assert.equal(scheduler.activeCount(), 0);
  assert.equal(visibility.listenerCount(), 0);
});

test("poller retries after a fetch failure", async () => {
  const scheduler = new FakeScheduler();
  const controller = new AbortController();
  let calls = 0;

  createReminderPoller({
    fetchFn: async () => {
      calls++;
      if (calls === 1) throw new Error("network down");
      return { reminders: [] };
    },
    onReminders: () => {},
    intervalMs: 30_000,
    signal: controller.signal,
    deps: pollerDeps(scheduler),
  });
  await flushPromises();

  scheduler.tick();
  await flushPromises();
  assert.equal(calls, 2);
  controller.abort();
});

test("poller delivers fetched reminders", async () => {
  const scheduler = new FakeScheduler();
  const controller = new AbortController();
  const deliveries: string[][] = [];

  createReminderPoller({
    fetchFn: async () => ({ reminders: [makeReminder("1"), makeReminder("2")] }),
    onReminders: (reminders) => deliveries.push(reminders.map((event) => event.id)),
    intervalMs: 30_000,
    signal: controller.signal,
    deps: pollerDeps(scheduler),
  });
  await flushPromises();

  assert.deepEqual(deliveries, [["1", "2"]]);
  controller.abort();
});

test("Notification adapter safely degrades outside the browser", async () => {
  const notification = await import(
    "../../../frontend/infrastructure/notification/browserNotification"
  );

  assert.equal(notification.getNotificationPermission(), "denied");
  assert.equal(notification.isNotificationSupported(), false);
  notification.showBrowserNotification("test", "body");
  assert.equal(await notification.requestNotificationPermission(), "denied");
});

test("create preview includes configured reminder", async () => {
  const { buildCreateEventPreview } = await import(
    "../../../backend/infrastructure/agent/calendarWriteTools"
  );
  const preview = await buildCreateEventPreview(
    {
      title: "Review",
      startAt: "2026-06-01T09:00:00.000Z",
      endAt: "2026-06-01T10:00:00.000Z",
      reminderMinutesBefore: 30,
    },
    {
      list: async () => [],
      save: async (event) => event,
      update: async (event) => event,
      delete: async () => {},
      claimDueReminders: async () => [],
    },
  );

  assert.ok(
    preview.items.some(
      (item) => item.label === "提醒" && item.value === "提前 30 分钟",
    ),
  );
});

test("create preview shows unset reminder", async () => {
  const { buildCreateEventPreview } = await import(
    "../../../backend/infrastructure/agent/calendarWriteTools"
  );
  const preview = await buildCreateEventPreview(
    {
      title: "Review",
      startAt: "2026-06-01T09:00:00.000Z",
      endAt: "2026-06-01T10:00:00.000Z",
    },
    {
      list: async () => [],
      save: async (event) => event,
      update: async (event) => event,
      delete: async () => {},
      claimDueReminders: async () => [],
    },
  );

  assert.ok(
    preview.items.some(
      (item) => item.label === "提醒" && item.value === "未设置",
    ),
  );
});
