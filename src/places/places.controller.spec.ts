import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PlacesController } from './places.controller';
import { PlacesService } from './places.service';

describe('PlacesController', () => {
  let app: INestApplication<App>;
  let controller: PlacesController;
  const placesService = {
    searchPlacesByKeyword: jest.fn().mockResolvedValue({ places: [] }),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlacesController],
      providers: [
        {
          provide: PlacesService,
          useValue: placesService,
        },
      ],
    }).compile();

    controller = module.get<PlacesController>(PlacesController);
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('키워드 검색의 stationId가 숫자가 아니면 400이다', async () => {
    await request(app.getHttpServer())
      .get('/places/search')
      .query({ query: '카페', type: 'CAFE', stationId: 'abc' })
      .expect(400);

    expect(placesService.searchPlacesByKeyword).not.toHaveBeenCalled();
  });

  it('stationId는 생략할 수 있다', async () => {
    await request(app.getHttpServer())
      .get('/places/search')
      .query({ query: '카페', type: 'CAFE' })
      .expect(200);

    expect(placesService.searchPlacesByKeyword).toHaveBeenCalledWith(
      '카페',
      'CAFE',
      undefined,
    );
  });
});
