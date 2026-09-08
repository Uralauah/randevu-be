import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { SocialLoginDto } from './dto/social-login.dto';

/** 소셜 서버가 응답하지 않을 때 로그인 요청이 끝없이 붙잡히지 않도록 대기 상한을 둔다. */
const SOCIAL_AUTH_REQUEST_TIMEOUT_MS = 5_000;

export interface SocialProfile {
  provider: 'KAKAO' | 'GOOGLE' | 'NAVER';
  providerId: string;
  nickname: string;
}

@Injectable()
export class SocialAuthService {
  private readonly logger = new Logger(SocialAuthService.name);

  async fetchProfile(dto: SocialLoginDto): Promise<SocialProfile> {
    if (dto.provider === 'KAKAO') {
      return this.fetchKakaoProfile(dto);
    }

    if (dto.provider === 'GOOGLE') {
      if (!dto.accessToken) {
        throw new UnauthorizedException('구글 로그인 정보가 없습니다.');
      }
      return this.fetchGoogleProfile(dto.accessToken);
    }

    if (!dto.accessToken) {
      throw new UnauthorizedException('네이버 로그인 정보가 없습니다.');
    }
    return this.fetchNaverProfile(dto.accessToken);
  }

  private async fetchKakaoProfile(dto: SocialLoginDto): Promise<SocialProfile> {
    let accessToken = dto.accessToken;

    if (!accessToken && dto.code) {
      accessToken = await this.exchangeKakaoCode(
        dto.code,
        dto.redirectUri ?? '',
      );
    }

    if (!accessToken) {
      throw new UnauthorizedException('카카오 로그인 정보가 없습니다.');
    }

    const response = await this.request('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new UnauthorizedException('카카오 로그인 검증에 실패했습니다.');
    }

    const data = (await response.json()) as {
      id: number;
      properties?: { nickname?: string };
      kakao_account?: { profile?: { nickname?: string } };
    };

    return {
      provider: 'KAKAO',
      providerId: String(data.id),
      nickname:
        data.kakao_account?.profile?.nickname ??
        data.properties?.nickname ??
        '카카오 사용자',
    };
  }

  private async exchangeKakaoCode(
    code: string,
    redirectUri: string,
  ): Promise<string> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.KAKAO_REST_API_KEY ?? '',
      redirect_uri: redirectUri,
      code,
    });

    const response = await this.request('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new UnauthorizedException('카카오 코드 교환에 실패했습니다.');
    }

    const data = (await response.json()) as { access_token: string };
    return data.access_token;
  }

  private async fetchGoogleProfile(
    accessToken: string,
  ): Promise<SocialProfile> {
    const response = await this.request(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!response.ok) {
      throw new UnauthorizedException('구글 로그인 검증에 실패했습니다.');
    }

    const data = (await response.json()) as {
      sub: string;
      name?: string;
      given_name?: string;
    };

    return {
      provider: 'GOOGLE',
      providerId: data.sub,
      nickname: data.name ?? data.given_name ?? '구글 사용자',
    };
  }

  private async fetchNaverProfile(accessToken: string): Promise<SocialProfile> {
    const response = await this.request('https://openapi.naver.com/v1/nid/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new UnauthorizedException('네이버 로그인 검증에 실패했습니다.');
    }

    const data = (await response.json()) as {
      response: { id: string; nickname?: string; name?: string };
    };

    return {
      provider: 'NAVER',
      providerId: data.response.id,
      nickname: data.response.nickname ?? data.response.name ?? '네이버 사용자',
    };
  }

  private async request(url: string, init: RequestInit) {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(SOCIAL_AUTH_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(
        `소셜 로그인 API 호출 실패: url=${new URL(url).host}, error=${
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error)
        }`,
      );

      throw new ServiceUnavailableException(
        '로그인 서버와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      );
    }
  }
}
