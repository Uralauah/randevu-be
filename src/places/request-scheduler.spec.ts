import {
  RequestScheduler,
  SchedulerQueueTimeoutError,
} from './request-scheduler';

/** 밖에서 끝낼 수 있는 작업. 실행 중인 작업 수를 함께 센다. */
const createTaskTracker = () => {
  let active = 0;
  let maxActive = 0;
  const started: number[] = [];
  const finishers: Array<() => void> = [];

  const task = (id: number) => () =>
    new Promise<number>((resolve) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      started.push(id);
      finishers.push(() => {
        active -= 1;
        resolve(id);
      });
    });

  return {
    task,
    started,
    finishNext: () => finishers.shift()?.(),
    get active() {
      return active;
    },
    get maxActive() {
      return maxActive;
    },
  };
};

const flushMicrotasks = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

describe('RequestScheduler', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('동시에 실행되는 작업 수가 상한을 넘지 않는다', async () => {
    const scheduler = new RequestScheduler({
      maxConcurrency: 4,
      minIntervalMs: 0,
      maxQueueWaitMs: 10_000,
    });
    let active = 0;
    let maxActive = 0;

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        scheduler.schedule(async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, (i % 3) + 1));
          active -= 1;

          return i;
        }),
      ),
    );

    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(maxActive).toBe(4);
    expect(scheduler.activeCount).toBe(0);
  });

  it('작업이 끝난 순간 새 요청이 끼어들어도 상한을 넘지 않는다', async () => {
    const scheduler = new RequestScheduler({
      maxConcurrency: 4,
      minIntervalMs: 0,
      maxQueueWaitMs: 10_000,
    });
    const tracker = createTaskTracker();
    const pending = [0, 1, 2, 3, 4].map((id) =>
      scheduler.schedule(tracker.task(id)),
    );

    await flushMicrotasks();
    expect(tracker.active).toBe(4);
    expect(scheduler.queuedCount).toBe(1);

    // 하나가 끝나고, 대기자가 깨어나기 전 같은 tick에 새 요청이 들어온다.
    tracker.finishNext();
    await Promise.resolve();
    pending.push(scheduler.schedule(tracker.task(5)));
    await flushMicrotasks();

    expect(tracker.maxActive).toBe(4);
    // 먼저 기다리던 4번이 슬롯을 받고, 새로 온 5번은 줄을 선다.
    expect(tracker.started).toEqual([0, 1, 2, 3, 4]);

    for (let i = 0; i < 5; i++) {
      tracker.finishNext();
      await flushMicrotasks();
    }

    await Promise.all(pending);
    expect(tracker.maxActive).toBe(4);
    expect(scheduler.activeCount).toBe(0);
  });

  it('작업 시작 사이에 최소 간격을 두고, 쉬고 난 뒤 첫 작업은 바로 시작한다', async () => {
    jest.useFakeTimers({ now: 1_000 });
    const scheduler = new RequestScheduler({
      maxConcurrency: 4,
      minIntervalMs: 80,
      maxQueueWaitMs: 10_000,
    });
    const startedAt: number[] = [];
    const run = () =>
      scheduler.schedule(() => {
        startedAt.push(Date.now());

        return Promise.resolve();
      });

    const burst = Promise.all([run(), run(), run()]);
    await jest.advanceTimersByTimeAsync(1_000);
    await burst;

    expect(startedAt).toEqual([1_000, 1_080, 1_160]);

    // 충분히 쉰 뒤의 요청은 기다리지 않고, 그다음 요청은 정확히 간격만큼만 기다린다.
    startedAt.length = 0;
    const later = Promise.all([run(), run()]);
    await jest.advanceTimersByTimeAsync(1_000);
    await later;

    expect(startedAt).toEqual([2_000, 2_080]);
  });

  it('대기열에서 너무 오래 기다리면 포기하고, 다른 작업은 계속 진행한다', async () => {
    jest.useFakeTimers();
    const scheduler = new RequestScheduler({
      maxConcurrency: 1,
      minIntervalMs: 0,
      maxQueueWaitMs: 50,
    });
    const tracker = createTaskTracker();

    const first = scheduler.schedule(tracker.task(1));
    const second = scheduler.schedule(tracker.task(2));
    const secondResult = expect(second).rejects.toBeInstanceOf(
      SchedulerQueueTimeoutError,
    );

    await jest.advanceTimersByTimeAsync(60);
    await secondResult;
    expect(scheduler.queuedCount).toBe(0);

    const third = scheduler.schedule(tracker.task(3));
    tracker.finishNext();
    await jest.advanceTimersByTimeAsync(0);
    tracker.finishNext();

    await expect(first).resolves.toBe(1);
    await expect(third).resolves.toBe(3);
    expect(tracker.started).toEqual([1, 3]);
    expect(scheduler.activeCount).toBe(0);
  });

  it('작업이 실패해도 슬롯을 반납한다', async () => {
    const scheduler = new RequestScheduler({
      maxConcurrency: 1,
      minIntervalMs: 0,
      maxQueueWaitMs: 10_000,
    });

    await expect(
      scheduler.schedule(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    await expect(scheduler.schedule(() => Promise.resolve('ok'))).resolves.toBe(
      'ok',
    );
    expect(scheduler.activeCount).toBe(0);
  });
});
