import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { DateCoursesController } from './date-courses.controller';
import { DateCoursesService } from './date-courses.service';

const COURSE_ID = '6f1c1d0e-4b7a-4a51-9a59-2c1f3f0b9e11';

const validItem = {
  itemType: 'CAFE',
  itemOrder: 1,
  name: '카페',
  lat: 37.5,
  lng: 127.0,
};

describe('DateCoursesController - 요청 검증', () => {
  let app: INestApplication<App>;
  const service = {
    findOne: jest.fn().mockResolvedValue({ id: COURSE_ID }),
    create: jest.fn().mockResolvedValue({ id: COURSE_ID }),
    update: jest.fn().mockResolvedValue({ id: COURSE_ID }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DateCoursesController],
      providers: [{ provide: DateCoursesService, useValue: service }],
    })
      .overrideGuard(AccessTokenGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest<{ user?: unknown }>().user = {
            id: 'user-id',
          };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    // main.ts와 같은 전역 파이프
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('코스 ID가 UUID가 아니면 DB 조회 전에 400으로 거절한다', async () => {
    await request(app.getHttpServer())
      .get('/date-courses/not-a-uuid')
      .expect(400);

    expect(service.findOne).not.toHaveBeenCalled();
  });

  it('올바른 코스 ID는 그대로 넘긴다', async () => {
    await request(app.getHttpServer())
      .get(`/date-courses/${COURSE_ID}`)
      .expect(200);

    expect(service.findOne).toHaveBeenCalledWith(COURSE_ID, 'user-id');
  });

  it.each([
    ['컬럼보다 긴 장소 이름', { ...validItem, name: '가'.repeat(121) }],
    ['숫자가 아닌 위도', { ...validItem, lat: 'abc' }],
    ['범위를 벗어난 경도', { ...validItem, lng: 200 }],
  ])('%s는 400으로 거절한다', async (_label, item) => {
    await request(app.getHttpServer())
      .post('/date-courses')
      .send({
        date: '2026-09-20',
        stationId: 1,
        title: '데이트',
        items: [item],
      })
      .expect(400);

    expect(service.create).not.toHaveBeenCalled();
  });

  it('수정 요청의 기존 아이템 ID가 UUID가 아니면 400이다', async () => {
    await request(app.getHttpServer())
      .patch(`/date-courses/${COURSE_ID}`)
      .send({ items: [{ id: 'first', itemOrder: 1 }] })
      .expect(400);

    expect(service.update).not.toHaveBeenCalled();
  });

  it('수정 요청에 version을 담으면 숫자로 넘긴다', async () => {
    await request(app.getHttpServer())
      .patch(`/date-courses/${COURSE_ID}`)
      .send({ version: '3', date: '2026-09-21' })
      .expect(200);

    expect(service.update).toHaveBeenCalledWith(COURSE_ID, 'user-id', {
      version: 3,
      date: '2026-09-21',
    });
  });
});
