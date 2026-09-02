import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Region,
  SubwayEdge,
  SubwayStation,
  SubwayTransfer,
  TravelTimeCache,
} from './entities';
import { FindOptionsWhere, Repository } from 'typeorm';
import {
  buildTravelTimeGraph,
  ShortestTravelTimeSolver,
  UNREACHABLE,
} from './travel-time-graph';

interface TravelTimeCacheRow {
  departureStationId: number;
  arrivalStationId: number;
  minTravelMinutes: number;
}

/**
 * 한 번의 INSERT에 담을 행 수. 열이 3개이므로 5000행이면 바인딩 파라미터 15,000개로,
 * PostgreSQL 한도(65,535)에 여유가 있다.
 */
const INSERT_CHUNK_SIZE = 5000;

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

    @InjectRepository(TravelTimeCache)
    private readonly travelTimeCacheRepository: Repository<TravelTimeCache>,
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
    const regionStationIds = normalizedRegionCode
      ? new Set(stations.map((station) => station.id))
      : null;

    this.logger.log(
      `이동시간 캐시 재생성 시작: region=${normalizedRegionCode ?? 'ALL'}, stations=${stations.length}, edges=${edges.length}, transfers=${transfers.length}`,
    );

    const graph = buildTravelTimeGraph(edges, transfers);
    const solver = new ShortestTravelTimeSolver(graph);
    const { stationIds } = graph;

    if (regionStationIds) {
      await this.clearTravelTimeCacheByStationIds([...regionStationIds]);
    } else {
      await this.travelTimeCacheRepository.clear();
    }

    // 캐시는 역 수의 제곱만큼 늘어나므로 전부 모으지 않고 조금씩 흘려보낸다.
    let pendingRows: TravelTimeCacheRow[] = [];
    let cacheCount = 0;

    const flushPendingRows = async () => {
      if (pendingRows.length === 0) {
        return;
      }

      // 위에서 비워둔 구간만 채우므로 save()의 존재 확인 없이 곧장 INSERT한다.
      await this.travelTimeCacheRepository.insert(pendingRows);

      cacheCount += pendingRows.length;
      pendingRows = [];
    };

    for (const station of stations) {
      const minutesByStationIndex = solver.solveFrom(station.id);

      for (let i = 0; i < stationIds.length; i++) {
        const minTravelMinutes = minutesByStationIndex[i];

        if (minTravelMinutes === UNREACHABLE) {
          continue;
        }

        const arrivalStationId = stationIds[i];

        if (regionStationIds && !regionStationIds.has(arrivalStationId)) {
          continue;
        }

        pendingRows.push({
          departureStationId: station.id,
          arrivalStationId,
          minTravelMinutes,
        });

        if (pendingRows.length >= INSERT_CHUNK_SIZE) {
          await flushPendingRows();
        }
      }
    }

    await flushPendingRows();

    this.logger.log(`이동시간 캐시 재설정 완료: rows=${cacheCount}`);

    return {
      region: normalizedRegionCode ?? null,
      stationCount: stations.length,
      cacheCount,
    };
  }

  private async clearTravelTimeCacheByStationIds(stationIds: number[]) {
    if (stationIds.length === 0) {
      return;
    }

    await this.travelTimeCacheRepository
      .createQueryBuilder()
      .delete()
      .where('departure_station_id IN (:...stationIds)', { stationIds })
      .orWhere('arrival_station_id IN (:...stationIds)', { stationIds })
      .execute();
  }
}
