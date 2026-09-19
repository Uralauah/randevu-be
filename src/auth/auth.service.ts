import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SocialAccount, AuthRefreshToken } from './entities';
import { User } from '../users/entities';
import { SocialLoginDto } from './dto/social-login.dto';
import { AuthTokenService } from './auth-token.service';
import { SocialAuthService, SocialProfile } from './social-auth.service';
import { isUniqueViolation } from '../database/postgres-errors';

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

    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async login(dto: SocialLoginDto) {
    const profile = await this.socialAuthService.fetchProfile(dto);
    const user =
      (await this.findUserBySocialAccount(profile)) ??
      (await this.createUserWithSocialAccount(profile));

    return this.issueLoginResponse(user);
  }

  private async findUserBySocialAccount(profile: SocialProfile) {
    const socialAccount = await this.socialAccountRepository.findOne({
      where: {
        provider: profile.provider,
        providerId: profile.providerId,
      },
      relations: {
        user: true,
      },
    });

    return socialAccount?.user ?? null;
  }

  /**
   * 사용자와 소셜 계정을 한 트랜잭션에서 만든다. 소셜 계정 저장이 실패하면 사용자도 남지 않는다.
   *
   * 같은 계정의 첫 로그인이 동시에 들어오면(로그인 버튼 연타, 재시도) 둘 다 "계정 없음"을 보고
   * 가입을 시도하고, 늦은 쪽은 (provider, providerId) 유니크 제약에 걸린다. 그때는 오류 대신
   * 먼저 만들어진 사용자로 로그인시킨다.
   */
  private async createUserWithSocialAccount(profile: SocialProfile) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const user = await manager.save(
          manager.create(User, {
            nickname: profile.nickname,
            defaultRegionCode: null,
            defaultStationId: null,
            maxMinutes: null,
          }),
        );

        await manager.save(
          manager.create(SocialAccount, {
            userId: user.id,
            provider: profile.provider,
            providerId: profile.providerId,
          }),
        );

        return user;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const existingUser = await this.findUserBySocialAccount(profile);

      if (!existingUser) {
        throw error;
      }

      return existingUser;
    }
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
