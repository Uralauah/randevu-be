import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TtlLruCache } from '../common/ttl-lru-cache';
import { requestNaverSearch } from './naver-search-request';

export interface NaverLocalItem {
  title: string;
  link: string;
  category: string;
  description: string;
  telephone: string;
  address: string;
  roadAddress: string;
  mapx: string;
  mapy: string;
}

interface NaverLocalResponse {
  items: NaverLocalItem[];
}

/**
 * 같은 검색어 결과를 요청·사용자·API 사이에서 재사용한다. 목록 API와 날짜 추천 API는
 * 같은 검색어를 쓰는 경우가 많고, 날짜 추천의 월 단위 검색어는 같은 달 안에서 겹친다.
 * 장소 정보는 자주 바뀌지 않으므로 목록 캐시와 같은 2시간을 둔다.
 */
const LOCAL_QUERY_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const LOCAL_QUERY_CACHE_MAX_ENTRIES = 3_000;

interface SearchLocalParams {
  query: string;
  display?: number;
  start?: number;
  sort?: 'random' | 'comment';
}

@Injectable()
export class NaverLocalClient {
  private readonly logger = new Logger(NaverLocalClient.name);
  private readonly baseUrl = 'https://openapi.naver.com/v1/search/local.json';
  private readonly queryCache = new TtlLruCache<string, NaverLocalItem[]>({
    maxEntries: LOCAL_QUERY_CACHE_MAX_ENTRIES,
    ttlMs: LOCAL_QUERY_CACHE_TTL_MS,
  });

  constructor(private readonly configService: ConfigService) {}

  async searchLocal(params: SearchLocalParams): Promise<NaverLocalItem[]> {
    const clientId = this.configService.get<string>('NAVER_CLIENT_ID');
    const clientSecret = this.configService.get<string>('NAVER_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException(
        'NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET이 설정되어 있지 않습니다.',
      );
    }

    const query = new URLSearchParams({
      query: params.query,
      display: String(params.display ?? 5),
      start: String(params.start ?? 1),
      sort: params.sort ?? 'comment',
    });

    const url = `${this.baseUrl}?${query.toString()}`;

    // 돌려준 배열은 여러 호출자가 함께 쓰므로 호출자는 고치지 말고 새 객체로 바꿔 써야 한다.
    return this.queryCache.getOrLoad(url, async () => {
      const data = await requestNaverSearch<NaverLocalResponse>({
        url,
        clientId,
        clientSecret,
        label: '지역 검색',
        failureMessage: '장소 추천을 불러오지 못했습니다.',
        logger: this.logger,
      });

      return data.items;
    });
  }
}
