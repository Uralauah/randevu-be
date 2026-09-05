import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createTypeOrmOptions } from '../database/typeorm-options';
import { StationsModule } from '../stations/stations.module';
import { StationsService } from '../stations/stations.service';

/**
 * 이동시간 캐시를 HTTP를 거치지 않고 재생성하는 관리용 스크립트.
 *
 *   npm run build
 *   npm run cache:rebuild            # 전체
 *   npm run cache:rebuild -- seoul   # 지역 하나
 *
 * 데이터만 다루는 작업이므로 스키마 동기화는 끈다.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        ...createTypeOrmOptions(configService),
        synchronize: false,
      }),
    }),
    StationsModule,
  ],
})
class RebuildTravelTimeCacheModule {}

async function main() {
  const logger = new Logger('RebuildTravelTimeCache');
  const regionCode = process.argv[2];
  const app = await NestFactory.createApplicationContext(
    RebuildTravelTimeCacheModule,
    { logger: ['log', 'warn', 'error'] },
  );

  try {
    const result = await app
      .get(StationsService)
      .rebuildTravelTimeCache(regionCode);

    logger.log(`결과: ${JSON.stringify(result)}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  new Logger('RebuildTravelTimeCache').error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
});
