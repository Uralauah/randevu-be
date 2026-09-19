import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { User } from '../users/entities';
import { AuthTokenService } from './auth-token.service';
import { AuthService } from './auth.service';
import { AuthRefreshToken, SocialAccount } from './entities';
import { SocialAuthService, SocialProfile } from './social-auth.service';

const PROFILE: SocialProfile = {
  provider: 'KAKAO',
  providerId: '12345',
  nickname: '민지',
};

const uniqueViolation = () =>
  new QueryFailedError(
    'INSERT INTO "social_accounts"',
    [],
    Object.assign(new Error('duplicate key value'), { code: '23505' }),
  );

describe('AuthService - 소셜 로그인', () => {
  const existingUser = { id: 'existing-user' } as User;
  let socialAccountRepository: { findOne: jest.Mock };
  let manager: { create: jest.Mock; save: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    socialAccountRepository = { findOne: jest.fn().mockResolvedValue(null) };
    manager = {
      create: jest.fn((_target: unknown, entity: object) => ({ ...entity })),
      save: jest.fn((entity: object) =>
        Promise.resolve({ id: 'new-user', ...entity }),
      ),
    };
    dataSource = {
      transaction: jest.fn((work: (m: typeof manager) => Promise<unknown>) =>
        work(manager),
      ),
    };

    service = new AuthService(
      {} as Repository<User>,
      socialAccountRepository as unknown as Repository<SocialAccount>,
      { save: jest.fn() } as unknown as Repository<AuthRefreshToken>,
      {
        createRefreshToken: () => ({
          token: 'refresh',
          tokenHash: 'hash',
          expiresIn: 60,
          expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        }),
        signAccessToken: () => ({
          token: 'access',
          expiresIn: 60,
          expiresAt: '2099-01-01T00:00:00.000Z',
        }),
      } as unknown as AuthTokenService,
      {
        fetchProfile: jest.fn().mockResolvedValue(PROFILE),
      } as unknown as SocialAuthService,
      dataSource as unknown as DataSource,
    );
  });

  it('이미 연결된 소셜 계정이면 가입 없이 그 사용자로 로그인한다', async () => {
    socialAccountRepository.findOne.mockResolvedValue({ user: existingUser });

    const result = await service.login({ provider: 'KAKAO' });

    expect(result.user.id).toBe('existing-user');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('처음 로그인하면 사용자와 소셜 계정을 한 트랜잭션에서 만든다', async () => {
    const result = await service.login({ provider: 'KAKAO' });

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(manager.create).toHaveBeenCalledWith(
      User,
      expect.objectContaining({ nickname: '민지' }),
    );
    expect(manager.create).toHaveBeenCalledWith(SocialAccount, {
      userId: 'new-user',
      provider: 'KAKAO',
      providerId: '12345',
    });
    expect(result.user.id).toBe('new-user');
  });

  it('동시에 가입하다 유니크 제약에 걸리면 먼저 만들어진 사용자로 로그인한다', async () => {
    dataSource.transaction.mockRejectedValueOnce(uniqueViolation());
    socialAccountRepository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ user: existingUser });

    const result = await service.login({ provider: 'KAKAO' });

    expect(result.user.id).toBe('existing-user');
  });

  it('유니크 제약이 아닌 오류는 그대로 던진다', async () => {
    dataSource.transaction.mockRejectedValueOnce(new Error('connection lost'));

    await expect(service.login({ provider: 'KAKAO' })).rejects.toThrow(
      'connection lost',
    );
  });
});
