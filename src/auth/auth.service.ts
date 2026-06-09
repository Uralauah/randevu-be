import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SocialAccount, AuthRefreshToken } from './entities';
import { User } from '../users/entities';
import { SocialLoginDto } from './dto/social-login.dto';
import { AuthTokenService } from './auth-token.service';
import { SocialAuthService } from './social-auth.service';

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
    private readonly socialAuthService: SocialAuthService,
  ) {}

  async login(dto: SocialLoginDto) {
    const profile = await this.socialAuthService.fetchProfile(dto);
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
