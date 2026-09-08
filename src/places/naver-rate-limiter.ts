import { RequestScheduler } from './request-scheduler';

/**
 * 네이버 오픈 API 전역 호출 스케줄러.
 *
 * local·blog 클라이언트가 동일한 자격증명(QPS 버킷)을 공유하므로,
 * 프로세스 전체에서 동시 실행 수와 최소 호출 간격을 함께 제한해
 * 429(rate limit) 폭주와 그에 따른 재시도 backoff 지연을 막는다.
 *
 * 프로세스 메모리 기준이라 인스턴스를 여러 대로 늘리면 각자 따로 제한한다.
 * 그때는 Redis 같은 공유 저장소 기반의 토큰 버킷으로 옮겨야 한다.
 */
export const naverRequestScheduler = new RequestScheduler({
  maxConcurrency: 4,
  minIntervalMs: 80,
  // 이보다 오래 기다려야 한다면 이미 응답이 늦은 것이므로 실패시키고 부분 결과로 응답한다.
  maxQueueWaitMs: 10_000,
});

/**
 * 네이버 API 호출을 전역 동시성·간격 제한 하에 실행한다.
 */
export function scheduleNaverRequest<T>(task: () => Promise<T>): Promise<T> {
  return naverRequestScheduler.schedule(task);
}
