import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'crypto';

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

interface JwtHeader {
  alg: 'HS256';
  typ: 'JWT';
}

const DEFAULT_ACCESS_TOKEN_EXPIRES_IN_SECONDS = 60 * 15;
const DEFAULT_REFRESH_TOKEN_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 30;
const MIN_SECRET_BYTE_LENGTH = 32;
const CLOCK_TOLERANCE_SECONDS = 5;

@Injectable()
export class AuthTokenService {
  constructor(private readonly configService: ConfigService) {}

  signAccessToken(userId: string) {
    const now = Math.floor(Date.now() / 1000);
    const expiresInSeconds = this.getAccessTokenExpiresInSeconds();
    const payload: AuthTokenPayload = {
      sub: userId,
      type: 'access',
      iss: this.getIssuer(),
      aud: this.getAudience(),
      jti: randomUUID(),
      iat: now,
      nbf: now,
      exp: now + expiresInSeconds,
    };

    const header = this.encodeJson({
      alg: 'HS256',
      typ: 'JWT',
    } satisfies JwtHeader);
    const body = this.encodeJson(payload);
    const signature = this.signContent(`${header}.${body}`);

    return {
      token: `${header}.${body}.${signature}`,
      expiresIn: expiresInSeconds,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
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
      const parts = token.split('.');

      if (parts.length !== 3) {
        return null;
      }

      const [header, body, signature] = parts;

      if (!header || !body || !signature) {
        return null;
      }

      const decodedHeader = this.decodeJson<JwtHeader>(header);

      if (decodedHeader.alg !== 'HS256' || decodedHeader.typ !== 'JWT') {
        return null;
      }

      const expectedSignature = this.signContent(`${header}.${body}`);

      if (!this.safeEqual(signature, expectedSignature)) {
        return null;
      }

      const payload = this.decodeJson<AuthTokenPayload>(body);

      if (!this.isValidPayload(payload)) {
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }

  private encodeJson(value: unknown) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
  }

  private decodeJson<T>(value: string): T {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
  }

  private signContent(content: string) {
    return createHmac('sha256', this.getSecret())
      .update(content)
      .digest('base64url');
  }

  private safeEqual(a: string, b: string) {
    const aBuffer = Buffer.from(a, 'utf8');
    const bBuffer = Buffer.from(b, 'utf8');

    if (aBuffer.length !== bBuffer.length) {
      return false;
    }

    return timingSafeEqual(aBuffer, bBuffer);
  }

  private isValidPayload(payload: AuthTokenPayload) {
    const now = Math.floor(Date.now() / 1000);

    if (!payload.sub || typeof payload.sub !== 'string') {
      return false;
    }

    if (payload.type !== 'access') {
      return false;
    }

    if (
      payload.iss !== this.getIssuer() ||
      payload.aud !== this.getAudience()
    ) {
      return false;
    }

    if (
      !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.nbf) ||
      !Number.isInteger(payload.exp)
    ) {
      return false;
    }

    if (payload.nbf > now + CLOCK_TOLERANCE_SECONDS) {
      return false;
    }

    if (payload.exp <= now - CLOCK_TOLERANCE_SECONDS) {
      return false;
    }

    if (payload.exp <= payload.iat) {
      return false;
    }

    return true;
  }

  private getSecret() {
    const secret = this.configService.get<string>('AUTH_TOKEN_SECRET');

    if (!secret) {
      throw new InternalServerErrorException(
        'AUTH_TOKEN_SECRET 환경변수가 설정되지 않았습니다.',
      );
    }

    if (Buffer.byteLength(secret, 'utf8') < MIN_SECRET_BYTE_LENGTH) {
      throw new InternalServerErrorException(
        `AUTH_TOKEN_SECRET은 최소 ${MIN_SECRET_BYTE_LENGTH}바이트 이상이어야 합니다.`,
      );
    }

    return secret;
  }

  private getRefreshTokenSecret() {
    const secret = this.configService.get<string>('AUTH_REFRESH_TOKEN_SECRET');

    if (!secret) {
      throw new InternalServerErrorException(
        'AUTH_REFRESH_TOKEN_SECRET 환경변수가 설정되지 않았습니다.',
      );
    }

    if (Buffer.byteLength(secret, 'utf8') < MIN_SECRET_BYTE_LENGTH) {
      throw new InternalServerErrorException(
        `AUTH_REFRESH_TOKEN_SECRET은 최소 ${MIN_SECRET_BYTE_LENGTH}바이트 이상이어야 합니다.`,
      );
    }

    return secret;
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
