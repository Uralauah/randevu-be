import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface KakaoPlaceDocument {
  id: string;
  place_name: string;
  category_name: string;
  phone: string;
  address_name: string;
  road_address_name: string;
  x: string;
  y: string;
  place_url: string;
  distance?: string;
}

interface KakaoLocalResponse {
  documents: KakaoPlaceDocument[];
}

/** 응답이 멈춘 외부 API 때문에 요청 전체가 붙잡히지 않도록 대기 상한을 둔다. */
const KAKAO_REQUEST_TIMEOUT_MS = 3_000;

interface SearchCategoryParams {
  categoryGroupCode: string;
  lat: number;
  lng: number;
  radius: number;
  size: number;
  page?: number;
}

@Injectable()
export class KakaoLocalClient {
  constructor(private readonly configService: ConfigService) {}

  private readonly logger = new Logger(KakaoLocalClient.name);
  private readonly baseUrl =
    'https://dapi.kakao.com/v2/local/search/category.json';

  async searchByCategory(
    params: SearchCategoryParams,
  ): Promise<KakaoPlaceDocument[]> {
    const restApiKey = this.configService.get<string>('KAKAO_REST_API_KEY');

    if (!restApiKey) {
      throw new InternalServerErrorException(
        'KAKAO_REST_API_KEY가 설정되어 있지 않습니다.',
      );
    }

    const query = new URLSearchParams({
      category_group_code: params.categoryGroupCode,
      x: String(params.lng),
      y: String(params.lat),
      radius: String(params.radius),
      size: String(params.size),
      page: String(params.page ?? 1),
      //   sort: 'distance',
    });

    const url = `${this.baseUrl}?${query.toString()}`;

    let response: Response;

    try {
      response = await fetch(url, {
        headers: {
          Authorization: `KakaoAK ${restApiKey}`,
        },
        signal: AbortSignal.timeout(KAKAO_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(
        `카카오 로컬 API 호출 실패: ${
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error)
        }`,
      );

      throw new InternalServerErrorException(
        '장소 추천을 불러오지 못했습니다.',
      );
    }

    if (!response.ok) {
      const body = await response.text();

      this.logger.error(
        `카카오 로컬 API 호출 실패: status=${response.status}, body=${body}`,
      );

      throw new InternalServerErrorException(
        '장소 추천을 불러오지 못했습니다.',
      );
    }

    const data = (await response.json()) as KakaoLocalResponse;

    return data.documents;
  }
}
