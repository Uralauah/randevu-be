import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { MIGRATIONS } from './migrations';

/**
 * 앱과 관리용 스크립트가 같은 DB 설정을 쓰도록 한곳에서 만든다.
 *
 * 스키마 변경은 migrations에 SQL로 남기고 앱이 뜰 때 적용한다(migrationsRun).
 * TypeORM은 마이그레이션을 먼저 적용한 뒤 synchronize를 실행한다.
 */
export function createTypeOrmOptions(
  configService: ConfigService,
): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    host: configService.get<string>('DATABASE_HOST'),
    port: configService.get<number>('DATABASE_PORT'),
    username: configService.get<string>('DATABASE_USERNAME'),
    password: configService.get<string>('DATABASE_PASSWORD'),
    database: configService.get<string>('DATABASE_NAME'),
    autoLoadEntities: true,
    synchronize: isSynchronizeEnabled(configService),
    migrations: MIGRATIONS,
    migrationsRun: true,
  };
}

/**
 * synchronize는 엔티티와 다른 부분을 DB에 그대로 반영하므로 컬럼 이름만 바꿔도
 * 기존 컬럼을 지우고 새로 만든다. 예전에는 NODE_ENV가 production이 아니면 켜졌기 때문에
 * 배포 환경에 NODE_ENV 설정이 빠지면 운영 DB에서 켜질 수 있었다.
 * 이제는 DATABASE_SYNCHRONIZE=true로 명시한 로컬 환경에서만 켜고, production에서는 무조건 끈다.
 */
export function isSynchronizeEnabled(configService: ConfigService) {
  if (configService.get<string>('NODE_ENV') === 'production') {
    return false;
  }

  return configService.get<string>('DATABASE_SYNCHRONIZE') === 'true';
}
