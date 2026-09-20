import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TtlLruCache } from '../common/ttl-lru-cache';
import { requestNaverSearch } from './naver-search-request';

export interface NaverBlogItem {
  title: string;
  link: string;
  description: string;
  bloggername: string;
  bloggerlink: string;
  postdate: string;
}

interface NaverBlogResponse {
  items: NaverBlogItem[];
}

/**
 * 같은 검색어 결과를 요청 사이에서 재사용한다. 최신 글 순(sort=date) 검색도 쓰므로
 * 장소 검색보다 짧게 둔다.
 */
const BLOG_QUERY_CACHE_TTL_MS = 30 * 60 * 1000;
const BLOG_QUERY_CACHE_MAX_ENTRIES = 2_000;

interface SearchBlogParams {
  query: string;
  display?: number;
  start?: number;
  sort?: 'sim' | 'date';
}

@Injectable()
export class NaverBlogClient {
  private readonly logger = new Logger(NaverBlogClient.name);
  private readonly baseUrl = 'https://openapi.naver.com/v1/search/blog.json';
  private readonly queryCache = new TtlLruCache<string, NaverBlogItem[]>({
    maxEntries: BLOG_QUERY_CACHE_MAX_ENTRIES,
    ttlMs: BLOG_QUERY_CACHE_TTL_MS,
  });

  constructor(private readonly configService: ConfigService) {}

  async searchBlogs(params: SearchBlogParams): Promise<NaverBlogItem[]> {
    const clientId = this.configService.get<string>('NAVER_CLIENT_ID');
    const clientSecret = this.configService.get<string>('NAVER_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException(
        'NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET이 설정되어 있지 않습니다.',
      );
    }

    const query = new URLSearchParams({
      query: params.query,
      display: String(params.display ?? 10),
      start: String(params.start ?? 1),
      sort: params.sort ?? 'sim',
    });

    const url = `${this.baseUrl}?${query.toString()}`;

    // 돌려준 배열은 여러 호출자가 함께 쓰므로 호출자는 고치지 말고 읽기만 해야 한다.
    return this.queryCache.getOrLoad(url, async () => {
      const data = await requestNaverSearch<NaverBlogResponse>({
        url,
        clientId,
        clientSecret,
        label: '블로그 검색',
        failureMessage: '장소 상세 정보를 불러오지 못했습니다.',
        logger: this.logger,
      });

      return data.items;
    });
  }
}
