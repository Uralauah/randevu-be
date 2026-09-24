import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CreateRandomSubwayDto } from './dto/create-random-subway.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TravelTimeCache } from '../stations/entities';
import {
  CatalogStation,
  StationCatalog,
  StationCatalogService,
} from '../stations/station-catalog.service';

const WEIGHT_BY_GRADE: Record<string, number> = {
  A: 100,
  B: 70,
  C: 40,
  D: 10,
};

interface ReachableStationRow {
  arrivalStationId: number;
  minTravelMinutes: number;
}

interface Candidate {
  station: CatalogStation;
  minTravelMinutes: number;
}

@Injectable()
export class RandomService {
  private readonly logger = new Logger(RandomService.name);

  constructor(
    @InjectRepository(TravelTimeCache)
    private readonly travelTimeCacheRepository: Repository<TravelTimeCache>,

    private readonly stationCatalog: StationCatalogService,
  ) {}

  async createSubwayRandom(dto: CreateRandomSubwayDto) {
    const catalog = await this.stationCatalog.getCatalog();
    const reachableStations = catalog.byId.has(dto.departureStationId)
      ? await this.findReachableStations(dto)
      : [];
    const candidates = this.filterCandidates(reachableStations, dto, catalog);

    this.logger.debug(
      `랜덤 요청: departureStationId=${dto.departureStationId}, maxMinutes=${dto.maxMinutes}, reachable=${reachableStations.length}, candidates=${candidates.length}`,
    );

    if (candidates.length == 0) {
      this.logger.warn(
        `후보 역 없음: departureStationId=${dto.departureStationId}, maxMinutes=${dto.maxMinutes}`,
      );
      throw new BadRequestException('조건에 맞는 역이 없습니다.');
    }

    const picked = this.pickWeightedStation(candidates);

    return {
      randomResultId: null,
      resultStation: {
        id: picked.station.id,
        name: picked.station.name,
        lat: picked.station.lat,
        lng: picked.station.lng,
        weightGrade: picked.station.weightGrade,
        placeCount: picked.station.placeCount,
        travelMinutes: picked.minTravelMinutes,
        vibeText: picked.station.vibeText,
        lines: picked.station.lines.map((line) => ({
          id: line.id,
          name: line.name,
          color: line.color,
        })),
      },
    };
  }

  /**
   * 후보를 고르는 데는 도착역 ID와 이동시간만 있으면 된다. (출발역, 이동시간) 인덱스 범위 조회로
   * 정수 두 개만 읽고, 역 이름·노선 같은 메타데이터는 메모리 카탈로그에서 붙인다.
   * 예전에는 후보 수백 개를 역·노선과 조인해 엔티티로 만든 뒤 하나만 썼다.
   */
  private findReachableStations(
    dto: CreateRandomSubwayDto,
  ): Promise<ReachableStationRow[]> {
    return this.travelTimeCacheRepository
      .createQueryBuilder('cache')
      .select('cache.arrivalStationId', 'arrivalStationId')
      .addSelect('cache.minTravelMinutes', 'minTravelMinutes')
      .where('cache.departureStationId = :departureStationId', {
        departureStationId: dto.departureStationId,
      })
      .andWhere('cache.minTravelMinutes <= :maxMinutes', {
        maxMinutes: dto.maxMinutes,
      })
      .getRawMany<ReachableStationRow>();
  }

  private filterCandidates(
    reachableStations: ReachableStationRow[],
    dto: CreateRandomSubwayDto,
    catalog: StationCatalog,
  ): Candidate[] {
    const departureStation = catalog.byId.get(dto.departureStationId);
    const excludeStationIds = new Set(dto.excludeStationIds ?? []);
    const candidates: Candidate[] = [];

    if (!departureStation) {
      return candidates;
    }

    for (const row of reachableStations) {
      if (row.arrivalStationId === dto.departureStationId) {
        continue;
      }

      if (excludeStationIds.has(row.arrivalStationId)) {
        continue;
      }

      const station = catalog.byId.get(row.arrivalStationId);

      // 다른 지역 노선망의 역은 추천하지 않는다.
      if (!station || station.regionId !== departureStation.regionId) {
        continue;
      }

      candidates.push({ station, minTravelMinutes: row.minTravelMinutes });
    }

    return candidates;
  }

  private pickWeightedStation(candidates: Candidate[]) {
    const totalWeight = candidates.reduce((sum, item) => {
      return sum + this.getStationWeight(item.station.weightGrade);
    }, 0);

    let random = Math.random() * totalWeight;

    for (const item of candidates) {
      random -= this.getStationWeight(item.station.weightGrade);

      if (random <= 0) return item;
    }

    return candidates[candidates.length - 1];
  }

  private getStationWeight(weightGrade: string) {
    return WEIGHT_BY_GRADE[weightGrade] ?? WEIGHT_BY_GRADE.D;
  }
}
