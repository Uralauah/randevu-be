import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

    const data = await requestNaverSearch<NaverBlogResponse>({
      url: `${this.baseUrl}?${query.toString()}`,
      clientId,
      clientSecret,
      label: '블로그 검색',
      failureMessage: '장소 상세 정보를 불러오지 못했습니다.',
      logger: this.logger,
    });

    return data.items;
  }
}
