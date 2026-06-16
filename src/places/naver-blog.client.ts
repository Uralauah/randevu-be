import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { scheduleNaverRequest } from './naver-rate-limiter';

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

interface SearchBlogParams {
  query: string;
  display?: number;
  start?: number;
  sort?: 'sim' | 'date';
}

const NAVER_BLOG_RATE_LIMIT_RETRY_DELAYS_MS = [500, 1_000];

@Injectable()
export class NaverBlogClient {
  private readonly logger = new Logger(NaverBlogClient.name);
  private readonly baseUrl = 'https://openapi.naver.com/v1/search/blog.json';

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

    for (
      let attempt = 0;
      attempt <= NAVER_BLOG_RATE_LIMIT_RETRY_DELAYS_MS.length;
      attempt += 1
    ) {
      const response = await scheduleNaverRequest(() =>
        fetch(`${this.baseUrl}?${query.toString()}`, {
          headers: {
            'X-Naver-Client-Id': clientId,
            'X-Naver-Client-Secret': clientSecret,
          },
        }),
      );

      if (response.ok) {
        const data = (await response.json()) as NaverBlogResponse;

        return data.items;
      }

      const body = await response.text();
      const retryDelayMs = NAVER_BLOG_RATE_LIMIT_RETRY_DELAYS_MS[attempt];

      if (response.status === 429 && retryDelayMs !== undefined) {
        this.logger.warn(
          `네이버 블로그 검색 속도 제한으로 재시도: attempt=${attempt + 1}, delayMs=${retryDelayMs}`,
        );
        await this.delay(retryDelayMs);
        continue;
      }

      this.logger.error(
        `네이버 블로그 검색 API 호출 실패: status=${response.status}, body=${body}`,
      );

      throw new InternalServerErrorException(
        '장소 상세 정보를 불러오지 못했습니다.',
      );
    }

    throw new InternalServerErrorException(
      '장소 상세 정보를 불러오지 못했습니다.',
    );
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
