import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { TravelTimeCache } from '../stations/entities';
import {
  CatalogStation,
  StationCatalog,
  StationCatalogService,
} from '../stations/station-catalog.service';
import { RandomService } from './random.service';

const station = (
  id: number,
  overrides: Partial<CatalogStation> = {},
): CatalogStation => ({
  id,
  name: `역${id}`,
  lat: 37.5,
  lng: 127,
  weightGrade: 'C',
  placeCount: 0,
  region: { id: 1, name: '수도권', code: 'SEOUL' },
  regionId: 1,
  vibeText: null,
  lines: [{ id: 2, name: '2호선', color: '#00A84D', regionId: 1 }],
  ...overrides,
});

const createCatalog = (stations: CatalogStation[]): StationCatalog => ({
  byId: new Map(stations.map((item) => [item.id, item])),
  listItems: stations,
  listItemsByRegionCode: new Map(),
});

describe('RandomService', () => {
  let getRawMany: jest.Mock;
  let createQueryBuilder: jest.Mock;
  let service: RandomService;

  const setUp = (
    stations: CatalogStation[],
    rows: { arrivalStationId: number; minTravelMinutes: number }[],
  ) => {
    getRawMany = jest.fn().mockResolvedValue(rows);
    const queryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany,
    };
    createQueryBuilder = jest.fn().mockReturnValue(queryBuilder);

    service = new RandomService(
      { createQueryBuilder } as unknown as Repository<TravelTimeCache>,
      {
        getCatalog: jest.fn().mockResolvedValue(createCatalog(stations)),
      } as unknown as StationCatalogService,
    );
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('같은 지역의 도달 가능한 역 중에서 고르고, 카탈로그 정보로 응답한다', async () => {
    setUp(
      [
        station(1),
        station(2, { regionId: 3 }),
        station(3, { name: '혜화', vibeText: '대학로' }),
      ],
      [
        { arrivalStationId: 1, minTravelMinutes: 0 },
        { arrivalStationId: 2, minTravelMinutes: 10 },
        { arrivalStationId: 3, minTravelMinutes: 12 },
      ],
    );

    const result = await service.createSubwayRandom({
      departureStationId: 1,
      maxMinutes: 40,
      deviceId: 'device',
    });

    expect(result).toEqual({
      randomResultId: null,
      resultStation: {
        id: 3,
        name: '혜화',
        lat: 37.5,
        lng: 127,
        weightGrade: 'C',
        placeCount: 0,
        travelMinutes: 12,
        vibeText: '대학로',
        lines: [{ id: 2, name: '2호선', color: '#00A84D' }],
      },
    });
  });

  it('제외한 역과 카탈로그에 없는 역은 후보에서 뺀다', async () => {
    setUp(
      [station(1), station(2), station(3)],
      [
        { arrivalStationId: 2, minTravelMinutes: 5 },
        { arrivalStationId: 3, minTravelMinutes: 6 },
        { arrivalStationId: 99, minTravelMinutes: 7 },
      ],
    );

    const result = await service.createSubwayRandom({
      departureStationId: 1,
      maxMinutes: 20,
      excludeStationIds: [2],
      deviceId: 'device',
    });

    expect(result.resultStation.id).toBe(3);
  });

  it('등급 가중치에 비례해 고른다', async () => {
    setUp(
      [
        station(1),
        station(2, { weightGrade: 'D' }),
        station(3, { weightGrade: 'A' }),
      ],
      [
        { arrivalStationId: 2, minTravelMinutes: 5 },
        { arrivalStationId: 3, minTravelMinutes: 6 },
      ],
    );
    const dto = { departureStationId: 1, maxMinutes: 20, deviceId: 'device' };

    // 전체 가중치 110(D 10 + A 100) 중 앞쪽 10까지는 D, 나머지는 A
    jest.spyOn(Math, 'random').mockReturnValue(0.05);
    expect((await service.createSubwayRandom(dto)).resultStation.id).toBe(2);

    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    expect((await service.createSubwayRandom(dto)).resultStation.id).toBe(3);
  });

  it('카탈로그에 없는 출발역이면 DB를 조회하지 않고 400을 던진다', async () => {
    setUp([station(1)], []);

    await expect(
      service.createSubwayRandom({
        departureStationId: 404,
        maxMinutes: 20,
        deviceId: 'device',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(createQueryBuilder).not.toHaveBeenCalled();
  });

  it('조건에 맞는 역이 없으면 400을 던진다', async () => {
    setUp([station(1)], [{ arrivalStationId: 1, minTravelMinutes: 0 }]);

    await expect(
      service.createSubwayRandom({
        departureStationId: 1,
        maxMinutes: 20,
        deviceId: 'device',
      }),
    ).rejects.toThrow('조건에 맞는 역이 없습니다.');
  });
});
