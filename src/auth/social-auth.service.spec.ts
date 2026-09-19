import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocialAuthService } from './social-auth.service';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const createService = (config: Record<string, string>) => {
  const service = new SocialAuthService({
    get: (key: string) => config[key],
  } as unknown as ConfigService);

  (service as unknown as { logger: { warn: jest.Mock } }).logger = {
    warn: jest.fn(),
  };

  return service;
};

describe('SocialAuthService - 토큰 발급 대상 검증', () => {
  let fetchMock: jest.SpyInstance;
  const calledUrls = () =>
    fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname);

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  const routeGoogle = (aud: string, sub = 'google-sub') =>
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('tokeninfo')
          ? json({ aud, sub })
          : json({ sub: 'google-sub', name: '민지' }),
      ),
    );

  it('구글 토큰이 우리 클라이언트에 발급됐으면 로그인한다', async () => {
    routeGoogle('our-client.apps.googleusercontent.com');
    const service = createService({
      GOOGLE_CLIENT_ID: 'our-client.apps.googleusercontent.com',
    });

    await expect(
      service.fetchProfile({ provider: 'GOOGLE', accessToken: 'token' }),
    ).resolves.toEqual({
      provider: 'GOOGLE',
      providerId: 'google-sub',
      nickname: '민지',
    });
  });

  it('다른 클라이언트에 발급된 구글 토큰은 거절한다', async () => {
    routeGoogle('other-app.apps.googleusercontent.com');
    const service = createService({
      GOOGLE_CLIENT_ID: 'our-client.apps.googleusercontent.com',
    });

    await expect(
      service.fetchProfile({ provider: 'GOOGLE', accessToken: 'token' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('GOOGLE_CLIENT_ID가 없으면 발급 대상 확인을 건너뛴다', async () => {
    routeGoogle('anything');
    const service = createService({});

    await service.fetchProfile({ provider: 'GOOGLE', accessToken: 'token' });

    expect(calledUrls()).toEqual(['/oauth2/v3/userinfo']);
  });

  it('다른 앱에 발급된 카카오 토큰은 프로필을 조회하기 전에 거절한다', async () => {
    fetchMock.mockResolvedValue(json({ id: 1, app_id: 999 }));
    const service = createService({ KAKAO_APP_ID: '123' });

    await expect(
      service.fetchProfile({ provider: 'KAKAO', accessToken: 'token' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(calledUrls()).toEqual(['/v1/user/access_token_info']);
  });

  it('카카오 code flow는 우리 키로 교환한 토큰이라 발급 앱을 다시 확인하지 않는다', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('/oauth/token')
          ? json({ access_token: 'exchanged' })
          : json({ id: 42, properties: { nickname: '민지' } }),
      ),
    );
    const service = createService({
      KAKAO_APP_ID: '123',
      KAKAO_REST_API_KEY: 'rest-key',
    });

    await expect(
      service.fetchProfile({
        provider: 'KAKAO',
        code: 'code',
        redirectUri: 'https://randevu-fe.vercel.app/',
      }),
    ).resolves.toMatchObject({ providerId: '42' });
    expect(calledUrls()).toEqual(['/oauth/token', '/v2/user/me']);
  });
});
