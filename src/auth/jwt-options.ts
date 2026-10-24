import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModuleOptions } from '@nestjs/jwt';

export const MIN_SECRET_BYTE_LENGTH = 32;

export function requireSecret(configService: ConfigService, name: string) {
  const secret = configService.get<string>(name);

  if (!secret) {
    throw new InternalServerErrorException(
      `${name} 환경변수가 설정되지 않았습니다.`,
    );
  }

  if (Buffer.byteLength(secret, 'utf8') < MIN_SECRET_BYTE_LENGTH) {
    throw new InternalServerErrorException(
      `${name}은 최소 ${MIN_SECRET_BYTE_LENGTH}바이트 이상이어야 합니다.`,
    );
  }

  return secret;
}

/** 시크릿이 잘못되면 첫 요청이 아니라 서버를 띄울 때 실패한다. */
export function createJwtOptions(
  configService: ConfigService,
): JwtModuleOptions {
  return {
    secret: requireSecret(configService, 'AUTH_TOKEN_SECRET'),
    signOptions: { algorithm: 'HS256' },
    verifyOptions: { algorithms: ['HS256'] },
  };
}
