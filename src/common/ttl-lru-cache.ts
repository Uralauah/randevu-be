interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export interface TtlLruCacheOptions {
  /** 담아 둘 최대 항목 수. 넘으면 가장 오래 쓰지 않은 항목부터 버린다. */
  maxEntries: number;
  /** 항목의 유효 시간(ms) */
  ttlMs: number;
}

/**
 * 크기 상한과 TTL이 있는 인메모리 캐시.
 *
 * - Map은 삽입 순서를 유지하므로, 조회할 때마다 항목을 맨 뒤로 다시 넣으면 맨 앞이
 *   가장 오래 쓰지 않은 항목이 된다(LRU). 상한을 넘으면 맨 앞부터 버린다.
 * - getOrLoad는 같은 키를 동시에 채우려는 요청들이 진행 중인 로딩 하나를 함께
 *   기다리게 한다(singleflight). 캐시가 비는 순간 외부 API가 요청 수만큼 불리는 것을 막는다.
 * - 실패한 로딩은 캐시에 남기지 않는다.
 */
export class TtlLruCache<K, V> {
  private readonly entries = new Map<K, CacheEntry<V>>();
  private readonly inflight = new Map<K, Promise<V>>();

  constructor(private readonly options: TtlLruCacheOptions) {}

  get size() {
    return this.entries.size;
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);

    if (!entry) {
      return undefined;
    }

    this.entries.delete(key);

    if (Date.now() >= entry.expiresAt) {
      return undefined;
    }

    this.entries.set(key, entry);

    return entry.value;
  }

  set(key: K, value: V) {
    this.entries.delete(key);
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + this.options.ttlMs,
    });

    while (this.entries.size > this.options.maxEntries) {
      const oldestKey = this.entries.keys().next().value as K;

      this.entries.delete(oldestKey);
    }
  }

  async getOrLoad(key: K, load: () => Promise<V>): Promise<V> {
    const cached = this.get(key);

    if (cached !== undefined) {
      return cached;
    }

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
}
