import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocialLoginDto } from './dto/social-login.dto';

/** 소셜 서버가 응답하지 않을 때 로그인 요청이 끝없이 붙잡히지 않도록 대기 상한을 둔다. */
const SOCIAL_AUTH_REQUEST_TIMEOUT_MS = 5_000;

export interface SocialProfile {
  provider: 'KAKAO' | 'GOOGLE' | 'NAVER';
  providerId: string;
  nickname: string;
}

/**
 * 클라이언트가 넘긴 소셜 access token으로 사용자 프로필을 확인한다.
 *
 * access token은 "누가 로그인했는가"만 알려 줄 뿐 "어느 앱을 위해 발급됐는가"는 따로 확인해야 한다.
 * 이를 건너뛰면 다른 앱이 사용자에게서 받은 토큰을 그대로 넘겨 그 사용자로 로그인할 수 있다
 * (토큰 치환). 그래서 구글은 aud, 카카오는 app_id가 우리 앱인지 확인한다.
 * 카카오 code flow는 우리 키로 직접 교환한 토큰이므로 이 확인이 필요 없다.
 */
@Injectable()
export class SocialAuthService implements OnModuleInit {
  private readonly logger = new Logger(SocialAuthService.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    // 설정 누락으로 배포 직후 로그인이 막히지 않도록 검증을 건너뛰되, 경고를 남긴다.
    if (this.getGoogleClientIds().length === 0) {
      this.logger.warn(
        'GOOGLE_CLIENT_ID가 없어 구글 access token의 발급 대상(aud)을 검증하지 않습니다.',
      );
    }

    if (!this.getKakaoAppId()) {
      this.logger.warn(
        'KAKAO_APP_ID가 없어 카카오 access token의 발급 앱(app_id)을 검증하지 않습니다.',
      );
    }
  }

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

    if (accessToken) {
      // 클라이언트가 토큰을 직접 넘긴 경우에만 우리 앱에 발급된 토큰인지 확인한다.
      await this.assertKakaoTokenIssuedForThisApp(accessToken);
    } else if (dto.code) {
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
      client_id: this.configService.get<string>('KAKAO_REST_API_KEY') ?? '',
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

  private async assertKakaoTokenIssuedForThisApp(accessToken: string) {
    const appId = this.getKakaoAppId();

    if (!appId) {
      return;
    }

    const response = await this.request(
      'https://kapi.kakao.com/v1/user/access_token_info',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) {
      throw new UnauthorizedException('카카오 로그인 검증에 실패했습니다.');
    }

    const data = (await response.json()) as { app_id?: number | string };

    if (String(data.app_id) !== appId) {
      this.logger.warn(
        `다른 앱에 발급된 카카오 토큰으로 로그인을 시도했습니다: app_id=${String(data.app_id)}`,
      );
      throw new UnauthorizedException('카카오 로그인 검증에 실패했습니다.');
    }
  }

  private async fetchGoogleProfile(
    accessToken: string,
  ): Promise<SocialProfile> {
    const [response, audience] = await Promise.all([
      this.request('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
      this.fetchGoogleTokenAudience(accessToken),
    ]);

    if (!response.ok) {
      throw new UnauthorizedException('구글 로그인 검증에 실패했습니다.');
    }

    const data = (await response.json()) as {
      sub: string;
      name?: string;
      given_name?: string;
    };

    if (audience && audience.sub !== data.sub) {
      throw new UnauthorizedException('구글 로그인 검증에 실패했습니다.');
    }

    return {
      provider: 'GOOGLE',
      providerId: data.sub,
      nickname: data.name ?? data.given_name ?? '구글 사용자',
    };
  }

  /**
   * 토큰이 우리 OAuth 클라이언트에 발급됐는지 확인하고, 확인한 토큰의 사용자(sub)를 돌려준다.
   * GOOGLE_CLIENT_ID가 없으면 확인하지 않고 null을 돌려준다.
   */
  private async fetchGoogleTokenAudience(accessToken: string) {
    const clientIds = this.getGoogleClientIds();

    if (clientIds.length === 0) {
      return null;
    }

    const response = await this.request(
      `https://oauth2.googleapis.com/tokeninfo?${new URLSearchParams({
        access_token: accessToken,
      }).toString()}`,
      {},
    );

    if (!response.ok) {
      throw new UnauthorizedException('구글 로그인 검증에 실패했습니다.');
    }

    const data = (await response.json()) as { aud?: string; sub?: string };

    if (!data.aud || !clientIds.includes(data.aud)) {
      this.logger.warn(
        `다른 클라이언트에 발급된 구글 토큰으로 로그인을 시도했습니다: aud=${data.aud ?? 'none'}`,
      );
      throw new UnauthorizedException('구글 로그인 검증에 실패했습니다.');
    }

    return { sub: data.sub };
  }

  /**
   * 네이버는 토큰이 어느 앱에 발급됐는지 확인할 API가 없다. 확인하려면 서버가 client secret으로
   * 직접 code를 교환하는 방식으로 바꿔야 한다(클라이언트 변경 필요).
   */
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

  /** 웹·앱처럼 OAuth 클라이언트가 여럿이면 쉼표로 이어 적는다. */
  private getGoogleClientIds() {
    return (this.configService.get<string>('GOOGLE_CLIENT_ID') ?? '')
      .split(',')
      .map((clientId) => clientId.trim())
      .filter(Boolean);
  }

  private getKakaoAppId() {
    return this.configService.get<string>('KAKAO_APP_ID')?.trim() || null;
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
