import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthRefreshToken, SocialAccount, User } from './entities';
import { SocialLoginDto } from './dto/social-login.dto';
import { AuthTokenService } from './auth-token.service';

interface SocialProfile {
  provider: 'KAKAO' | 'GOOGLE' | 'NAVER';
  providerId: string;
  nickname: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    @InjectRepository(SocialAccount)
    private readonly socialAccountRepository: Repository<SocialAccount>,

    @InjectRepository(AuthRefreshToken)
    private readonly refreshTokenRepository: Repository<AuthRefreshToken>,

    private readonly authTokenService: AuthTokenService,
  ) {}

  async login(dto: SocialLoginDto) {
    const profile = await this.fetchSocialProfile(dto);
    const socialAccount = await this.socialAccountRepository.findOne({
      where: {
        provider: profile.provider,
        providerId: profile.providerId,
      },
      relations: {
        user: true,
      },
    });

    if (socialAccount) {
      return this.issueLoginResponse(socialAccount.user);
    }

    const user = await this.userRepository.save({
      nickname: profile.nickname,
      defaultRegionCode: null,
      defaultStationId: null,
      maxMinutes: null,
    });

    await this.socialAccountRepository.save({
      userId: user.id,
      provider: profile.provider,
      providerId: profile.providerId,
    });

    return this.issueLoginResponse(user);
  }

  async me(userId: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: {
        socialAccounts: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('사용자를 찾을 수 없습니다.');
    }

    return {
      id: user.id,
      nickname: user.nickname,
      defaultRegionCode: user.defaultRegionCode ?? null,
      defaultStationId: user.defaultStationId ?? null,
      maxMinutes: user.maxMinutes ?? null,
      socialAccounts: user.socialAccounts.map((account) => ({
        provider: account.provider,
        providerId: account.providerId,
      })),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async refresh(refreshToken: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('refreshToken이 없습니다.');
    }

    const tokenHash = this.authTokenService.hashRefreshToken(refreshToken);
    const storedToken = await this.refreshTokenRepository.findOne({
      where: { tokenHash },
      relations: {
        user: true,
      },
    });

    if (!storedToken || !this.isRefreshTokenActive(storedToken)) {
      throw new UnauthorizedException('유효하지 않은 refreshToken입니다.');
    }

    const nextRefreshToken = this.authTokenService.createRefreshToken();
    const savedNextRefreshToken = await this.refreshTokenRepository.save({
      userId: storedToken.userId,
      tokenHash: nextRefreshToken.tokenHash,
      expiresAt: nextRefreshToken.expiresAt,
      revokedAt: null,
      replacedByTokenId: null,
    });

    storedToken.revokedAt = new Date();
    storedToken.replacedByTokenId = savedNextRefreshToken.id;
    await this.refreshTokenRepository.save(storedToken);

    return this.toLoginResponse(storedToken.user, nextRefreshToken);
  }

  async logout(refreshToken: string) {
    if (!refreshToken) {
      return { success: true };
    }

    const tokenHash = this.authTokenService.hashRefreshToken(refreshToken);
    const storedToken = await this.refreshTokenRepository.findOne({
      where: { tokenHash },
    });

    if (storedToken && this.isRefreshTokenActive(storedToken)) {
      storedToken.revokedAt = new Date();
      await this.refreshTokenRepository.save(storedToken);
    }

    return { success: true };
  }

  private async fetchSocialProfile(
    dto: SocialLoginDto,
  ): Promise<SocialProfile> {
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
      accessToken = await this.exchangeKakaoCode(dto.code, dto.redirectUri ?? '');
    }

    if (!accessToken) {
      throw new UnauthorizedException('카카오 로그인 정보가 없습니다.');
    }

    const response = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new UnauthorizedException('카카오 로그인 검증에 실패했습니다.');
    }

    const data = (await response.json()) as {
      id: number;
      properties?: {
        nickname?: string;
      };
      kakao_account?: {
        profile?: {
          nickname?: string;
        };
      };
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

    const response = await fetch('https://kauth.kakao.com/oauth/token', {
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
    const response = await fetch(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
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
    const response = await fetch('https://openapi.naver.com/v1/nid/me', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new UnauthorizedException('네이버 로그인 검증에 실패했습니다.');
    }

    const data = (await response.json()) as {
      response: {
        id: string;
        nickname?: string;
        name?: string;
      };
    };

    return {
      provider: 'NAVER',
      providerId: data.response.id,
      nickname: data.response.nickname ?? data.response.name ?? '네이버 사용자',
    };
  }

  private async issueLoginResponse(user: User) {
    const refreshToken = this.authTokenService.createRefreshToken();

    await this.refreshTokenRepository.save({
      userId: user.id,
      tokenHash: refreshToken.tokenHash,
      expiresAt: refreshToken.expiresAt,
      revokedAt: null,
      replacedByTokenId: null,
    });

    return this.toLoginResponse(user, refreshToken);
  }

  private toLoginResponse(
    user: User,
    refreshToken: {
      token: string;
      expiresIn: number;
      expiresAt: Date;
    },
  ) {
    const signedToken = this.authTokenService.signAccessToken(user.id);

    return {
      accessToken: signedToken.token,
      tokenType: 'Bearer',
      expiresIn: signedToken.expiresIn,
      expiresAt: signedToken.expiresAt,
      refreshToken: refreshToken.token,
      refreshTokenExpiresIn: refreshToken.expiresIn,
      refreshTokenExpiresAt: refreshToken.expiresAt.toISOString(),
      user: {
        id: user.id,
        nickname: user.nickname,
        defaultRegionCode: user.defaultRegionCode ?? null,
        defaultStationId: user.defaultStationId ?? null,
        maxMinutes: user.maxMinutes ?? null,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };
  }

  private isRefreshTokenActive(token: AuthRefreshToken) {
    return !token.revokedAt && token.expiresAt.getTime() > Date.now();
  }
}
