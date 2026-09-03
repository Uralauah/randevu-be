import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { StationsController } from './stations.controller';
import { StationsService } from './stations.service';

const ADMIN_API_KEY = 'k'.repeat(48);

describe('StationsController - 이동시간 캐시 재생성 API', () => {
  let app: INestApplication<App>;
  const rebuildTravelTimeCache = jest.fn().mockResolvedValue({
    region: null,
    stationCount: 0,
    cacheCount: 0,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ ADMIN_API_KEY })],
        }),
      ],
      controllers: [StationsController],
      providers: [
        { provide: StationsService, useValue: { rebuildTravelTimeCache } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    rebuildTravelTimeCache.mockClear();
  });

  it('관리자 키 없이 호출하면 401이고 재생성을 실행하지 않는다', async () => {
    await request(app.getHttpServer())
      .post('/stations/travel-time-cache/rebuild')
      .expect(401);

    expect(rebuildTravelTimeCache).not.toHaveBeenCalled();
  });

  it('관리자 키가 맞으면 재생성을 실행한다', async () => {
    await request(app.getHttpServer())
      .post('/stations/travel-time-cache/rebuild?region=seoul')
      .set('x-admin-key', ADMIN_API_KEY)
      .expect(201);

    expect(rebuildTravelTimeCache).toHaveBeenCalledWith('seoul');
  });
});
