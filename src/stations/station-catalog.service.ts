import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TtlLruCache } from '../common/ttl-lru-cache';
import { SubwayStation } from './entities';

/**
 * 역·노선 데이터는 데이터 반영(이동시간 캐시 재생성과 함께) 때만 바뀐다.
 * 같은 프로세스에서 재생성하면 바로 무효화하고, 다른 프로세스(CLI)나 DB를 직접 고친 경우는
 * 이 시간이 지나면 다시 읽는다.
 */
const STATION_CATALOG_TTL_MS = 10 * 60 * 1000;

export interface StationLineSummary {
  id: number;
  name: string;
  color: string | null;
  regionId: number;
}

/** GET /stations 응답의 역 항목 */
export interface StationListItem {
  id: number;
  name: string;
  lat: number | null;
  lng: number | null;
  weightGrade: string;
  placeCount: number;
  region: { id: number; name: string; code: string } | null;
  lines: StationLineSummary[];
}

export interface CatalogStation extends StationListItem {
  regionId: number;
  vibeText: string | null;
}

export interface StationCatalog {
  byId: ReadonlyMap<number, CatalogStation>;
  /** id 오름차순 목록. 응답에 그대로 쓰므로 호출자는 고치지 말아야 한다. */
  listItems: readonly StationListItem[];
  listItemsByRegionCode: ReadonlyMap<string, readonly StationListItem[]>;
}

/**
 * 역·노선 메타데이터를 메모리에 올려 두고 공유한다.
 *
 * 역 목록 API와 역 추천 API는 요청마다 수백 개 역을 노선과 조인해 엔티티로 만들었는데,
 * 부하 테스트에서 CPU의 절반 이상이 이 변환(TypeORM 엔티티 조립)에 쓰였다.
 * 데이터는 거의 바뀌지 않으므로 한 번 읽어 응답 형태로 만들어 두고 재사용한다.
 */
@Injectable()
export class StationCatalogService {
  private readonly cache = new TtlLruCache<'catalog', StationCatalog>({
    maxEntries: 1,
    ttlMs: STATION_CATALOG_TTL_MS,
  });

  constructor(
    @InjectRepository(SubwayStation)
    private readonly stationRepository: Repository<SubwayStation>,
  ) {}

  getCatalog(): Promise<StationCatalog> {
    return this.cache.getOrLoad('catalog', () => this.load());
  }

  /** 역·노선 데이터가 바뀌었을 때 다음 요청에서 다시 읽게 한다. */
  invalidate() {
    this.cache.delete('catalog');
  }

  private async load(): Promise<StationCatalog> {
    const stations = await this.stationRepository.find({
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

    const byId = new Map<number, CatalogStation>();
    const listItems: StationListItem[] = [];
    const listItemsByRegionCode = new Map<string, StationListItem[]>();

    for (const station of stations) {
      const listItem: StationListItem = {
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
        // 조회 쿼리에 노선 정렬이 없어 실행 계획에 따라 순서가 달라졌다. 코스 응답과 같이 노선 ID 순으로 고정한다.
        lines: station.stationLines
          .map((stationLine) => ({
            id: stationLine.line.id,
            name: stationLine.line.name,
            color: stationLine.line.color,
            regionId: stationLine.line.regionId,
          }))
          .sort((a, b) => a.id - b.id),
      };

      byId.set(station.id, {
        ...listItem,
        regionId: station.regionId,
        vibeText: station.vibeText,
      });
      listItems.push(listItem);

      if (station.region) {
        const regionItems = listItemsByRegionCode.get(station.region.code);

        if (regionItems) {
          regionItems.push(listItem);
        } else {
          listItemsByRegionCode.set(station.region.code, [listItem]);
        }
      }
    }

    return { byId, listItems, listItemsByRegionCode };
  }
}
