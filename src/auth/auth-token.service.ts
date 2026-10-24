import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { requireSecret } from './jwt-options';

interface AuthTokenPayload {
  sub: string;
  type: 'access';
  iss: string;
  aud: string;
  jti: string;
  iat: number;
  nbf: number;
  exp: number;
}

const DEFAULT_ACCESS_TOKEN_EXPIRES_IN_SECONDS = 60 * 15;
const DEFAULT_REFRESH_TOKEN_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 30;
const CLOCK_TOLERANCE_SECONDS = 5;

@Injectable()
export class AuthTokenService {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  signAccessToken(userId: string) {
    const expiresInSeconds = this.getAccessTokenExpiresInSeconds();
    const token = this.jwtService.sign(
      { sub: userId, type: 'access' },
      {
        issuer: this.getIssuer(),
        audience: this.getAudience(),
        jwtid: randomUUID(),
        notBefore: 0,
        expiresIn: expiresInSeconds,
      },
    );

    return {
      token,
      expiresIn: expiresInSeconds,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    };
  }

  createRefreshToken() {
    const token = randomBytes(64).toString('base64url');
    const expiresIn = this.getRefreshTokenExpiresInSeconds();
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    return {
      token,
      tokenHash: this.hashRefreshToken(token),
      expiresIn,
      expiresAt,
    };
  }

  hashRefreshToken(token: string) {
    return createHash('sha256')
      .update(`${token}.${this.getRefreshTokenSecret()}`)
      .digest('hex');
  }

  verify(token: string): AuthTokenPayload | null {
    try {
      const payload = this.jwtService.verify<AuthTokenPayload>(token, {
        issuer: this.getIssuer(),
        audience: this.getAudience(),
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      });

      return payload.type === 'access' && payload.sub ? payload : null;
    } catch {
      return null;
    }
  }

  private getRefreshTokenSecret() {
    return requireSecret(this.configService, 'AUTH_REFRESH_TOKEN_SECRET');
  }

  private getIssuer() {
    return this.configService.get<string>('AUTH_TOKEN_ISSUER') ?? 'randevu-api';
  }

  private getAudience() {
    return (
      this.configService.get<string>('AUTH_TOKEN_AUDIENCE') ?? 'randevu-client'
    );
  }

  private getAccessTokenExpiresInSeconds() {
    const rawValue = this.configService.get<string>(
      'AUTH_ACCESS_TOKEN_EXPIRES_IN_SECONDS',
    );

    if (!rawValue) {
      return DEFAULT_ACCESS_TOKEN_EXPIRES_IN_SECONDS;
    }

    const parsedValue = Number(rawValue);

    if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
      throw new InternalServerErrorException(
        'AUTH_ACCESS_TOKEN_EXPIRES_IN_SECONDS는 양의 정수여야 합니다.',
      );
    }

    return parsedValue;
  }

  private getRefreshTokenExpiresInSeconds() {
    const rawValue = this.configService.get<string>(
      'AUTH_REFRESH_TOKEN_EXPIRES_IN_SECONDS',
    );

    if (!rawValue) {
      return DEFAULT_REFRESH_TOKEN_EXPIRES_IN_SECONDS;
    }

    const parsedValue = Number(rawValue);

    if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
      throw new InternalServerErrorException(
        'AUTH_REFRESH_TOKEN_EXPIRES_IN_SECONDS는 양의 정수여야 합니다.',
      );
    }

    return parsedValue;
  }
}
