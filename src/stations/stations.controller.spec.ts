import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { get, Server } from 'http';
import { AddressInfo } from 'net';
import { precompressJson } from '../common/http/precompressed-json';
import { StationsController } from './stations.controller';
import { StationsService } from './stations.service';

const ADMIN_API_KEY = 'k'.repeat(48);
const STATIONS = Array.from({ length: 50 }, (_, i) => ({
  id: i + 1,
  name: `역${i + 1}`,
  lines: [{ id: 2, name: '2호선', color: '#00A84D', regionId: 1 }],
}));

describe('StationsController', () => {
  let app: INestApplication<App>;
  const rebuildTravelTimeCache = jest.fn().mockResolvedValue({
    region: null,
    stationCount: 0,
    cacheCount: 0,
  });
  const getStationListPayload = jest.fn(() => precompressJson(STATIONS));

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
        {
          provide: StationsService,
          useValue: { rebuildTravelTimeCache, getStationListPayload },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.enableCors({ origin: true });
    await app.listen(0);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    rebuildTravelTimeCache.mockClear();
  });

  describe('이동시간 캐시 재생성 API', () => {
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

  describe('역 목록 API', () => {
    it('Accept-Encoding이 없으면 압축하지 않은 JSON을 보낸다', async () => {
      // supertest는 Accept-Encoding을 자동으로 붙이므로 원시 http 요청으로 확인한다.
      const { port } = (
        app.getHttpServer() as unknown as Server
      ).address() as AddressInfo;
      const { headers, body } = await new Promise<{
        headers: Record<string, string | string[] | undefined>;
        body: string;
      }>((resolve, reject) => {
        get(`http://127.0.0.1:${port}/stations?region=seoul`, (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => (data += chunk));
          res.on('end', () => resolve({ headers: res.headers, body: data }));
        }).on('error', reject);
      });

      expect(headers['content-encoding']).toBeUndefined();
      expect(headers['content-type']).toContain('application/json');
      expect(headers['cache-control']).toBe('public, max-age=300');
      expect(JSON.parse(body)).toEqual(STATIONS);
      expect(getStationListPayload).toHaveBeenCalledWith('seoul');
    });

    it.each([
      ['gzip, deflate, br', 'br'],
      ['gzip', 'gzip'],
    ])(
      'Accept-Encoding이 "%s"이면 미리 압축한 %s 본문을 보낸다',
      async (acceptEncoding, expectedEncoding) => {
        const raw = Buffer.from(JSON.stringify(STATIONS));
        const response = await request(app.getHttpServer())
          .get('/stations')
          .set('Accept-Encoding', acceptEncoding)
          .expect(200);

        expect(response.headers['content-encoding']).toBe(expectedEncoding);
        expect(Number(response.headers['content-length'])).toBeLessThan(
          raw.length,
        );
        // 클라이언트가 풀어낸 내용이 원본과 같다.
        expect(response.body).toEqual(STATIONS);
      },
    );

    it('ETag가 같으면 본문 없이 304를 보낸다', async () => {
      const first = await request(app.getHttpServer())
        .get('/stations')
        .expect(200);

      await request(app.getHttpServer())
        .get('/stations')
        .set('If-None-Match', first.headers.etag)
        .expect(304);
    });

    it('CORS의 Vary: Origin을 지우지 않고 Accept-Encoding을 덧붙인다', async () => {
      const response = await request(app.getHttpServer())
        .get('/stations')
        .set('Origin', 'https://randevu-fe.vercel.app')
        .expect(200);

      expect(response.headers.vary).toContain('Origin');
      expect(response.headers.vary).toContain('Accept-Encoding');
    });
  });
});
