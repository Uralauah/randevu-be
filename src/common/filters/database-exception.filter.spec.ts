import { Controller, Get, INestApplication, Param } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { QueryFailedError } from 'typeorm';
import { DatabaseExceptionFilter } from './database-exception.filter';

const dbError = (code: string) =>
  new QueryFailedError(
    'SELECT 1',
    [],
    Object.assign(new Error(`db error ${code}`), { code }),
  );

@Controller('db-errors')
class DbErrorController {
  @Get(':code')
  fail(@Param('code') code: string): never {
    throw dbError(code);
  }
}

describe('DatabaseExceptionFilter', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DbErrorController],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    const { httpAdapter } = app.get(HttpAdapterHost);
    app.useGlobalFilters(new DatabaseExceptionFilter(httpAdapter));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['22P02', 400],
    ['22003', 400],
    ['22001', 400],
    ['22007', 400],
    ['23505', 409],
  ])('입력값 때문에 거절된 경우(%s)는 %i로 응답한다', async (code, status) => {
    const response = await request(app.getHttpServer())
      .get(`/db-errors/${code}`)
      .expect(status);

    expect(response.body).toMatchObject({ statusCode: status });
    // DB 오류 원문은 응답에 싣지 않는다.
    expect(JSON.stringify(response.body)).not.toContain('db error');
  });

  it('서버 버그일 수 있는 오류(외래키 위반 등)는 그대로 500이다', async () => {
    await request(app.getHttpServer()).get('/db-errors/23503').expect(500);
  });
});
