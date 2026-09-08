export interface RequestSchedulerOptions {
  /** 동시에 실행할 수 있는 작업 수 */
  maxConcurrency: number;
  /** 작업 시작 사이의 최소 간격(ms) */
  minIntervalMs: number;
  /** 대기열에서 이 시간보다 오래 기다리면 포기한다(ms) */
  maxQueueWaitMs: number;
}

export class SchedulerQueueTimeoutError extends Error {
  constructor(waitedMs: number) {
    super(`외부 API 호출 대기열에서 ${waitedMs}ms를 넘게 기다려 포기했습니다.`);
    this.name = 'SchedulerQueueTimeoutError';
  }
}

interface Waiter {
  grant: () => void;
  timer: NodeJS.Timeout;
}

/**
 * 외부 API 호출의 동시 실행 수와 시작 간격을 함께 제한하는 FIFO 스케줄러.
 *
 * - 작업이 끝나면 슬롯을 반납하지 않고 대기 중인 작업에 그대로 넘긴다. 카운터를 먼저 줄이고
 *   대기자를 깨우면, 대기자가 실제로 실행되기 전(다음 microtask)에 새 요청이 빈 슬롯을
 *   가로채 동시 실행 수가 상한을 넘는다.
 * - 다음 작업이 시작할 수 있는 시각을 예약해 두고 순서대로 밀어 최소 간격을 지킨다.
 * - 대기열이 길어지면 무한정 기다리지 않고 maxQueueWaitMs 뒤에 실패시킨다.
 */
export class RequestScheduler {
  private active = 0;
  private nextDispatchAt = 0;
  private readonly waiters: Waiter[] = [];

  constructor(private readonly options: RequestSchedulerOptions) {}

  get activeCount() {
    return this.active;
  }

  get queuedCount() {
    return this.waiters.length;
  }

  async schedule<T>(task: () => Promise<T>): Promise<T> {
    await this.acquireSlot();

    try {
      await this.waitForDispatchTime();

      return await task();
    } finally {
      this.releaseSlot();
    }
  }

  private acquireSlot(): Promise<void> {
    if (this.active < this.options.maxConcurrency) {
      this.active += 1;

      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        grant: () => {
          clearTimeout(waiter.timer);
          resolve();
        },
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);

          if (index !== -1) {
            this.waiters.splice(index, 1);
          }

          reject(new SchedulerQueueTimeoutError(this.options.maxQueueWaitMs));
        }, this.options.maxQueueWaitMs),
      };

      waiter.timer.unref?.();
      this.waiters.push(waiter);
    });
  }

  private releaseSlot() {
    const next = this.waiters.shift();

    if (next) {
      // active는 그대로 두고 슬롯을 대기자에게 넘긴다.
      next.grant();

      return;
    }

    this.active -= 1;
  }

  private async waitForDispatchTime() {
    const now = Date.now();
    const dispatchAt = Math.max(now, this.nextDispatchAt);

    this.nextDispatchAt = dispatchAt + this.options.minIntervalMs;

    if (dispatchAt > now) {
      await new Promise((resolve) => setTimeout(resolve, dispatchAt - now));
    }
  }
}
