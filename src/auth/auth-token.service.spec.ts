import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'crypto';
import { AuthTokenService } from './auth-token.service';
import { createJwtOptions } from './jwt-options';

const SECRET = 'a'.repeat(32);

function createService(env: Record<string, string> = {}) {
  const configService = new ConfigService({
    AUTH_TOKEN_SECRET: SECRET,
    AUTH_REFRESH_TOKEN_SECRET: 'b'.repeat(32),
    ...env,
  });
  const jwtService = new JwtService(createJwtOptions(configService));

  return new AuthTokenService(configService, jwtService);
}

function forgeToken(payload: object, header: object = { alg: 'HS256' }) {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const content = `${encode(header)}.${encode(payload)}`;
  const signature = createHmac('sha256', SECRET)
    .update(content)
    .digest('base64url');

  return `${content}.${signature}`;
}

describe('AuthTokenService', () => {
  it('서명한 액세스 토큰을 검증하고 사용자 ID를 돌려준다', () => {
    const service = createService();
    const { token } = service.signAccessToken('user-1');

    expect(service.verify(token)).toMatchObject({
      sub: 'user-1',
      type: 'access',
      iss: 'randevu-api',
      aud: 'randevu-client',
    });
  });

  it('다른 시크릿으로 서명한 토큰은 거절한다', () => {
    const token = createService().signAccessToken('user-1').token;
    const other = createService({ AUTH_TOKEN_SECRET: 'c'.repeat(32) });

    expect(other.verify(token)).toBeNull();
  });

  it('발급자나 대상이 다른 토큰은 거절한다', () => {
    const token = createService({ AUTH_TOKEN_ISSUER: 'other' }).signAccessToken(
      'user-1',
    ).token;

    expect(createService().verify(token)).toBeNull();
  });

  it('만료된 토큰은 거절한다', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = forgeToken({
      sub: 'user-1',
      type: 'access',
      iss: 'randevu-api',
      aud: 'randevu-client',
      iat: now - 100,
      nbf: now - 100,
      exp: now - 50,
    });

    expect(createService().verify(token)).toBeNull();
  });

  it('alg가 none이거나 서명이 없는 토큰은 거절한다', () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: 'user-1',
      type: 'access',
      iss: 'randevu-api',
      aud: 'randevu-client',
      exp: now + 60,
    };
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');

    expect(
      createService().verify(`${encode({ alg: 'none' })}.${encode(payload)}.`),
    ).toBeNull();
  });

  it('type이 access가 아닌 토큰은 거절한다', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = forgeToken({
      sub: 'user-1',
      type: 'refresh',
      iss: 'randevu-api',
      aud: 'randevu-client',
      exp: now + 60,
    });

    expect(createService().verify(token)).toBeNull();
  });

  it('JWT 형식이 아닌 값은 null을 돌려준다', () => {
    expect(createService().verify('not-a-token')).toBeNull();
  });

  it('시크릿이 짧으면 모듈 설정 단계에서 실패한다', () => {
    const configService = new ConfigService({ AUTH_TOKEN_SECRET: 'short' });

    expect(() => createJwtOptions(configService)).toThrow('AUTH_TOKEN_SECRET');
  });
});
