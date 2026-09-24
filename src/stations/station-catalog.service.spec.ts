import { Repository } from 'typeorm';
import { SubwayStation } from './entities';
import { StationCatalogService } from './station-catalog.service';

const line = (id: number, regionId = 1) => ({
  line: { id, name: `${id}호선`, color: '#000000', regionId },
});

const STATIONS = [
  {
    id: 1,
    name: '시청',
    lat: '37.5650000',
    lng: '126.9770000',
    weightGrade: 'A',
    placeCount: 30,
    regionId: 1,
    vibeText: '도심',
    region: { id: 1, name: '수도권', code: 'SEOUL' },
    // 조회 결과의 노선 순서는 실행 계획에 따라 달라질 수 있다.
    stationLines: [line(2), line(1)],
  },
  {
    id: 2,
    name: '서면',
    lat: null,
    lng: null,
    weightGrade: 'B',
    placeCount: 10,
    regionId: 3,
    vibeText: null,
    region: { id: 3, name: '부산', code: 'BUSAN' },
    stationLines: [line(101, 3)],
  },
] as unknown as SubwayStation[];

describe('StationCatalogService', () => {
  let find: jest.Mock;
  let service: StationCatalogService;

  beforeEach(() => {
    find = jest.fn().mockResolvedValue(STATIONS);
    service = new StationCatalogService({
      find,
    } as unknown as Repository<SubwayStation>);
  });

  it('역 목록 응답 형태와 지역별 목록을 만들고, 노선은 ID 순으로 정렬한다', async () => {
    const catalog = await service.getCatalog();

    expect(catalog.listItems.map((station) => station.id)).toEqual([1, 2]);
    expect(catalog.listItems[0]).toEqual({
      id: 1,
      name: '시청',
      lat: '37.5650000',
      lng: '126.9770000',
      weightGrade: 'A',
      placeCount: 30,
      region: { id: 1, name: '수도권', code: 'SEOUL' },
      lines: [
        { id: 1, name: '1호선', color: '#000000', regionId: 1 },
        { id: 2, name: '2호선', color: '#000000', regionId: 1 },
      ],
    });
    expect(
      catalog.listItemsByRegionCode.get('BUSAN')?.map((station) => station.id),
    ).toEqual([2]);
    expect(catalog.byId.get(2)).toMatchObject({ regionId: 3, vibeText: null });
  });

  it('한 번 읽은 카탈로그를 재사용하고, 무효화하면 다시 읽는다', async () => {
    await Promise.all([service.getCatalog(), service.getCatalog()]);
    await service.getCatalog();
    expect(find).toHaveBeenCalledTimes(1);

    service.invalidate();
    await service.getCatalog();
    expect(find).toHaveBeenCalledTimes(2);
  });
});
