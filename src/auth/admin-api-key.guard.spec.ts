import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminApiKeyGuard } from './admin-api-key.guard';

const VALID_KEY = 'a'.repeat(40);

const createContext = (headers: Record<string, string>) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        header: (name: string) => headers[name.toLowerCase()],
      }),
    }),
  }) as unknown as ExecutionContext;

const createGuard = (adminApiKey?: string) =>
  new AdminApiKeyGuard({
    get: () => adminApiKey,
  } as unknown as ConfigService);

describe('AdminApiKeyGuard', () => {
  it('헤더의 키가 일치하면 통과시킨다', () => {
    const guard = createGuard(VALID_KEY);

    expect(guard.canActivate(createContext({ 'x-admin-key': VALID_KEY }))).toBe(
      true,
    );
  });

  it('키가 없으면 401을 던진다', () => {
    const guard = createGuard(VALID_KEY);

    expect(() => guard.canActivate(createContext({}))).toThrow(
      UnauthorizedException,
    );
  });

  it('키가 다르면 길이와 상관없이 401을 던진다', () => {
    const guard = createGuard(VALID_KEY);

    for (const wrongKey of ['short', 'b'.repeat(40), `${VALID_KEY}x`]) {
      expect(() =>
        guard.canActivate(createContext({ 'x-admin-key': wrongKey })),
      ).toThrow(UnauthorizedException);
    }
  });

  it('서버에 키가 설정되지 않았으면 관리 API를 열지 않는다', () => {
    const guard = createGuard(undefined);

    expect(() =>
      guard.canActivate(createContext({ 'x-admin-key': 'anything' })),
    ).toThrow(ForbiddenException);
  });

  it('서버 키가 너무 짧으면 잘못된 설정으로 보고 거부한다', () => {
    const guard = createGuard('short-key');

    expect(() =>
      guard.canActivate(createContext({ 'x-admin-key': 'short-key' })),
    ).toThrow(ForbiddenException);
  });
});
