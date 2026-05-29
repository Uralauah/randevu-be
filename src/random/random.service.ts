import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CreateRandomSubwayDto } from './dto/create-random-subway.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { RandomResult } from './entities';
import { Repository } from 'typeorm';
import { TravelTimeCache } from '../stations/entities';

const WEIGHT_BY_GRADE: Record<string, number> = {
  A: 100,
  B: 70,
  C: 40,
  D: 10,
};

@Injectable()
export class RandomService {
  private readonly logger = new Logger(RandomService.name);

  constructor(
    @InjectRepository(RandomResult)
    private readonly randomResultRepository: Repository<RandomResult>,

    @InjectRepository(TravelTimeCache)
    private readonly travelTimeCacheRepository: Repository<TravelTimeCache>,
  ) {}

  async createSubwayRandom(dto: CreateRandomSubwayDto) {
    this.logger.log(`랜덤 요청: ${JSON.stringify(dto)}`);
    const reachableStations = await this.findReachableStations(dto);

    this.logger.log(`도달 가능한 역 개수: ${reachableStations.length}`);
    const candidates = this.filterCandidates(reachableStations, dto);

    this.logger.log(`필터링 후 후보 역 개수: ${candidates.length}`);

    if (candidates.length == 0) {
      this.logger.warn(
        `후보 역 없음: departureStationId=${dto.departureStationId}, maxMinutes=${dto.maxMinutes}`,
      );
      throw new BadRequestException('조건에 맞는 역이 없습니다.');
    }

    this.logger.debug(
      `후보 역 목록: ${candidates
        .map(
          (item) =>
            `${item.arrivalStation.name}(${item.minTravelMinutes}분/${item.arrivalStation.weightGrade})`,
        )
        .join(', ')}`,
    );

    const picked = this.pickWeightedStation(candidates);

    // const randomResult = await this.randomResultRepository.save({
    //     userId: null,
    // })

    return {
      randomResultId: null,
      resultStation: {
        id: picked.arrivalStation.id,
        name: picked.arrivalStation.name,
        lat: picked.arrivalStation.lat,
        lng: picked.arrivalStation.lng,
        weightGrade: picked.arrivalStation.weightGrade,
        placeCount: picked.arrivalStation.placeCount,
        travelMinutes: picked.minTravelMinutes,
        lines: picked.arrivalStation.stationLines.map((stationLine) => ({
          id: stationLine.line.id,
          name: stationLine.line.name,
          color: stationLine.line.color,
        })),
      },
    };
  }

  private findReachableStations(dto: CreateRandomSubwayDto) {
    return this.travelTimeCacheRepository
      .createQueryBuilder('cache')
      .innerJoinAndSelect('cache.arrivalStation', 'station')
      .leftJoinAndSelect('station.stationLines', 'stationLine')
      .leftJoinAndSelect('stationLine.line', 'line')
      .where('cache.departureStationId = :departureStationId', {
        departureStationId: dto.departureStationId,
      })
      .andWhere('cache.minTravelMinutes <= :maxMinutes', {
        maxMinutes: dto.maxMinutes,
      })
      .getMany();
  }

  private filterCandidates(
    reachableStations: TravelTimeCache[],
    dto: CreateRandomSubwayDto,
  ) {
    const excludeStationIds = new Set(dto.excludeStationIds ?? []);

    return reachableStations.filter((item) => {
      if (item.arrivalStationId === dto.departureStationId) {
        return false;
      }

      if (excludeStationIds.has(item.arrivalStationId)) {
        return false;
      }

      return true;
    });
  }

  private pickWeightedStation(candidates: TravelTimeCache[]) {
    const totalWeight = candidates.reduce((sum, item) => {
      return sum + this.getStationWeight(item.arrivalStation.weightGrade);
    }, 0);

    let random = Math.random() * totalWeight;

    for (const item of candidates) {
      random -= this.getStationWeight(item.arrivalStation.weightGrade);

      if (random <= 0) return item;
    }

    return candidates[candidates.length - 1];
  }

  private getStationWeight(weightGrade: string) {
    return WEIGHT_BY_GRADE[weightGrade] ?? WEIGHT_BY_GRADE.D;
  }
}
