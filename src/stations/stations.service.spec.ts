import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { StationsService } from './stations.service';
import { Region, SubwayEdge, SubwayStation, SubwayTransfer } from './entities';

/**
 * 테스트용 노선도
 *
 *   1호선: 역1 --2분-- 역2 --3분-- 역3
 *   2호선: 역2 --10분-- 역4
 *   3호선: 역1 --20분-- 역4
 *   환승  : 역2에서 1호선 <-> 2호선 (기본 5분)
 *
 * 역1 -> 역4 경로는 두 가지다.
 *   (a) 1호선으로 역2(2분) + 환승(5분) + 2호선으로 역4(10분) = 17분
 *   (b) 3호선 직통 = 20분
 */
const buildEdges = (): SubwayEdge[] => {
  const raw = [
    { fromStationId: 1, toStationId: 2, lineId: 1, travelMinutes: 2 },
    { fromStationId: 2, toStationId: 3, lineId: 1, travelMinutes: 3 },
    { fromStationId: 2, toStationId: 4, lineId: 2, travelMinutes: 10 },
    { fromStationId: 1, toStationId: 4, lineId: 3, travelMinutes: 20 },
  ];

  return raw.flatMap((edge) => [
    edge,
    {
      fromStationId: edge.toStationId,
      toStationId: edge.fromStationId,
      lineId: edge.lineId,
      travelMinutes: edge.travelMinutes,
    },
  ]) as SubwayEdge[];
};

const buildTransfers = (transferMinutes: number): SubwayTransfer[] =>
  [
    { stationId: 2, fromLineId: 1, toLineId: 2, transferMinutes },
    { stationId: 2, fromLineId: 2, toLineId: 1, transferMinutes },
  ] as SubwayTransfer[];

const buildStations = (): SubwayStation[] =>
  [1, 2, 3, 4].map((id) => ({ id })) as SubwayStation[];

interface CacheRow {
  departureStationId: number;
  arrivalStationId: number;
  minTravelMinutes: number;
}

