import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { scheduleNaverRequest } from './naver-rate-limiter';

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

interface SearchLocalParams {
  query: string;
  display?: number;
  start?: number;
  sort?: 'random' | 'comment';
}

const NAVER_RATE_LIMIT_RETRY_DELAYS_MS = [500, 1_000];

@Injectable()
export class NaverLocalClient {
  private readonly logger = new Logger(NaverLocalClient.name);
  private readonly baseUrl = 'https://openapi.naver.com/v1/search/local.json';

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

    for (
      let attempt = 0;
      attempt <= NAVER_RATE_LIMIT_RETRY_DELAYS_MS.length;
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
        const data = (await response.json()) as NaverLocalResponse;

        return data.items;
      }

      const body = await response.text();
      const retryDelayMs = NAVER_RATE_LIMIT_RETRY_DELAYS_MS[attempt];

      if (response.status === 429 && retryDelayMs !== undefined) {
        this.logger.warn(
          `네이버 지역 검색 속도 제한으로 재시도: attempt=${attempt + 1}, delayMs=${retryDelayMs}`,
        );
        await this.delay(retryDelayMs);
        continue;
      }

      this.logger.error(
        `네이버 지역 검색 API 호출 실패: status=${response.status}, body=${body}`,
      );

      throw new InternalServerErrorException(
        '장소 추천을 불러오지 못했습니다.',
      );
    }

    throw new InternalServerErrorException('장소 추천을 불러오지 못했습니다.');
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
