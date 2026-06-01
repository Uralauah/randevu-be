import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SubwayStation } from '../stations/entities';
import { PlaceCache } from './entities';
import { NaverBlogClient } from './naver-blog.client';
import { NaverLocalClient } from './naver-local.client';
import { PlaceTagService } from './place-tag.service';
import { PlacesService } from './places.service';

describe('PlacesService', () => {
  let service: PlacesService;
  const stationRepository = {
    findOne: jest.fn(),
  };
  const placeCacheRepository = {
    findOne: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
  };
  const naverLocalClient = {
    searchLocal: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlacesService,
        {
          provide: getRepositoryToken(SubwayStation),
          useValue: stationRepository,
        },
        {
          provide: getRepositoryToken(PlaceCache),
          useValue: placeCacheRepository,
        },
        {
          provide: NaverLocalClient,
          useValue: naverLocalClient,
        },
        {
          provide: NaverBlogClient,
          useValue: {
            searchBlogs: jest.fn(),
          },
        },
        {
          provide: PlaceTagService,
          useValue: {
            infer: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PlacesService>(PlacesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('recommends one place for a station and date', async () => {
    stationRepository.findOne.mockResolvedValue({
      id: 1,
      name: '삼성',
      lat: 37.5088,
      lng: 127.0631,
    });
    naverLocalClient.searchLocal.mockResolvedValue([
      {
        title: '코엑스아쿠아리움',
        link: 'https://map.naver.com/p/place/123',
        category: '문화,예술 > 아쿠아리움',
        description: '실내 데이트로 좋은 장소',
        telephone: '02-000-0000',
        address: '서울 강남구 삼성동',
        roadAddress: '서울 강남구 영동대로 513',
        mapx: '1270631000',
        mapy: '375088000',
      },
    ]);

    const result = await service.recommendPlaceByStationAndDate(
      1,
      '2026-07-18',
    );

    expect(result.date).toBe('2026-07-18');
    expect(result.recommendation).toMatchObject({
      category: expect.any(String),
      name: '코엑스아쿠아리움',
      reason: expect.stringContaining('좋아요'),
    });
    expect(placeCacheRepository.upsert).toHaveBeenCalled();
  });
});