describe('StationsService - 이동시간 캐시 재생성', () => {
  /**
   * 트랜잭션 안에서 실행된 SQL을 순서대로 기록하고, INSERT로 넘어온 열별 배열을
   * 다시 행으로 펼쳐 둔다. 실제 DB 동작(MVCC, 락)은 통합 검증에서 따로 확인한다.
   */
  const createService = async (options: {
    stations?: SubwayStation[];
    edges?: SubwayEdge[];
    transfers?: SubwayTransfer[];
    lockAvailable?: boolean;
  }) => {
    const savedRows: CacheRow[] = [];
    const executedSql: string[] = [];
    const deleteParams: unknown[][] = [];

    const manager = {
      query: jest.fn((sql: string, params: unknown[] = []) => {
        const statement = sql.trim().replace(/\s+/g, ' ');
        executedSql.push(statement);

        if (statement.includes('pg_try_advisory_xact_lock')) {
          return Promise.resolve([{ locked: options.lockAvailable ?? true }]);
        }

        if (statement.startsWith('DELETE')) {
          deleteParams.push(params);
        }

        if (statement.startsWith('INSERT')) {
          const [departures, arrivals, minutes] = params as number[][];

          departures.forEach((departureStationId, i) =>
            savedRows.push({
              departureStationId,
              arrivalStationId: arrivals[i],
              minTravelMinutes: minutes[i],
            }),
          );
        }

        return Promise.resolve([]);
      }),
    };

    const dataSource = {
      transaction: jest.fn((work: (m: typeof manager) => Promise<unknown>) =>
        work(manager),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        StationsService,
        {
          provide: getRepositoryToken(Region),
          useValue: { find: jest.fn(), findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(SubwayStation),
          useValue: {
            find: jest.fn().mockResolvedValue(options.stations ?? []),
          },
        },
        {
          provide: getRepositoryToken(SubwayEdge),
          useValue: { find: jest.fn().mockResolvedValue(options.edges ?? []) },
        },
        {
          provide: getRepositoryToken(SubwayTransfer),
          useValue: {
            find: jest.fn().mockResolvedValue(options.transfers ?? []),
          },
        },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    return {
      service: moduleRef.get(StationsService),
      savedRows,
      executedSql,
      deleteParams,
      dataSource,
    };
  };

  const minutesBetween = (
    rows: CacheRow[],
    departureStationId: number,
    arrivalStationId: number,
  ) =>
    rows.find(
      (row) =>
        row.departureStationId === departureStationId &&
        row.arrivalStationId === arrivalStationId,
    )?.minTravelMinutes;

  it('같은 노선 구간의 소요시간을 누적한다', async () => {
    const { service, savedRows } = await createService({
      stations: buildStations(),
      edges: buildEdges(),
      transfers: buildTransfers(5),
    });

    await service.rebuildTravelTimeCache();

    expect(minutesBetween(savedRows, 1, 2)).toBe(2);
    expect(minutesBetween(savedRows, 1, 3)).toBe(5);
  });

  it('출발역 자기 자신까지는 0분이다', async () => {
    const { service, savedRows } = await createService({
      stations: buildStations(),
      edges: buildEdges(),
      transfers: buildTransfers(5),
    });

    await service.rebuildTravelTimeCache();

    expect(minutesBetween(savedRows, 1, 1)).toBe(0);
  });

  it('환승 시간을 포함해 더 빠른 경로를 고른다', async () => {
    const { service, savedRows } = await createService({
      stations: buildStations(),
      edges: buildEdges(),
      transfers: buildTransfers(5),
    });

    await service.rebuildTravelTimeCache();

    // 2 + 5(환승) + 10 = 17분 < 3호선 직통 20분
    expect(minutesBetween(savedRows, 1, 4)).toBe(17);
  });

  it('환승 시간이 비싸면 직통 경로를 고른다', async () => {
    const { service, savedRows } = await createService({
      stations: buildStations(),
      edges: buildEdges(),
      transfers: buildTransfers(30),
    });

    await service.rebuildTravelTimeCache();

    // 2 + 30(환승) + 10 = 42분 > 3호선 직통 20분
    expect(minutesBetween(savedRows, 1, 4)).toBe(20);
  });

  it('출발역에서는 환승 비용을 물리지 않는다', async () => {
    const { service, savedRows } = await createService({
      stations: buildStations(),
      edges: buildEdges(),
      transfers: buildTransfers(30),
    });

    await service.rebuildTravelTimeCache();

    // 역2는 1·2호선 모두에 속하지만 출발역이므로 두 노선 노드 모두 0분에서 시작한다
    expect(minutesBetween(savedRows, 2, 4)).toBe(10);
    expect(minutesBetween(savedRows, 2, 3)).toBe(3);
  });

  it('도달할 수 없는 역은 캐시에 넣지 않는다', async () => {
    const { service, savedRows } = await createService({
      stations: [...buildStations(), { id: 99 } as SubwayStation],
      edges: buildEdges(),
      transfers: buildTransfers(5),
    });

    await service.rebuildTravelTimeCache();

    expect(minutesBetween(savedRows, 1, 99)).toBeUndefined();
    expect(savedRows.some((row) => row.departureStationId === 99)).toBe(false);
  });

  it('모든 역 쌍에 대해 대칭이다', async () => {
    const { service, savedRows } = await createService({
      stations: buildStations(),
      edges: buildEdges(),
      transfers: buildTransfers(5),
    });

    await service.rebuildTravelTimeCache();

    for (const row of savedRows) {
      expect(
        minutesBetween(savedRows, row.arrivalStationId, row.departureStationId),
      ).toBe(row.minTravelMinutes);
    }
  });

  it('지우기와 채우기를 한 트랜잭션에서 하고, TRUNCATE 대신 DELETE를 쓴다', async () => {
    const { service, executedSql, dataSource } = await createService({
      stations: buildStations(),
      edges: buildEdges(),
      transfers: buildTransfers(5),
    });

    await service.rebuildTravelTimeCache();

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(executedSql[0]).toContain('pg_try_advisory_xact_lock');
    expect(executedSql[1]).toBe('DELETE FROM travel_time_cache');
    expect(
      executedSql.slice(2, -1).every((sql) => sql.startsWith('INSERT')),
    ).toBe(true);
    expect(executedSql.at(-1)).toBe('ANALYZE travel_time_cache');
    expect(executedSql.some((sql) => sql.includes('TRUNCATE'))).toBe(false);
  });

  it('이미 재생성 중이면 409를 던지고 캐시를 건드리지 않는다', async () => {
    const { service, executedSql } = await createService({
      stations: buildStations(),
      edges: buildEdges(),
      transfers: buildTransfers(5),
      lockAvailable: false,
    });

    await expect(service.rebuildTravelTimeCache()).rejects.toThrow(
      ConflictException,
    );
    expect(executedSql.some((sql) => sql.startsWith('DELETE'))).toBe(false);
    expect(executedSql.some((sql) => sql.startsWith('INSERT'))).toBe(false);
  });

  it('지역 재생성은 그 지역 출발 행만 지우고, 전체 재생성과 같은 행을 만든다', async () => {
    const full = await createService({
      stations: buildStations(),
      edges: buildEdges(),
      transfers: buildTransfers(5),
    });
    await full.service.rebuildTravelTimeCache();

    const regionStations = [1, 2].map((id) => ({ id })) as SubwayStation[];
    const region = await createService({
      stations: regionStations,
      edges: buildEdges(),
      transfers: buildTransfers(5),
    });
    await region.service.rebuildTravelTimeCache('seoul');

    expect(region.executedSql[1]).toBe(
      'DELETE FROM travel_time_cache WHERE departure_station_id = ANY($1::int[])',
    );
    expect(region.deleteParams[0]).toEqual([[1, 2]]);
    expect(region.savedRows).toEqual(
      full.savedRows.filter((row) => [1, 2].includes(row.departureStationId)),
    );
  });
});
