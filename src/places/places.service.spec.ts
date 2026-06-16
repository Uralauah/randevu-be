import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DateCourseItem } from '../date-courses/entities';
import { SubwayStation } from '../stations/entities';
import { PlaceCache } from './entities';
import { NaverBlogClient } from './naver-blog.client';
import { KakaoLocalClient } from './kakao-local.client';
import { NaverLocalClient, NaverLocalItem } from './naver-local.client';
import { PlaceTagService } from './place-tag.service';
import { PlaceScoringService } from './place-scoring.service';
import { PlaceSearchService } from './place-search.service';
import { BlogDateEventService } from './blog-date-event.service';
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
  const dateCourseItemRepository = {
    find: jest.fn(),
  };
  const naverLocalClient: jest.Mocked<Pick<NaverLocalClient, 'searchLocal'>> = {
    searchLocal: jest.fn(),
  };
  const naverBlogClient: jest.Mocked<Pick<NaverBlogClient, 'searchBlogs'>> = {
    searchBlogs: jest.fn(),
  };
  const kakaoLocalClient: jest.Mocked<
    Pick<KakaoLocalClient, 'searchByCategory'>
  > = {
    searchByCategory: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlacesService,
        PlaceScoringService,
        PlaceSearchService,
        BlogDateEventService,
        {
          provide: getRepositoryToken(SubwayStation),
          useValue: stationRepository,
        },
        {
          provide: getRepositoryToken(PlaceCache),
          useValue: placeCacheRepository,
        },
        {
          provide: getRepositoryToken(DateCourseItem),
          useValue: dateCourseItemRepository,
        },
        {
          provide: NaverLocalClient,
          useValue: naverLocalClient,
        },
        {
          provide: KakaoLocalClient,
          useValue: kakaoLocalClient,
        },
        {
          provide: NaverBlogClient,
          useValue: naverBlogClient,
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
    naverBlogClient.searchBlogs.mockResolvedValue([]);
    kakaoLocalClient.searchByCategory.mockResolvedValue([]);
    dateCourseItemRepository.find.mockResolvedValue([]);
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
      region: {
        name: '서울',
      },
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
    expect(typeof result.recommendation.category).toBe('string');
    expect(result.recommendation.name).toBe('코엑스아쿠아리움');
    expect(result.recommendation.reason).toContain('실내 데이트로 좋은 장소');

    const firstSearchParams = naverLocalClient.searchLocal.mock.calls[0]?.[0];

    expect(firstSearchParams?.query).toContain('서울 삼성');
    expect(placeCacheRepository.upsert).toHaveBeenCalled();
  });

  it('prioritizes date-specific popup places for date recommendations', async () => {
    stationRepository.findOne.mockResolvedValue({
      id: 5,
      name: '삼성',
      lat: 37.5088,
      lng: 127.0631,
      region: {
        name: '서울',
      },
    });
    naverLocalClient.searchLocal.mockImplementation(async ({ query }) => {
      if (query.includes('2026년 7월 서울 삼성 팝업스토어')) {
        return [
          createNaverLocalItem({
            id: 500,
            title: '7월 18일 한정 팝업스토어',
            lat: 37.5089,
            lng: 127.0632,
            category: '문화,예술 > 팝업스토어',
            description: '7월 18일 하루만 운영하는 인기 팝업 이벤트',
          }),
        ];
      }

      return [
        createNaverLocalItem({
          id: 501,
          title: '평소 인기 많은 데이트 맛집',
          lat: 37.5089,
          lng: 127.0632,
          category: '음식점 > 양식',
          description: '분위기 좋은 데이트 맛집',
        }),
      ];
    });

    const result = await service.recommendPlaceByStationAndDate(
      5,
      '2026-07-18',
    );

    expect(result.recommendation.name).toBe('7월 18일 한정 팝업스토어');
    expect(result.recommendation.reason).toContain(
      '7월 18일 하루만 운영하는 인기 팝업 이벤트',
    );
    expect(naverLocalClient.searchLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        query: '2026년 7월 서울 삼성 팝업스토어',
      }),
    );
    expect(naverLocalClient.searchLocal).not.toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('놀거리'),
      }),
    );
    expect(naverLocalClient.searchLocal).not.toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('데이트 코스'),
      }),
    );
    // 추천 검색은 월(2026년 7월) 또는 날짜(7월 18일) 라벨이 붙은 쿼리만 사용한다.
    expect(
      naverLocalClient.searchLocal.mock.calls.every(
        ([params]) =>
          params.query.includes('2026년 7월') ||
          params.query.includes('7월 18일'),
      ),
    ).toBe(true);
  });

  it('excludes places already included in the date course from date recommendations', async () => {
    stationRepository.findOne.mockResolvedValue({
      id: 12,
      name: '성수',
      lat: 37.5446,
      lng: 127.0558,
      region: {
        name: '서울',
      },
    });
    naverLocalClient.searchLocal.mockImplementation(async ({ query }) => {
      if (!query.includes('팝업')) {
        return [];
      }

      return [
        createNaverLocalItem({
          id: 100,
          title: '이미 담긴 팝업',
          lat: 37.5447,
          lng: 127.0559,
          category: '문화,예술 > 팝업스토어',
          description: '2026년 6월 기간한정 팝업 이벤트',
        }),
        createNaverLocalItem({
          id: 101,
          title: '새로운 팝업',
          lat: 37.5448,
          lng: 127.056,
          category: '문화,예술 > 팝업스토어',
          description: '2026년 6월 기간한정 팝업 이벤트',
        }),
      ];
    });

    // 코스에 이미 담긴 장소는 placeKey 목록으로 전달돼 추천에서 제외된다.
    const result = await service.recommendPlaceByStationAndDate(
      12,
      '2026-06-05',
      'naver:100',
    );

    expect(result.recommendation.name).toBe('새로운 팝업');
  });

  it('discovers date event candidates from blogs and matches them with local places', async () => {
    stationRepository.findOne.mockResolvedValue({
      id: 8,
      name: '성수',
      lat: 37.5446,
      lng: 127.0558,
      region: {
        name: '서울',
      },
    });
    naverBlogClient.searchBlogs.mockImplementation(async ({ query }) => {
      if (query === '2026년 5월 서울 성수 팝업스토어') {
        return [
          {
            title: '2026년 5월 성수 아이모 20주년 기념 팝업 전시회 후기',
            link: 'https://blog.naver.com/test/1',
            description: '성수에서 열리는 5월 기간한정 팝업 전시',
            bloggername: 'blogger',
            bloggerlink: 'https://blog.naver.com/test',
            postdate: '20260501',
          },
        ];
      }

      return [];
    });
    naverLocalClient.searchLocal.mockImplementation(async ({ query }) => {
      if (query.includes('아이모 20주년 기념 팝업 전시회')) {
        return [
          createNaverLocalItem({
            id: 900,
            title: '아이모 20주년 기념 팝업 전시회',
            lat: 37.5447,
            lng: 127.0559,
            category: '문화,예술 > 전시',
            description: '아이모 20주년 팝업 전시',
          }),
        ];
      }

      return [];
    });

    const result = await service.recommendPlaceByStationAndDate(
      8,
      '2026-05-05',
    );

    expect(result.recommendation.name).toBe('아이모 20주년 기념 팝업 전시회');
    expect(result.recommendation.reason).toContain('아이모 20주년');
    expect(naverBlogClient.searchBlogs).toHaveBeenCalledWith(
      expect.objectContaining({
        query: '2026년 5월 서울 성수 팝업스토어',
        sort: 'date',
      }),
    );
    expect(naverLocalClient.searchLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('아이모 20주년 기념 팝업 전시회'),
      }),
    );
  });

  it('allows blog-discovered popup local matches even when local category is cafe', async () => {
    stationRepository.findOne.mockResolvedValue({
      id: 9,
      name: '성수',
      lat: 37.5446,
      lng: 127.0558,
      region: {
        name: '서울',
      },
    });
    naverBlogClient.searchBlogs.mockImplementation(async ({ query }) => {
      if (query === '2026년 6월 서울 성수 팝업스토어') {
        return [
          {
            title: '6월 성수 닥터지 팝업 본품 증정 이벤트 후기',
            link: 'https://blog.naver.com/test/2',
            description: '2026년 6월 성수에서 열리는 기간한정 팝업스토어',
            bloggername: 'blogger',
            bloggerlink: 'https://blog.naver.com/test',
            postdate: '20260601',
          },
        ];
      }

      return [];
    });
    naverLocalClient.searchLocal.mockImplementation(async ({ query }) => {
      if (query.includes('닥터지 팝업')) {
        return [
          createNaverLocalItem({
            id: 901,
            title: '닥터지 팝업',
            lat: 37.5447,
            lng: 127.0559,
            category: '카페,디저트',
            description: '닥터지 팝업 이벤트',
          }),
        ];
      }

      return [];
    });

    const result = await service.recommendPlaceByStationAndDate(
      9,
      '2026-06-05',
    );

    expect(result.recommendation.name).toBe('닥터지 팝업');
    expect(result.recommendation.type).toBe('ACTIVITY');
  });

  it('keeps a blog-discovered event candidate when local matching is unavailable', async () => {
    stationRepository.findOne.mockResolvedValue({
      id: 10,
      name: '성수',
      lat: 37.5446,
      lng: 127.0558,
      region: {
        name: '서울',
      },
    });
    naverBlogClient.searchBlogs.mockImplementation(async ({ query }) => {
      if (query === '2026년 6월 서울 성수 팝업스토어') {
        return [
          {
            title:
              '뿔바투 팝업 그냥 못 지나침 예약방법 디저트 라인업 굿즈 총정리',
            link: 'https://blog.naver.com/test/3',
            description:
              '2026년 6월 5일 성수역 3번 출구 앞에서 만난 기간한정 팝업 이벤트',
            bloggername: 'blogger',
            bloggerlink: 'https://blog.naver.com/test',
            postdate: '20260605',
          },
        ];
      }

      return [];
    });
    naverLocalClient.searchLocal.mockResolvedValue([]);

    const result = await service.recommendPlaceByStationAndDate(
      10,
      '2026-06-05',
    );

    expect(result.recommendation.name).toBe('뿔바투 팝업');
    expect(result.recommendation.type).toBe('ACTIVITY');
    expect(result.recommendation.lat).toBeNull();
    expect(result.recommendation.externalLink).toBe(
      'https://blog.naver.com/test/3',
    );
    expect(result.recommendation.reason).toContain('뿔바투 팝업');
  });

  it('prioritizes activity places over ordinary cafes and restaurants for date recommendations', async () => {
    stationRepository.findOne.mockResolvedValue({
      id: 6,
      name: '성수',
      lat: 37.5446,
      lng: 127.0558,
      region: {
        name: '서울',
      },
    });
    naverLocalClient.searchLocal.mockImplementation(async ({ query }) => {
      if (query.includes('전시') || query.includes('놀거리')) {
        return [
          createNaverLocalItem({
            id: 600,
            title: '성수 실내 전시 데이트 공간',
            lat: 37.5447,
            lng: 127.0559,
            category: '문화,예술 > 전시',
            description: '가볍게 들르기 좋은 전시 데이트 공간',
          }),
        ];
      }

      if (query.includes('요즘 인기 카페')) {
        return [
          createNaverLocalItem({
            id: 601,
            title: '성수 요즘 인기 신상 카페',
            lat: 37.5447,
            lng: 127.0559,
            category: '카페,디저트',
            description: '요즘 인기 많은 핫플 카페',
          }),
        ];
      }

      return [
        createNaverLocalItem({
          id: 602,
          title: '성수 분위기 좋은 데이트 맛집',
          lat: 37.5447,
          lng: 127.0559,
          category: '음식점 > 양식',
          description: '분위기 좋은 데이트 맛집',
        }),
      ];
    });

    const result = await service.recommendPlaceByStationAndDate(
      6,
      '2026-06-05',
    );

    expect(result.recommendation.type).toBe('ACTIVITY');
    expect(result.recommendation.name).toBe('성수 실내 전시 데이트 공간');
  });

  it('omits broad region names from date recommendation search queries', async () => {
    stationRepository.findOne.mockResolvedValue({
      id: 32,
      name: '성수',
      lat: 37.5445,
      lng: 127.0558,
      region: {
        name: '수도권',
      },
    });
    naverLocalClient.searchLocal.mockResolvedValue([
      createNaverLocalItem({
        id: 700,
        title: '성수 5월 한정 팝업 전시',
        lat: 37.5447,
        lng: 127.0559,
        category: '문화,예술 > 전시',
        description: '5월에 열리는 한정 팝업 전시',
      }),
    ]);

    await service.recommendPlaceByStationAndDate(32, '2026-05-05');

    expect(naverLocalClient.searchLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        query: '2026년 5월 성수역 팝업스토어',
      }),
    );
    expect(naverLocalClient.searchLocal).not.toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('수도권 성수'),
      }),
    );
  });

  it('falls back to broader non-date queries when date event searches return no candidates', async () => {
    stationRepository.findOne.mockResolvedValue({
      id: 7,
      name: '성수',
      lat: 37.5446,
      lng: 127.0558,
      region: {
        name: '서울',
      },
    });
    naverLocalClient.searchLocal.mockImplementation(async ({ query }) => {
      if (query.includes('실내 데이트')) {
        return [
          createNaverLocalItem({
            id: 800,
            title: '성수 실내 데이트 전시',
            lat: 37.5447,
            lng: 127.0559,
            category: '문화,예술 > 전시',
            description: '실내에서 보기 좋은 전시',
          }),
        ];
      }

      return [];
    });

    await service.recommendPlaceByStationAndDate(7, '2026-07-18');

    expect(naverLocalClient.searchLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        query: '2026년 7월 서울 성수 팝업스토어',
      }),
    );
    expect(naverLocalClient.searchLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        query: '서울 성수 실내 데이트',
      }),
    );
  });

  it('includes region name in place list search queries', async () => {
    stationRepository.findOne.mockResolvedValue({
      id: 2,
      name: '어린이세상',
      lat: 35.845,
      lng: 128.624,
      region: {
        name: '대구',
      },
    });
    naverLocalClient.searchLocal.mockResolvedValue([]);

    await service.findPlacesByStation(2, 'RESTAURANT');

    expect(naverLocalClient.searchLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        query: '대구 어린이세상 데이트 맛집',
      }),
    );
  });

  it('returns up to 40 nearby places for a station', async () => {
    stationRepository.findOne.mockResolvedValue({
      id: 3,
      name: '삼성',
      lat: 37.5088,
      lng: 127.0631,
      region: {
        name: '서울',
      },
    });

    let placeIndex = 0;
    naverLocalClient.searchLocal.mockImplementation(async () =>
      Array.from({ length: 5 }, () => {
        placeIndex += 1;

        return createNaverLocalItem({
          id: placeIndex,
          title: `데이트 맛집 ${placeIndex}`,
          lat: 37.5088 + placeIndex * 0.00001,
          lng: 127.0631 + placeIndex * 0.00001,
        });
      }),
    );

    const result = await service.findPlacesByStation(3, 'RESTAURANT');

    expect(result.places).toHaveLength(40);
    expect(result.places.every((place) => place.distanceMeters !== null)).toBe(
      true,
    );
    expect(result.places.every((place) => place.distanceMeters! <= 2_000)).toBe(
      true,
    );
  });

  it('filters out places outside the station distance limit', async () => {
    stationRepository.findOne.mockResolvedValue({
      id: 4,
      name: '삼성',
      lat: 37.5088,
      lng: 127.0631,
      region: {
        name: '서울',
      },
    });
    naverLocalClient.searchLocal.mockResolvedValue([
      createNaverLocalItem({
        id: 1,
        title: '가까운 데이트 맛집',
        lat: 37.5089,
        lng: 127.0632,
      }),
      createNaverLocalItem({
        id: 2,
        title: '먼 데이트 맛집',
        lat: 37.7,
        lng: 127.3,
      }),
    ]);

    const result = await service.findPlacesByStation(4, 'RESTAURANT');

    expect(result.places).toHaveLength(1);
    expect(result.places[0].name).toBe('가까운 데이트 맛집');
    expect(result.places[0].distanceMeters).toBeLessThanOrEqual(2_000);
  });

  it('prioritizes popup searches for activity place lists', async () => {
    stationRepository.findOne.mockResolvedValue({
      id: 11,
      name: '성수',
      lat: 37.5446,
      lng: 127.0558,
      region: {
        name: '서울',
      },
    });
    naverLocalClient.searchLocal.mockImplementation(async ({ query }) => {
      if (query.includes('팝업스토어')) {
        return [
          createNaverLocalItem({
            id: 1001,
            title: '성수 브랜드 팝업스토어',
            lat: 37.5447,
            lng: 127.0559,
            category: '카페,디저트',
            description: '성수에서 진행 중인 기간한정 팝업 이벤트',
          }),
        ];
      }

      if (query.includes('놀거리')) {
        return [
          createNaverLocalItem({
            id: 1002,
            title: '성수 일반 체험 공간',
            lat: 37.5448,
            lng: 127.056,
            category: '문화,예술 > 체험',
            description: '실내에서 즐기는 체험 공간',
          }),
        ];
      }

      return [];
    });

    const result = await service.findPlacesByStation(11, 'ACTIVITY');

    expect(naverLocalClient.searchLocal).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        query: expect.stringContaining('팝업스토어'),
      }),
    );
    expect(result.places[0].name).toBe('성수 브랜드 팝업스토어');
    expect(result.places[0].type).toBe('ACTIVITY');
  });
});

function createNaverLocalItem(params: {
  id: number;
  title: string;
  lat: number;
  lng: number;
  category?: string;
  description?: string;
}): NaverLocalItem {
  return {
    title: params.title,
    link: `https://map.naver.com/p/place/${params.id}`,
    category: params.category ?? '음식점 > 양식',
    description: params.description ?? '데이트하기 좋은 맛집',
    telephone: '02-000-0000',
    address: '서울 강남구 삼성동',
    roadAddress: `서울 강남구 테스트로 ${params.id}`,
    mapx: String(Math.round(params.lng * 10_000_000)),
    mapy: String(Math.round(params.lat * 10_000_000)),
  };
}
