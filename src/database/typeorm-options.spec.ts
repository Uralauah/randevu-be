import { ConfigService } from '@nestjs/config';
import { createTypeOrmOptions, isSynchronizeEnabled } from './typeorm-options';

const configWith = (values: Record<string, string | undefined>) =>
  ({
    get: (key: string) => values[key],
  }) as unknown as ConfigService;

describe('TypeORM 설정', () => {
  it('NODE_ENV가 비어 있어도 명시적으로 켜지 않으면 synchronize는 꺼져 있다', () => {
    expect(isSynchronizeEnabled(configWith({}))).toBe(false);
  });

  it('로컬에서 DATABASE_SYNCHRONIZE=true로 켠 경우에만 synchronize를 쓴다', () => {
    expect(
      isSynchronizeEnabled(
        configWith({ NODE_ENV: 'development', DATABASE_SYNCHRONIZE: 'true' }),
      ),
    ).toBe(true);
  });

  it('production에서는 설정과 상관없이 synchronize를 끈다', () => {
    expect(
      isSynchronizeEnabled(
        configWith({ NODE_ENV: 'production', DATABASE_SYNCHRONIZE: 'true' }),
      ),
    ).toBe(false);
  });

  it('앱이 뜰 때 마이그레이션을 적용한다', () => {
    const options = createTypeOrmOptions(configWith({}));

    expect(options).toMatchObject({ migrationsRun: true, synchronize: false });
    expect(Array.isArray(options.migrations)).toBe(true);
  });
});
