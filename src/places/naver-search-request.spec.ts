import { InternalServerErrorException, Logger } from '@nestjs/common';
import {
  getRetryDelayMs,
  NaverSearchRequest,
  requestNaverSearch,
} from './naver-search-request';

// 전역 스케줄러의 간격·상태와 분리해서 재시도 로직만 본다.
jest.mock('./naver-rate-limiter', () => ({
  scheduleNaverRequest: <T>(task: () => Promise<T>) => task(),
}));

const jsonResponse = (status: number, body: unknown, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const createRequest = (): NaverSearchRequest => ({
  url: 'https://openapi.naver.com/v1/search/local.json?query=test',
  clientId: 'id',
  clientSecret: 'secret',
  label: '지역 검색',
  failureMessage: '장소 추천을 불러오지 못했습니다.',
  logger: { warn: jest.fn(), error: jest.fn() } as unknown as Logger,
});

describe('requestNaverSearch', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('요청마다 타임아웃 signal을 붙인다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { items: [] }));

    await expect(requestNaverSearch(createRequest())).resolves.toEqual({
      items: [],
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('429면 Retry-After만큼 기다렸다가 다시 호출한다', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, {}, { 'retry-after': '1' }))
      .mockResolvedValueOnce(jsonResponse(200, { items: [1] }));

    const result = requestNaverSearch(createRequest());

    await jest.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ items: [1] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('429가 계속되면 정해진 횟수만 재시도하고 실패시킨다', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(429, {})));

    const result = requestNaverSearch(createRequest());
    const assertion = expect(result).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );

    await jest.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('응답이 없어 타임아웃되면 재시도하지 않고 바로 실패시킨다', async () => {
    fetchMock.mockRejectedValueOnce(
      new DOMException('The operation was aborted', 'TimeoutError'),
    );

    await expect(requestNaverSearch(createRequest())).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('getRetryDelayMs', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('Retry-After가 초 단위면 그대로 따른다', () => {
    expect(getRetryDelayMs('2', 0)).toBe(2_000);
  });

  it('Retry-After가 너무 길면 기다리지 않는다', () => {
    expect(getRetryDelayMs('30', 0)).toBeNull();
  });

  it('Retry-After가 없으면 지수 백오프 구간 안에서 흩뜨린다', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    expect(getRetryDelayMs(null, 0)).toBe(200);
    expect(getRetryDelayMs(null, 1)).toBe(400);

    jest.spyOn(Math, 'random').mockReturnValue(0.999);
    expect(getRetryDelayMs(null, 0)).toBeLessThanOrEqual(400);
    expect(getRetryDelayMs(null, 1)).toBeLessThanOrEqual(800);
  });
});
