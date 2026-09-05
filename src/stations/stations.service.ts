import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Region, SubwayEdge, SubwayStation, SubwayTransfer } from './entities';
import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  Repository,
} from 'typeorm';
import {
  buildTravelTimeGraph,
  ShortestTravelTimeSolver,
  UNREACHABLE,
} from './travel-time-graph';

/**
 * 한 번의 INSERT에 담을 행 수. 행을 열별 배열 3개로 넘겨 unnest()로 펼치므로
 * 바인딩 파라미터는 행 수와 무관하게 3개다. 문장 수를 줄이되 배열 하나가
 * 지나치게 커지지 않는 선에서 정했다.
 */
const INSERT_CHUNK_SIZE = 50_000;

/**
 * 재생성을 한 번에 하나만 돌리기 위한 PostgreSQL advisory lock 키.
 * 값 자체에 의미는 없고, 다른 기능과 겹치지 않는 고정값이면 된다.
 */
const REBUILD_LOCK_KEY = 4_210_871_001;

const INSERT_TRAVEL_TIME_CACHE_SQL = `
  INSERT INTO travel_time_cache (departure_station_id, arrival_station_id, min_travel_minutes)
  SELECT * FROM unnest($1::int[], $2::int[], $3::int[])
`;

@Injectable()
export class StationsService {
  private readonly logger = new Logger(StationsService.name);

