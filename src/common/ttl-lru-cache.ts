interface CacheEntry<V> {
  value: V;
  /** 이 시각까지는 그대로 쓴다. */
  expiresAt: number;
  /** 이 시각까지는 이전 값을 주면서 뒤에서 갱신할 수 있다. 지나면 버린다. */
  staleUntil: number;
  /** 뒤에서 하는 갱신이 실패했을 때 다음 시도를 미루는 시각 */
  nextRefreshAt: number;
}

export interface TtlLruCacheOptions<K = unknown> {
  /** 담아 둘 최대 항목 수. 넘으면 가장 오래 쓰지 않은 항목부터 버린다. */
  maxEntries: number;
  /** 항목의 유효 시간(ms) */
  ttlMs: number;
  /**
   * 유효 시간이 지난 뒤에도 이전 값을 줄 수 있는 시간(ms). 이 동안 getOrLoad는 이전 값을 바로
   * 돌려주고 뒤에서 한 번만 다시 불러온다(stale-while-revalidate). 기본 0(쓰지 않음).
   */
  staleTtlMs?: number;
  /** 뒤에서 하는 갱신이 실패했을 때 호출된다. 이전 값은 그대로 남는다. */
  onBackgroundRefreshError?: (key: K, error: unknown) => void;
}

/** 뒤에서 하는 갱신이 실패하면 이만큼은 다시 시도하지 않는다(장애 중인 상대를 요청마다 두드리지 않게). */
const BACKGROUND_REFRESH_RETRY_DELAY_MS = 30_000;

/**
 * 크기 상한과 TTL이 있는 인메모리 캐시.
 *
 * - Map은 삽입 순서를 유지하므로, 조회할 때마다 항목을 맨 뒤로 다시 넣으면 맨 앞이
 *   가장 오래 쓰지 않은 항목이 된다(LRU). 상한을 넘으면 맨 앞부터 버린다.
 * - getOrLoad는 같은 키를 동시에 채우려는 요청들이 진행 중인 로딩 하나를 함께
 *   기다리게 한다(singleflight). 캐시가 비는 순간 외부 API가 요청 수만큼 불리는 것을 막는다.
 * - staleTtlMs를 주면 유효 시간이 지난 직후의 요청도 기다리지 않는다(stale-while-revalidate).
 * - 실패한 로딩은 캐시에 남기지 않는다.
 */
export class TtlLruCache<K, V> {
  private readonly entries = new Map<K, CacheEntry<V>>();
  private readonly inflight = new Map<K, Promise<V>>();

  constructor(private readonly options: TtlLruCacheOptions<K>) {}

  get size() {
    return this.entries.size;
  }

  /** 유효 시간 안의 값만 돌려준다. */
  get(key: K): V | undefined {
    const entry = this.lookup(key);

    return entry && Date.now() < entry.expiresAt ? entry.value : undefined;
  }

  set(key: K, value: V) {
    const now = Date.now();
    const expiresAt = now + this.options.ttlMs;

    this.entries.delete(key);
    this.entries.set(key, {
      value,
      expiresAt,
      staleUntil: expiresAt + (this.options.staleTtlMs ?? 0),
      nextRefreshAt: 0,
    });

    while (this.entries.size > this.options.maxEntries) {
      const oldestKey = this.entries.keys().next().value as K;

      this.entries.delete(oldestKey);
    }
  }

  delete(key: K) {
    this.entries.delete(key);
  }

  async getOrLoad(key: K, load: () => Promise<V>): Promise<V> {
    const entry = this.lookup(key);

    if (entry) {
      const now = Date.now();

      if (now >= entry.expiresAt && now >= entry.nextRefreshAt) {
        this.refreshInBackground(key, load);
      }

      return entry.value;
    }

    return this.loadOnce(key, load);
  }

  /** 버릴 시각이 지난 항목은 지우고, 남은 항목은 최근 사용으로 옮긴다. */
  private lookup(key: K): CacheEntry<V> | undefined {
    const entry = this.entries.get(key);

    if (!entry) {
      return undefined;
    }

    this.entries.delete(key);

    if (Date.now() >= entry.staleUntil) {
      return undefined;
    }

    this.entries.set(key, entry);

    return entry;
  }

  private loadOnce(key: K, load: () => Promise<V>): Promise<V> {
    const running = this.inflight.get(key);

    if (running) {
      return running;
    }

    const loading = load()
      .then((value) => {
        this.set(key, value);

        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, loading);

    return loading;
  }

  private refreshInBackground(key: K, load: () => Promise<V>) {
    if (this.inflight.has(key)) {
      return;
    }

    this.loadOnce(key, load).catch((error: unknown) => {
      const entry = this.entries.get(key);

      if (entry) {
        entry.nextRefreshAt = Date.now() + BACKGROUND_REFRESH_RETRY_DELAY_MS;
      }

      this.options.onBackgroundRefreshError?.(key, error);
    });
  }
}
