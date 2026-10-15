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

  describe('stale-while-revalidate', () => {
    const createStaleCache = (onBackgroundRefreshError?: jest.Mock) =>
      new TtlLruCache<string, number>({
        maxEntries: 10,
        ttlMs: 1_000,
        staleTtlMs: 60_000,
        onBackgroundRefreshError,
      });

    const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

    it('유효 시간이 지나면 이전 값을 바로 주고, 뒤에서 한 번만 다시 불러온다', async () => {
      jest.useFakeTimers({ now: 0, doNotFake: ['setImmediate'] });
      const cache = createStaleCache();
      let resolveRefresh!: (value: number) => void;
      const load = jest
        .fn<Promise<number>, []>()
        .mockResolvedValueOnce(1)
        .mockImplementationOnce(
          () => new Promise<number>((resolve) => (resolveRefresh = resolve)),
        );

      await expect(cache.getOrLoad('k', load)).resolves.toBe(1);

      jest.setSystemTime(1_500);
      // 갱신이 끝나기 전 요청들은 기다리지 않고 이전 값을 받고, 갱신은 한 번만 일어난다.
      await expect(cache.getOrLoad('k', load)).resolves.toBe(1);
      await expect(cache.getOrLoad('k', load)).resolves.toBe(1);
      expect(load).toHaveBeenCalledTimes(2);

      resolveRefresh(2);
      await flushPromises();

      await expect(cache.getOrLoad('k', load)).resolves.toBe(2);
      expect(load).toHaveBeenCalledTimes(2);
    });

    it('허용 범위까지 지나면 이전 값을 버리고 새로 불러올 때까지 기다린다', async () => {
      jest.useFakeTimers({ now: 0 });
      const cache = createStaleCache();
      const load = jest
        .fn<Promise<number>, []>()
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2);

      await cache.getOrLoad('k', load);
      jest.setSystemTime(61_000);

      await expect(cache.getOrLoad('k', load)).resolves.toBe(2);
      expect(load).toHaveBeenCalledTimes(2);
    });

    it('뒤에서 하는 갱신이 실패하면 이전 값을 유지하고, 잠시 뒤에 다시 시도한다', async () => {
      jest.useFakeTimers({ now: 0, doNotFake: ['setImmediate'] });
      const onError = jest.fn();
      const cache = createStaleCache(onError);
      const load = jest
        .fn<Promise<number>, []>()
        .mockResolvedValueOnce(1)
        .mockRejectedValueOnce(new Error('upstream down'))
        .mockResolvedValueOnce(3);

      await cache.getOrLoad('k', load);
      jest.setSystemTime(1_500);

      await expect(cache.getOrLoad('k', load)).resolves.toBe(1);
      await flushPromises();
      expect(onError).toHaveBeenCalledWith('k', expect.any(Error));

      // 실패 직후에는 요청마다 다시 부르지 않는다.
      await expect(cache.getOrLoad('k', load)).resolves.toBe(1);
      expect(load).toHaveBeenCalledTimes(2);

      jest.setSystemTime(1_500 + 30_000);
      await expect(cache.getOrLoad('k', load)).resolves.toBe(1);
      await flushPromises();
      expect(load).toHaveBeenCalledTimes(3);
      await expect(cache.getOrLoad('k', load)).resolves.toBe(3);
    });

    it('허용 범위를 주지 않으면 유효 시간이 지난 값은 쓰지 않는다', async () => {
      jest.useFakeTimers({ now: 0 });
      const cache = new TtlLruCache<string, number>({
        maxEntries: 10,
        ttlMs: 1_000,
      });
      const load = jest
        .fn<Promise<number>, []>()
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2);

      await cache.getOrLoad('k', load);
      jest.setSystemTime(1_000);

      await expect(cache.getOrLoad('k', load)).resolves.toBe(2);
    });
  });
});
