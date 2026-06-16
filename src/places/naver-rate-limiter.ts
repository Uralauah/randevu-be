/**
 * 네이버 오픈 API 전역 호출 스케줄러.
 *
 * local·blog 클라이언트가 동일한 자격증명(QPS 버킷)을 공유하므로,
 * 프로세스 전체에서 동시 실행 수와 최소 호출 간격을 함께 제한해
 * 429(rate limit) 폭주와 그에 따른 재시도 backoff 지연을 막는다.
 */

const MAX_CONCURRENCY = 4;
const MIN_INTERVAL_MS = 80;

let active = 0;
let lastDispatchAt = 0;
const waiters: Array<() => void> = [];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireSlot(): Promise<void> {
  if (active >= MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }

  active += 1;

  // 직전 디스패치와 최소 간격을 보장해 순간 burst를 평탄화한다.
  const now = Date.now();
  const wait = Math.max(0, lastDispatchAt + MIN_INTERVAL_MS - now);
  lastDispatchAt = Math.max(now, lastDispatchAt) + MIN_INTERVAL_MS;

  if (wait > 0) {
    await delay(wait);
  }
}

function releaseSlot(): void {
  active -= 1;
  const next = waiters.shift();

  if (next) {
    next();
  }
}

/**
 * 네이버 API 호출을 전역 동시성·간격 제한 하에 실행한다.
 */
export async function scheduleNaverRequest<T>(
  task: () => Promise<T>,
): Promise<T> {
  await acquireSlot();

  try {
    return await task();
  } finally {
    releaseSlot();
  }
}
