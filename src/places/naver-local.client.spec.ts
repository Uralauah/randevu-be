import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NaverLocalClient } from './naver-local.client';
import { requestNaverSearch } from './naver-search-request';

jest.mock('./naver-search-request', () => ({
  requestNaverSearch: jest.fn(),
}));

const requestNaverSearchMock = requestNaverSearch as jest.MockedFunction<
  typeof requestNaverSearch
>;

describe('NaverLocalClient - 검색어 캐시', () => {
  let client: NaverLocalClient;

  beforeEach(() => {
    requestNaverSearchMock.mockReset();
    requestNaverSearchMock.mockResolvedValue({ items: [] });
    client = new NaverLocalClient({
      get: (key: string) =>
        ({ NAVER_CLIENT_ID: 'id', NAVER_CLIENT_SECRET: 'secret' })[key],
    } as unknown as ConfigService);
  });

  it('같은 검색어는 한 번만 호출하고 결과를 재사용한다', async () => {
    await client.searchLocal({ query: '2026년 9월 성수 팝업스토어' });
    await client.searchLocal({ query: '2026년 9월 성수 팝업스토어' });

    expect(requestNaverSearchMock).toHaveBeenCalledTimes(1);
  });

  it('검색어나 옵션이 다르면 따로 호출한다', async () => {
    await client.searchLocal({ query: '성수 카페' });
    await client.searchLocal({ query: '성수 카페', display: 20 });
    await client.searchLocal({ query: '성수 맛집' });

    expect(requestNaverSearchMock).toHaveBeenCalledTimes(3);
  });

  it('실패한 호출은 캐시하지 않는다', async () => {
    requestNaverSearchMock
      .mockRejectedValueOnce(new InternalServerErrorException())
      .mockResolvedValueOnce({ items: [] });

    await expect(client.searchLocal({ query: '성수 카페' })).rejects.toThrow(
      InternalServerErrorException,
    );
    await expect(client.searchLocal({ query: '성수 카페' })).resolves.toEqual(
      [],
    );
    expect(requestNaverSearchMock).toHaveBeenCalledTimes(2);
  });
});