  constructor(
    @InjectRepository(Region)
    private readonly regionRepository: Repository<Region>,

    @InjectRepository(SubwayStation)
    private readonly stationRepository: Repository<SubwayStation>,

    @InjectRepository(SubwayEdge)
    private readonly edgeRepository: Repository<SubwayEdge>,

    @InjectRepository(SubwayTransfer)
    private readonly transferRepository: Repository<SubwayTransfer>,

    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findRegions() {
    const regions = await this.regionRepository.find({
      order: {
        id: 'ASC',
      },
    });

    return regions.map((region) => ({
      id: region.id,
      name: region.name,
      code: region.code,
    }));
  }

  async findAll(regionCode?: string) {
    const where: FindOptionsWhere<SubwayStation> | undefined = regionCode
      ? {
          region: {
            code: regionCode.toUpperCase(),
          },
        }
      : undefined;

    const stations = await this.stationRepository.find({
      where,
      relations: {
        region: true,
        stationLines: {
          line: true,
        },
      },
      order: {
        id: 'ASC',
      },
    });

    return stations.map((station) => ({
      id: station.id,
      name: station.name,
      lat: station.lat,
      lng: station.lng,
      weightGrade: station.weightGrade,
      placeCount: station.placeCount,
      region: station.region
        ? {
            id: station.region.id,
            name: station.region.name,
            code: station.region.code,
          }
        : null,
      lines: station.stationLines.map((stationLine) => ({
        id: stationLine.line.id,
        name: stationLine.line.name,
        color: stationLine.line.color,
        regionId: stationLine.line.regionId,
      })),
    }));
  }

  async stationExists(stationId: number): Promise<boolean> {
    return this.stationRepository.exists({ where: { id: stationId } });
  }

  async findRegionByCode(regionCode: string): Promise<Region | null> {
    return this.regionRepository.findOne({
      where: { code: regionCode.toUpperCase() },
    });
  }

  async findStationById(stationId: number): Promise<SubwayStation | null> {
    return this.stationRepository.findOne({ where: { id: stationId } });
  }

  /**
   * 역·노선 데이터로 모든 (출발역, 도착역) 쌍의 최단 이동시간을 다시 계산해 캐시를 채운다.
   *
   * 지우기와 채우기를 한 트랜잭션에서 하므로 커밋 전까지 다른 요청은 이전 캐시를 그대로 읽는다(MVCC).
   * 그래서 재생성 중에도 역 추천이 비거나 일부만 찬 캐시를 보지 않고, 도중에 실패하면 이전 캐시가 남는다.
   * TRUNCATE는 ACCESS EXCLUSIVE 락을 잡아 커밋까지 읽기를 막으므로 DELETE를 쓴다.
   *
   * region을 주면 그 지역 역에서 출발하는 행만 다시 계산한다. 결과는 전체 재생성에서
   * 같은 출발역에 대해 만들어지는 행과 같다.
   */
  async rebuildTravelTimeCache(regionCode?: string) {
    const normalizedRegionCode = regionCode?.toUpperCase();
    const where: FindOptionsWhere<SubwayStation> | undefined =
      normalizedRegionCode
        ? {
            region: {
              code: normalizedRegionCode,
            },
          }
        : undefined;
    // 아래 계산은 역 ID만 쓰므로 region 관계는 조인하지 않는다.
    const stations = await this.stationRepository.find({
      where,
      select: { id: true },
    });

    if (normalizedRegionCode && stations.length === 0) {
      throw new BadRequestException('지역에 해당하는 역을 찾을 수 없습니다.');
    }

    const edges = await this.edgeRepository.find();
    const transfers = await this.transferRepository.find();

    this.logger.log(
      `이동시간 캐시 재생성 시작: region=${normalizedRegionCode ?? 'ALL'}, stations=${stations.length}, edges=${edges.length}, transfers=${transfers.length}`,
    );

    const graph = buildTravelTimeGraph(edges, transfers);
    const solver = new ShortestTravelTimeSolver(graph);
    const { stationIds } = graph;
    const departureStationIds = stations.map((station) => station.id);

    const cacheCount = await this.dataSource.transaction(async (manager) => {
      await this.acquireRebuildLock(manager);

      if (normalizedRegionCode) {
        await manager.query(
          'DELETE FROM travel_time_cache WHERE departure_station_id = ANY($1::int[])',
          [departureStationIds],
        );
      } else {
        await manager.query('DELETE FROM travel_time_cache');
      }

      // 캐시는 역 수의 제곱만큼 늘어나므로 전부 모으지 않고 조금씩 흘려보낸다.
      let departures: number[] = [];
      let arrivals: number[] = [];
      let minutes: number[] = [];
      let insertedCount = 0;

      const flush = async () => {
        if (departures.length === 0) {
          return;
        }

        // 위에서 비워둔 구간만 채우므로 save()의 존재 확인 없이 곧장 INSERT한다.
        await manager.query(INSERT_TRAVEL_TIME_CACHE_SQL, [
          departures,
          arrivals,
          minutes,
        ]);

        insertedCount += departures.length;
        departures = [];
        arrivals = [];
        minutes = [];
      };

      for (const departureStationId of departureStationIds) {
        const minutesByStationIndex = solver.solveFrom(departureStationId);

        for (let i = 0; i < stationIds.length; i++) {
          const minTravelMinutes = minutesByStationIndex[i];

          if (minTravelMinutes === UNREACHABLE) {
            continue;
          }

          departures.push(departureStationId);
          arrivals.push(stationIds[i]);
          minutes.push(minTravelMinutes);

          if (departures.length >= INSERT_CHUNK_SIZE) {
            await flush();
          }
        }
      }

      await flush();

      // 행이 통째로 바뀌었으므로 커밋과 함께 플래너 통계도 새로 반영한다.
      // (지운 행은 autovacuum이 정리한다)
      await manager.query('ANALYZE travel_time_cache');

      return insertedCount;
    });

    this.logger.log(`이동시간 캐시 재생성 완료: rows=${cacheCount}`);

    return {
      region: normalizedRegionCode ?? null,
      stationCount: stations.length,
      cacheCount,
    };
  }

  /**
   * 트랜잭션 단위 advisory lock이라 커밋·롤백 시 자동으로 풀리고, 프로세스가 죽어도 남지 않는다.
   * 인스턴스가 여러 대여도 DB 하나를 기준으로 막는다.
   */
  private async acquireRebuildLock(manager: EntityManager) {
    const [{ locked }] = await manager.query<{ locked: boolean }[]>(
      'SELECT pg_try_advisory_xact_lock($1::bigint) AS locked',
      [REBUILD_LOCK_KEY],
    );

    if (!locked) {
      throw new ConflictException('이동시간 캐시 재생성이 이미 진행 중입니다.');
    }
  }
}
