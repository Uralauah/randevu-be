import { TtlLruCache } from './ttl-lru-cache';

describe('TtlLruCache', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('TTL이 지난 항목은 돌려주지 않고 지운다', () => {
    jest.useFakeTimers({ now: 0 });
    const cache = new TtlLruCache<string, number>({
      maxEntries: 10,
      ttlMs: 1_000,
    });

    cache.set('a', 1);
    jest.setSystemTime(999);
    expect(cache.get('a')).toBe(1);

    jest.setSystemTime(1_000);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('상한을 넘으면 가장 오래 쓰지 않은 항목부터 버린다', () => {
    const cache = new TtlLruCache<string, number>({
      maxEntries: 2,
      ttlMs: 60_000,
    });

    cache.set('a', 1);
    cache.set('b', 2);
    // a를 읽어 최근 사용으로 만든 뒤 c를 넣으면 b가 밀려난다.
    cache.get('a');
    cache.set('c', 3);

    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  it('같은 키를 동시에 요청하면 로딩을 한 번만 실행한다', async () => {
    const cache = new TtlLruCache<string, number>({
      maxEntries: 10,
      ttlMs: 60_000,
    });
    let resolveLoad!: (value: number) => void;
    const load = jest.fn(
      () => new Promise<number>((resolve) => (resolveLoad = resolve)),
    );

    const requests = Array.from({ length: 10 }, () =>
      cache.getOrLoad('station:1', load),
    );
    resolveLoad(42);

    await expect(Promise.all(requests)).resolves.toEqual(Array(10).fill(42));
    expect(load).toHaveBeenCalledTimes(1);
    await expect(cache.getOrLoad('station:1', load)).resolves.toBe(42);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('로딩이 실패하면 캐시에 남기지 않고 다음 요청에서 다시 시도한다', async () => {
    const cache = new TtlLruCache<string, number>({
      maxEntries: 10,
      ttlMs: 60_000,
    });
    const load = jest
      .fn<Promise<number>, []>()
      .mockRejectedValueOnce(new Error('upstream down'))
      .mockResolvedValueOnce(7);

    await expect(cache.getOrLoad('k', load)).rejects.toThrow('upstream down');
    await expect(cache.getOrLoad('k', load)).resolves.toBe(7);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
