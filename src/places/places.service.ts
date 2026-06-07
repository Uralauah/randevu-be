import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { SubwayStation } from '../stations/entities';
import { NaverLocalClient, NaverLocalItem } from './naver-local.client';
import {
  MEAL_TIMES,
  PLACE_TYPES,
  MealTime,
  PlaceDateRecommendationResponse,
  PlaceDetailResponse,
  PlaceResponse,
  PlaceType,
} from './places.type';
import { PlaceCache } from './entities';
import { NaverBlogClient, NaverBlogItem } from './naver-blog.client';
import { PlaceTagService } from './place-tag.service';

interface CandidatePlace extends PlaceResponse {
  matchedQueries: string[];
}

interface FetchNaverCandidateOptions {
  skipTypeCompatibility?: boolean;
}

interface Coordinates {
  lat: number;
  lng: number;
}

interface BlogDateEvent {
  name: string;
  blogQuery: string;
  evidenceText: string;
  link: string | null;
}

interface CoursePlaceExclusions {
  placeKeys: Set<string>;
  nameAddressKeys: Set<string>;
  nameCoordinateKeys: Set<string>;
  nameKeys: Set<string>;
}

interface DateRecommendationContext {
  date: string;
  year: number;
  month: number;
  day: number;
  dayOfWeek: number;
  isWeekend: boolean;
  season: 'SPRING' | 'SUMMER' | 'FALL' | 'WINTER';
}

const RESPONSE_LIMIT_BY_TYPE: Record<PlaceType, number> = {
  RESTAURANT: 40,
  CAFE: 40,
  ACTIVITY: 40,
};

const NAVER_DISPLAY_PER_QUERY = 5;
const PLACE_SEARCH_DISPLAY = 5;
/** 키워드 직접 검색 시: 더 많이 가져와서 거리 기준으로 추린다 */
const KEYWORD_SEARCH_DISPLAY = 20;
/** 키워드 검색 결과의 역 기준 최대 거리 (주변 추천 2km보다 여유 있게) */
const KEYWORD_SEARCH_DISTANCE_LIMIT_METERS = 5_000;
const NAVER_BLOG_DISPLAY_PER_QUERY = 5;
const PLACE_DISTANCE_LIMIT_METERS = 2_000;
const EARTH_RADIUS_METERS = 6_371_000;
const NAVER_LOCAL_QUERY_DELAY_MS = 150;
const NAVER_QUERY_CONCURRENCY = 4;
const PLACE_LIST_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const RECOMMENDATION_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const BLOG_QUERY_CONCURRENCY = 4;
const BLOG_EVENT_NAME_LIMIT = 8;
const DATE_RECOMMENDATION_TYPE_ORDER: PlaceType[] = [
  'ACTIVITY',
  'CAFE',
  'RESTAURANT',
];

@Injectable()
export class PlacesService {
  private readonly logger = new Logger(PlacesService.name);
  private readonly placeListCache = new Map<string, { places: PlaceResponse[]; expiresAt: number }>();
  private readonly recommendationCache = new Map<string, { candidates: PlaceResponse[]; expiresAt: number }>();

  constructor(
    @InjectRepository(SubwayStation)
    private readonly stationRepository: Repository<SubwayStation>,

    @InjectRepository(PlaceCache)
    private readonly placeCacheRepository: Repository<PlaceCache>,

    private readonly naverLocalClient: NaverLocalClient,

    private readonly naverBlogClient: NaverBlogClient,

    private readonly placeTagService: PlaceTagService,
  ) {}

  async findPlacesByStation(
    stationId: number,
    type: PlaceType,
    mealTime?: MealTime,
    excludedPlaceKeys?: string,
  ) {
    this.validatePlaceType(type);
    this.validateMealTime(type, mealTime);

    const station = await this.stationRepository.findOne({
      where: { id: stationId },
      relations: {
        region: true,
      },
    });

    if (!station) {
      throw new NotFoundException('역을 찾을 수 없습니다.');
    }

    const exclusions = this.buildExclusionsFromPlaceKeys(
      this.parseCommaSeparated(excludedPlaceKeys),
    );

    const cacheKey = `${stationId}:${type}:${mealTime ?? 'none'}`;
    let allPlaces = this.getPlaceListCache(cacheKey);

    if (!allPlaces) {
      allPlaces = await this.searchPlaces(station, type, mealTime);
      this.setPlaceListCache(cacheKey, allPlaces);
    }

    const places = this.filterExcludedPlaces(allPlaces, exclusions);

    return {
      station: {
        id: station.id,
        name: station.name,
        lat: station.lat,
        lng: station.lng,
      },
      source: 'NAVER',
      type,
      mealTime: type === 'RESTAURANT' ? (mealTime ?? null) : null,
      places,
    };
  }

  /**
   * 사용자가 직접 입력한 키워드로 장소를 검색한다.
   * stationId가 주어지면:
   *   1. 검색어에 역 지역명을 자동 추가해 네이버가 주변 결과를 우선 반환하도록 유도
   *   2. 결과를 가까운 순으로 정렬하고 KEYWORD_SEARCH_DISTANCE_LIMIT_METERS 초과 항목 제거
   */
  async searchPlacesByKeyword(
    rawQuery: string,
    type: PlaceType,
    stationId?: number,
  ) {
    this.validatePlaceType(type);

    const query = (rawQuery ?? '').trim();

    if (query.length === 0) {
      return { source: 'NAVER' as const, type, query, places: [] };
    }

    // 역 정보를 한 번만 로드 (검색어 보강 + 거리 계산에 공통 사용)
    const station = stationId
      ? await this.stationRepository.findOne({ where: { id: stationId } })
      : null;

    const cacheKey = `search:${type}:${stationId ?? 'none'}:${this.normalize(query)}`;
    const cached = this.getPlaceListCache(cacheKey);

    if (cached) {
      return { source: 'NAVER' as const, type, query, places: cached };
    }

    // 지역명이 없으면 역 지역명을 앞에 추가해 주변 결과 우선 노출
    const searchQuery = station
      ? this.buildLocationAwareQuery(query, station)
      : query;

    const items = await this.naverLocalClient.searchLocal({
      query: searchQuery,
      display: station ? KEYWORD_SEARCH_DISPLAY : PLACE_SEARCH_DISPLAY,
    });

    const seen = new Set<string>();
    const candidates = items
      .map((item) => this.toPlaceResponse(item, type))
      .filter((place) => {
        const dedupKey = this.getDedupKey(place);
        if (seen.has(dedupKey)) return false;
        seen.add(dedupKey);
        return true;
      });

    // 역 좌표 기준으로 거리 계산 → 정렬 → 원거리 제거 (역 정보 재사용)
    const stationCoords = station ? this.toValidCoordinates(station) : null;

    const places: PlaceResponse[] = stationCoords
      ? candidates
          .map((p) => {
            const coords = this.toValidCoordinates(p);
            const distanceMeters = coords
              ? Math.round(
                  this.calculateStraightLineDistanceMeters(stationCoords, coords),
                )
              : null;
            return { ...p, distanceMeters };
          })
          .filter(
            (p) =>
              p.distanceMeters === null ||
              p.distanceMeters <= KEYWORD_SEARCH_DISTANCE_LIMIT_METERS,
          )
          .sort(
            (a, b) =>
              (a.distanceMeters ?? Number.POSITIVE_INFINITY) -
              (b.distanceMeters ?? Number.POSITIVE_INFINITY),
          )
      : candidates;

    await this.cachePlaces(places);
    this.setPlaceListCache(cacheKey, places);

    return { source: 'NAVER' as const, type, query, places };
  }

  /**
   * 검색어에 지역명이 포함되지 않은 경우 역 지역명을 앞에 추가한다.
   * 이미 역 이름 또는 지역을 나타내는 접미사(역·구·동·로 등)를 가진 토큰이
   * 검색어 어디에든 있으면 그대로 반환.
   */
  private buildLocationAwareQuery(query: string, station: SubwayStation): string {
    const areaName = this.toSearchStationAreaName(station.name); // "성수역" → "성수"
    const normalizedQuery = this.normalize(query);

    // 이미 역 지역명이 포함된 경우
    if (normalizedQuery.includes(this.normalize(areaName))) {
      return query;
    }

    // 검색어 내 어떤 토큰이든 지역 접미사로 끝나면 사용자가 직접 지역을 지정한 것
    // 예) "버거킹 동성로" → "동성로"가 "로"로 끝남 → 지역 포함으로 판단
    const tokens = query.trim().split(/\s+/);
    const hasLocationToken = tokens.some((token) =>
      /역$|구$|동$|로$|대로$|길$|읍$|면$/.test(token),
    );
    if (hasLocationToken) {
      return query;
    }

    return `${areaName} ${query}`;
  }

  async recommendPlaceByStationAndDate(
    stationId: number,
    date: string,
    excludedPlaceKeys?: string,
  ): Promise<PlaceDateRecommendationResponse> {
    const dateContext = this.parseDateRecommendationContext(date);
    const station = await this.stationRepository.findOne({
      where: { id: stationId },
      relations: {
        region: true,
      },
    });

    if (!station) {
      throw new NotFoundException('역을 찾을 수 없습니다.');
    }

    const exclusions = this.buildExclusionsFromPlaceKeys(
      this.parseCommaSeparated(excludedPlaceKeys),
    );

    const cacheKey = `rec:${stationId}:${date}`;
    let sortedCandidates = this.getRecommendationCache(cacheKey);

    if (!sortedCandidates) {
      sortedCandidates = await this.buildRecommendationCandidates(
        station,
        dateContext,
      );
      this.setRecommendationCache(cacheKey, sortedCandidates);
    }

    const available = this.filterExcludedPlaces(sortedCandidates, exclusions);
    const recommendations = available.filter(
      (place) => (place.recommendationScore ?? 0) > 0,
    );
    const recommendation = recommendations[0] ?? available[0];

    if (!recommendation) {
      throw new NotFoundException('추천할 장소를 찾을 수 없습니다.');
    }

    await this.cachePlaces([recommendation]);

    return {
      station: {
        id: station.id,
        name: station.name,
        lat: station.lat,
        lng: station.lng,
      },
      source: 'NAVER',
      date: dateContext.date,
      recommendation: {
        ...recommendation,
        category: this.toPlaceCategoryLabel(recommendation.type),
        reason: this.buildDateRecommendationReason(
          recommendation,
          station.name,
          dateContext,
        ),
      },
    };
  }

  private async buildRecommendationCandidates(
    station: SubwayStation,
    dateContext: DateRecommendationContext,
  ): Promise<PlaceResponse[]> {
    const recommendationGroups: PlaceResponse[][] = [];

    for (const type of DATE_RECOMMENDATION_TYPE_ORDER) {
      const base = this.toSearchLocationName(station);
      const blogCandidates =
        type === 'ACTIVITY'
          ? await this.fetchDateEventCandidatesFromBlogs(station, base, dateContext)
          : [];

      if (blogCandidates.length > 0) {
        const places = this.rankPlaces(blogCandidates, type).map((place) => ({
          ...place,
          recommendationScore:
            (place.recommendationScore ?? 0) +
            this.scorePlaceByDateContext(place, dateContext),
        }));

        if (places.length > 0) {
          recommendationGroups.push(places);
          break;
        }
      }

      const priorityQueries = this.buildDatePrioritySearchQueries(base, type, dateContext);
      let candidates = await this.fetchNaverCandidates(priorityQueries, type);
      let nearbyCandidates = this.filterPlacesWithinStationDistance(candidates, station);
      let selectedCandidates = nearbyCandidates.filter((place) =>
        this.isDateEventSearchCandidate(place, dateContext),
      );

      if (selectedCandidates.length === 0) {
        const fallbackQueries = this.buildDateRecommendationFallbackSearchQueries(
          station,
          type,
          dateContext,
        );
        candidates = await this.fetchNaverCandidates(fallbackQueries, type);
        nearbyCandidates = this.filterPlacesWithinStationDistance(candidates, station);
        selectedCandidates = nearbyCandidates;
      }

      const places = this.rankPlaces(selectedCandidates, type).map((place) => ({
        ...place,
        recommendationScore:
          (place.recommendationScore ?? 0) +
          this.scorePlaceByDateContext(place, dateContext),
      }));

      recommendationGroups.push(places);

      if (type === 'ACTIVITY' && places.length > 0) {
        break;
      }
    }

    const sortedCandidates = recommendationGroups.flat().sort((a, b) => {
      const dateLimitedEventDiff =
        Number(this.isDateLimitedEventPlace(b, dateContext)) -
        Number(this.isDateLimitedEventPlace(a, dateContext));

      if (dateLimitedEventDiff !== 0) return dateLimitedEventDiff;

      const activityTypeDiff =
        Number(b.type === 'ACTIVITY') - Number(a.type === 'ACTIVITY');

      if (activityTypeDiff !== 0) return activityTypeDiff;

      const coordinateDiff =
        Number(this.toValidCoordinates(b) !== null) -
        Number(this.toValidCoordinates(a) !== null);

      if (coordinateDiff !== 0) return coordinateDiff;

      const scoreDiff = (b.recommendationScore ?? 0) - (a.recommendationScore ?? 0);

      if (scoreDiff !== 0) return scoreDiff;

      const matchedQueryDiff =
        (b.matchedQueries?.length ?? 0) - (a.matchedQueries?.length ?? 0);

      if (matchedQueryDiff !== 0) return matchedQueryDiff;

      return (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity);
    });

    this.logDateRecommendationCandidates(sortedCandidates);

    return sortedCandidates;
  }

  private logDateRecommendationCandidates(places: PlaceResponse[]) {
    this.logger.log(
      `날짜 추천 장소 후보: ${JSON.stringify(
        places.map((place) => ({
          장소이름: place.name,
          검색어: [...new Set(place.matchedQueries ?? [])].join(' | '),
          점수: place.recommendationScore ?? null,
        })),
      )}`,
    );
  }

  private buildExclusionsFromPlaceKeys(
    placeKeys: string[],
  ): CoursePlaceExclusions {
    const exclusions = this.createEmptyCoursePlaceExclusions();

    for (const key of placeKeys) {
      exclusions.placeKeys.add(key);
    }

    return exclusions;
  }

  private parseCommaSeparated(value?: string): string[] {
    if (!value?.trim()) {
      return [];
    }

    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }

  private getRecommendationCache(key: string): PlaceResponse[] | null {
    const entry = this.recommendationCache.get(key);

    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.recommendationCache.delete(key);
      return null;
    }

    return entry.candidates;
  }

  private setRecommendationCache(key: string, candidates: PlaceResponse[]): void {
    this.recommendationCache.set(key, {
      candidates,
      expiresAt: Date.now() + RECOMMENDATION_CACHE_TTL_MS,
    });
  }

  private getPlaceListCache(key: string): PlaceResponse[] | null {
    const entry = this.placeListCache.get(key);

    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.placeListCache.delete(key);
      return null;
    }

    return entry.places;
  }

  private setPlaceListCache(key: string, places: PlaceResponse[]): void {
    this.placeListCache.set(key, {
      places,
      expiresAt: Date.now() + PLACE_LIST_CACHE_TTL_MS,
    });
  }

  private createEmptyCoursePlaceExclusions(): CoursePlaceExclusions {
    return {
      placeKeys: new Set(),
      nameAddressKeys: new Set(),
      nameCoordinateKeys: new Set(),
      nameKeys: new Set(),
    };
  }


  private filterExcludedPlaces<T extends PlaceResponse>(
    places: T[],
    exclusions: CoursePlaceExclusions,
  ) {
    if (
      exclusions.placeKeys.size === 0 &&
      exclusions.nameAddressKeys.size === 0 &&
      exclusions.nameCoordinateKeys.size === 0 &&
      exclusions.nameKeys.size === 0
    ) {
      return places;
    }

    return places.filter(
      (place) => !this.isExcludedCoursePlace(place, exclusions),
    );
  }

  private isExcludedCoursePlace(
    place: PlaceResponse,
    exclusions: CoursePlaceExclusions,
  ) {
    if (exclusions.placeKeys.has(place.placeKey)) {
      return true;
    }

    if (
      place.address &&
      exclusions.nameAddressKeys.has(
        this.createNameAddressKey(place.name, place.address),
      )
    ) {
      return true;
    }

    const coordinates = this.toValidCoordinates(place);

    if (
      coordinates &&
      exclusions.nameCoordinateKeys.has(
        this.createNameCoordinateKey(place.name, coordinates),
      )
    ) {
      return true;
    }

    return exclusions.nameKeys.has(this.normalize(place.name));
  }

  private createNameAddressKey(name: string, address: string) {
    return `${this.normalize(name)}:${this.normalize(address)}`;
  }

  private createNameCoordinateKey(name: string, coordinates: Coordinates) {
    return `${this.normalize(name)}:${coordinates.lat.toFixed(
      5,
    )}:${coordinates.lng.toFixed(5)}`;
  }

  private async searchPlaces(
    station: SubwayStation,
    type: PlaceType,
    mealTime?: MealTime,
  ): Promise<PlaceResponse[]> {
    const queries = this.buildSearchQueries(station, type, mealTime);
    const candidates = await this.fetchNaverCandidates(queries, type);
    const nearbyCandidates = this.filterPlacesWithinStationDistance(
      candidates,
      station,
    );
    const rankedPlaces = this.rankPlaces(nearbyCandidates, type, mealTime);

    const qualifiedPlaces = rankedPlaces.filter(
      (place) => (place.recommendationScore ?? 0) > 0,
    );
    const decentPlaces = rankedPlaces.filter(
      (place) => (place.recommendationScore ?? 0) >= 0,
    );

    const finalPlaces =
      qualifiedPlaces.length >= 5 ? qualifiedPlaces :
      decentPlaces.length >= 5 ? decentPlaces :
      rankedPlaces;

    const selectedPlaces = finalPlaces.slice(0, RESPONSE_LIMIT_BY_TYPE[type]);

    await this.cachePlaces(selectedPlaces);

    return selectedPlaces;
  }

  async findPlaceDetail(placeKey: string): Promise<PlaceDetailResponse> {
    const place = await this.placeCacheRepository.findOne({
      where: { placeKey },
    });

    if (!place) {
      throw new NotFoundException('장소 정보를 찾을 수 없습니다.');
    }

    const refreshedPlace = await this.refreshPlaceTagsIfNeeded(place);

    return this.toPlaceDetailResponse(refreshedPlace);
  }

  private async fetchNaverCandidates(
    queries: string[],
    type: PlaceType,
    options: FetchNaverCandidateOptions = {},
  ): Promise<CandidatePlace[]> {
    const results: { query: string; items: NaverLocalItem[] }[] = [];
    let rejectedCount = 0;

    for (let i = 0; i < queries.length; i += NAVER_QUERY_CONCURRENCY) {
      const batch = queries.slice(i, i + NAVER_QUERY_CONCURRENCY);
      const batchResults = await Promise.allSettled(
        batch.map((query) =>
          this.naverLocalClient
            .searchLocal({ query, display: NAVER_DISPLAY_PER_QUERY, sort: 'comment' })
            .then((items) => ({ query, items })),
        ),
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          rejectedCount += 1;
        }
      }

      if (i + NAVER_QUERY_CONCURRENCY < queries.length) {
        await this.delay(NAVER_LOCAL_QUERY_DELAY_MS);
      }
    }

    if (rejectedCount > 0) {
      this.logger.warn(
        `네이버 장소 검색 일부 실패: type=${type}, failed=${rejectedCount}, total=${queries.length}`,
      );
    }

    const merged = new Map<string, CandidatePlace>();

    for (const { query, items } of results) {
      for (const item of items) {
        const place = this.toPlaceResponse(item, type);

        if (
          !options.skipTypeCompatibility &&
          !this.isPlaceCompatibleWithType(place, type, query)
        ) {
          continue;
        }

        const key = this.getDedupKey(place);
        const existing = merged.get(key);

        if (existing) {
          existing.matchedQueries.push(query);
          continue;
        }

        merged.set(key, {
          ...place,
          matchedQueries: [query],
        });
      }
    }

    return [...merged.values()];
  }

  private async fetchDateEventCandidatesFromBlogs(
    station: SubwayStation,
    base: string,
    dateContext: DateRecommendationContext,
  ): Promise<CandidatePlace[]> {
    const blogQueries = this.buildDatePrioritySearchQueries(base, 'ACTIVITY', dateContext);
    const eventNames = new Map<string, BlogDateEvent>();

    // 블로그 쿼리 병렬 배치 실행
    for (let i = 0; i < blogQueries.length; i += BLOG_QUERY_CONCURRENCY) {
      const batch = blogQueries.slice(i, i + BLOG_QUERY_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((query) =>
          this.safeSearchBlogsForDateEvent(query).then((items) => ({ query, items })),
        ),
      );

      for (const { query, items } of batchResults) {
        for (const item of items) {
          const evidenceText = this.toBlogEvidenceText(item);

          if (!this.hasDateEventEvidence(evidenceText, dateContext)) {
            continue;
          }

          for (const name of this.extractDateEventNameCandidates(item, station, dateContext)) {
            const key = this.normalize(name);

            if (!key || eventNames.has(key)) {
              continue;
            }

            eventNames.set(key, { name, blogQuery: query, evidenceText, link: item.link || null });

            if (eventNames.size >= BLOG_EVENT_NAME_LIMIT) break;
          }

          if (eventNames.size >= BLOG_EVENT_NAME_LIMIT) break;
        }

        if (eventNames.size >= BLOG_EVENT_NAME_LIMIT) break;
      }

      if (eventNames.size >= BLOG_EVENT_NAME_LIMIT) break;

      if (i + BLOG_QUERY_CONCURRENCY < blogQueries.length) {
        await this.delay(NAVER_LOCAL_QUERY_DELAY_MS);
      }
    }

    this.logDateEventExtractedNames([...eventNames.values()]);

    // 이벤트명 로컬 검색을 모두 병렬로 실행
    const localSearchResults = await Promise.all(
      [...eventNames.values()].map(async (event) => {
        const localQueries = this.buildDateEventLocalMatchQueries(event.name, station);
        const localCandidates = await this.fetchNaverCandidates(
          localQueries,
          'ACTIVITY',
          { skipTypeCompatibility: true },
        );
        const nearbyCandidates = this.filterPlacesWithinStationDistance(localCandidates, station);
        this.logDateEventLocalMatchResults(event.name, localQueries, nearbyCandidates);
        return { event, nearbyCandidates };
      }),
    );

    const merged = new Map<string, CandidatePlace>();

    for (const { event, nearbyCandidates } of localSearchResults) {
      if (
        nearbyCandidates.length === 0 &&
        this.hasStationLocationEvidence(event.evidenceText, station)
      ) {
        const blogOnlyCandidate = this.toBlogDateEventCandidate(event);
        merged.set(this.getDedupKey(blogOnlyCandidate), blogOnlyCandidate);
        continue;
      }

      for (const candidate of nearbyCandidates) {
        const key = this.getDedupKey(candidate);
        const existing = merged.get(key);
        const enrichedCandidate = {
          ...candidate,
          description: this.mergeDescriptionWithBlogEvidence(
            candidate.description,
            event.evidenceText,
          ),
          matchedQueries: [event.blogQuery, ...candidate.matchedQueries, event.name],
        };

        if (existing) {
          existing.matchedQueries.push(...enrichedCandidate.matchedQueries);
          continue;
        }

        merged.set(key, enrichedCandidate);
      }
    }

    return [...merged.values()];
  }

  private toBlogDateEventCandidate(event: BlogDateEvent): CandidatePlace {
    const name = event.name;

    return {
      placeKey: this.createPlaceKey('NAVER', null, name, event.link),
      kakaoPlaceId: null,
      naverPlaceId: null,
      provider: 'NAVER',
      type: 'ACTIVITY',
      name,
      description: event.evidenceText.slice(0, 500),
      categoryName: '팝업/기간한정 이벤트',
      address: null,
      lat: null,
      lng: null,
      distanceMeters: null,
      phone: null,
      mapLink: null,
      externalLink: event.link,
      instagramLink: null,
      reservationLink: null,
      matchedQueries: [event.blogQuery, event.name, '네이버 블로그'],
    };
  }

  private async safeSearchBlogsForDateEvent(query: string) {
    try {
      const items = await this.naverBlogClient.searchBlogs({
        query,
        display: NAVER_BLOG_DISPLAY_PER_QUERY,
        sort: 'date',
      });

      this.logDateEventBlogSearchResults(query, items);

      return items;
    } catch (error) {
      this.logger.warn(
        `네이버 날짜 이벤트 블로그 검색 실패: query=${query}, error=${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return [];
    }
  }

  private logDateEventBlogSearchResults(query: string, items: NaverBlogItem[]) {
    this.logger.log(
      `날짜 이벤트 블로그 검색 결과: ${JSON.stringify(
        items.map((item) => ({
          검색어: query,
          제목: this.stripHtml(item.title),
          설명: this.truncateForLog(this.stripHtml(item.description), 120),
        })),
      )}`,
    );
  }

  private logDateEventExtractedNames(
    events: Array<{ name: string; blogQuery: string }>,
  ) {
    this.logger.log(
      `날짜 이벤트 블로그 후보명: ${JSON.stringify(
        events.map((event) => ({
          후보명: event.name,
          검색어: event.blogQuery,
        })),
      )}`,
    );
  }

  private logDateEventLocalMatchResults(
    eventName: string,
    queries: string[],
    places: CandidatePlace[],
  ) {
    this.logger.log(
      `날짜 이벤트 로컬 매칭 결과: ${JSON.stringify({
        후보명: eventName,
        검색어: queries.join(' | '),
        장소: places.map((place) => place.name),
      })}`,
    );
  }

  private buildDateEventLocalMatchQueries(
    eventName: string,
    station: SubwayStation,
  ) {
    const stationAreaName = this.toSearchStationAreaName(station.name);
    const stationName = this.toSearchStationName(station.name);

    return [
      `${eventName} ${stationAreaName}`,
      `${eventName} ${stationName}`,
      eventName,
    ];
  }

  private extractDateEventNameCandidates(
    item: NaverBlogItem,
    station: SubwayStation,
    dateContext: DateRecommendationContext,
  ) {
    const title = this.stripHtml(item.title);
    const description = this.stripHtml(item.description ?? '');
    const rawParts = [
      ...this.extractDateEventPatternNameCandidates(title),
      ...this.extractDateEventPatternNameCandidates(description),
      ...title.split(/[|:/\-–—!！?？]/),
      ...Array.from(
        title.matchAll(/\[([^\]]+)]|\(([^)]+)\)|[‘”’’””]([^’”’’””]+)[‘”’’””]/g),
      ).map((match) => match[1] ?? match[2] ?? match[3] ?? ''),
      title,
    ];
    const candidates = new Map<string, string>();

    for (const rawPart of rawParts) {
      for (const value of [
        this.cleanDateEventName(rawPart, station, dateContext, false),
        this.cleanDateEventName(rawPart, station, dateContext, true),
      ]) {
        const key = this.normalize(value);

        if (!this.isUsableDateEventName(value) || candidates.has(key)) {
          continue;
        }

        candidates.set(key, value);
      }
    }

    return [...candidates.values()].slice(0, 3);
  }

  private extractDateEventPatternNameCandidates(title: string) {
    const candidates: string[] = [];
    const normalizedTitle = this.stripHtml(title)
      .replace(/[“”]/g, '"')
      .replace(/['']/g, "'");
    const eventPattern =
      /([가-힣A-Za-z0-9&._+'"\s-]{2,45}?(?:팝업스토어|팝업|전시회|전시|기획전|페스티벌|축제))/g;

    for (const match of normalizedTitle.matchAll(eventPattern)) {
      if (match[1]) {
        candidates.push(match[1]);
      }
    }

    return candidates;
  }

  private cleanDateEventName(
    value: string,
    station: SubwayStation,
    dateContext: DateRecommendationContext,
    removeEventWords: boolean,
  ) {
    let result = this.stripHtml(value)
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/['']/g, "'")
      .replace(/[()[\]{}<>]/g, ' ')
      .replace(new RegExp(`${dateContext.year}년`, 'g'), ' ')
      .replace(
        new RegExp(`${dateContext.month}월\\s*${dateContext.day}일`, 'g'),
        ' ',
      )
      .replace(new RegExp(`${dateContext.month}월`, 'g'), ' ')
      .replace(
        new RegExp(
          this.escapeRegExp(this.toSearchStationName(station.name)),
          'g',
        ),
        ' ',
      )
      .replace(
        new RegExp(
          this.escapeRegExp(this.toSearchStationAreaName(station.name)),
          'g',
        ),
        ' ',
      )
      .replace(
        /서울|성동구|핫플|가볼만한곳|가볼만한 곳|데이트|후기|리뷰|방문|일정|정보|예약방법|예약|웨이팅|오픈런|가는법|추천/g,
        ' ',
      );

    result = result.split(
      /그냥|못 지나침|디저트|라인업|굿즈|총정리|본품|증정|꿀팁|포토존|주차|위치|운영|기간|시간|방법|참여|혜택|총정리|정리/,
    )[0];

    if (removeEventWords) {
      result = result.replace(
        /팝업스토어|팝업|기간한정|한정|이벤트|축제|페스티벌|전시회|전시|기획전|플리마켓/g,
        ' ',
      );
    }

    // 잘린 제목 처리: "..." 이후는 신뢰할 수 없으므로 제거
    result = result.replace(/\.{2,}.*$|….*$/, '');

    return result.replace(/\s+/g, ' ').trim();
  }

  private isUsableDateEventName(value: string) {
    const normalizedValue = this.normalize(value);

    if (normalizedValue.length < 2 || normalizedValue.length > 50) {
      return false;
    }

    // 잘린 이름 거부
    if (value.includes('...') || value.includes('…')) {
      return false;
    }

    // 조사/접속사로 시작하는 문장 파편 거부 (예: "에 막 오픈한...", "이 인기인...")
    if (/^(에|이|가|을|를|의|은|는|에서|으로|도|와|과|한)\s/.test(value)) {
      return false;
    }

    // 날짜 표현만으로 된 이름 거부 (예: "6월", "5월")
    if (/^\d{1,2}월$/.test(value.trim())) {
      return false;
    }

    // 날짜 + 이벤트 키워드만 있는 이름 거부 (예: "6월 팝업스토어", "5월 전시")
    if (/^\d{1,2}월\s*(팝업스토어|팝업|전시회|전시|기획전|페스티벌|축제|이벤트|플리마켓|한정)$/.test(value.trim())) {
      return false;
    }

    return !DATE_EVENT_NAME_STOPWORDS.some(
      (stopword) => normalizedValue === this.normalize(stopword),
    );
  }

  private hasDateEventEvidence(
    evidenceText: string,
    dateContext: DateRecommendationContext,
  ) {
    const normalizedText = this.normalize(evidenceText);
    const hasSelectedMonth = normalizedText.includes(
      this.normalize(this.formatKoreanMonthLabel(dateContext)),
    );
    const hasShortMonth = normalizedText.includes(
      this.normalize(`${dateContext.month}월`),
    );
    const hasEventKeyword = DATE_LIMITED_EVENT_KEYWORDS.some((keyword) =>
      normalizedText.includes(this.normalize(keyword)),
    );

    return (hasSelectedMonth || hasShortMonth) && hasEventKeyword;
  }

  private hasStationLocationEvidence(
    evidenceText: string,
    station: SubwayStation,
  ) {
    const normalizedText = this.normalize(evidenceText);

    return [
      this.toSearchStationName(station.name),
      this.toSearchStationAreaName(station.name),
    ].some((keyword) => normalizedText.includes(this.normalize(keyword)));
  }

  private toBlogEvidenceText(item: NaverBlogItem) {
    return this.stripHtml(`${item.title} ${item.description}`);
  }

  private mergeDescriptionWithBlogEvidence(
    description: string | null,
    evidenceText: string,
  ) {
    return [description, evidenceText]
      .filter((value): value is string => Boolean(value?.trim()))
      .join(' ')
      .slice(0, 500);
  }

  private isPlaceCompatibleWithType(
    place: PlaceResponse,
    type: PlaceType,
    query?: string,
  ) {
    if (type !== 'ACTIVITY') {
      return true;
    }

    const eventText = this.normalize(
      `${place.name} ${place.categoryName} ${place.description} ${query ?? ''}`,
    );

    if (
      DATE_LIMITED_EVENT_KEYWORDS.some((keyword) =>
        eventText.includes(this.normalize(keyword)),
      )
    ) {
      return true;
    }

    const categoryText = this.normalize(place.categoryName);

    return !ACTIVITY_EXCLUDED_CATEGORY_KEYWORDS.some((keyword) =>
      categoryText.includes(this.normalize(keyword)),
    );
  }

  private delay(ms: number) {
    if (process.env.NODE_ENV === 'test') {
      return Promise.resolve();
    }

    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private buildSearchQueries(
    station: SubwayStation,
    type: PlaceType,
    mealTime?: MealTime,
  ) {
    const base = this.toSearchLocationName(station);

    if (type === 'CAFE') {
      return [
        `${base} 감성카페`,
        `${base} 분위기 좋은 카페`,
        `${base} 디저트 카페`,
        `${base} 카페 추천`,
        `${base} 데이트 카페`,
        `${base} 조용한 카페`,
        `${base} 브런치 카페`,
        `${base} 베이커리 카페`,
        `${base} 루프탑 카페`,
        `${base} 한옥 카페`,
        `${base} 뷰 좋은 카페`,
        `${base} 힙한 카페`,
      ];
    }

    if (type === 'ACTIVITY') {
      return [
        `${base} 팝업스토어`,
        `${base} 팝업`,
        `${base} 팝업 전시`,
        `${base} 기간한정 이벤트`,
        `${base} 한정 전시`,
        `${base} 전시`,
        `${base} 놀거리`,
        `${base} 체험`,
        `${base} 갤러리`,
        `${base} 미술관`,
        `${base} 공방`,
        `${base} 독립서점`,
      ];
    }

    if (mealTime === 'LUNCH') {
      return [
        `${base} 데이트 점심 맛집`,
        `${base} 점심 맛집`,
        `${base} 브런치`,
        `${base} 파스타`,
        `${base} 분위기 좋은 점심 맛집`,
        `${base} 데이트 코스 맛집`,
        `${base} 샐러드`,
        `${base} 숨은 맛집`,
        `${base} 양식 점심`,
        `${base} 일식 점심`,
        `${base} 인기 점심 맛집`,
        `${base} 핫플 점심`,
      ];
    }

    if (mealTime === 'DINNER') {
      return [
        `${base} 데이트 저녁 맛집`,
        `${base} 분위기 좋은 저녁 맛집`,
        `${base} 저녁 맛집`,
        `${base} 와인바`,
        `${base} 이자카야`,
        `${base} 데이트 코스 맛집`,
        `${base} 다이닝`,
        `${base} 숨은 맛집`,
        `${base} 오마카세`,
        `${base} 스테이크`,
        `${base} 코스 요리`,
        `${base} 분위기 있는 레스토랑`,
      ];
    }

    return [
      `${base} 데이트 맛집`,
      `${base} 분위기 좋은 맛집`,
      `${base} 맛집 추천`,
      `${base} 핫플`,
      `${base} 가볼만한 곳`,
      `${base} 데이트 코스 맛집`,
      `${base} 숨은 맛집`,
      `${base} 식당 추천`,
      `${base} 양식`,
      `${base} 일식`,
      `${base} 인기 식당`,
      `${base} 특별한 식사`,
    ];
  }

  private buildDateRecommendationFallbackSearchQueries(
    station: SubwayStation,
    type: PlaceType,
    dateContext: DateRecommendationContext,
  ) {
    const base = this.toSearchLocationName(station);

    if (dateContext.season === 'SUMMER') {
      if (type === 'ACTIVITY') {
        return [`${base} 실내 데이트`, `${base} 시원한 놀거리`];
      }

      if (type === 'CAFE') {
        return [`${base} 빙수 카페`, `${base} 시원한 카페`];
      }

      return [`${base} 냉면 맛집`, `${base} 여름 맛집`];
    }

    if (dateContext.season === 'WINTER') {
      if (type === 'ACTIVITY') {
        return [`${base} 실내 놀거리`, `${base} 전시 데이트`];
      }

      if (type === 'CAFE') {
        return [`${base} 따뜻한 카페`, `${base} 디저트 카페`];
      }

      return [`${base} 국물 맛집`, `${base} 겨울 맛집`];
    }

    if (dateContext.isWeekend) {
      if (type === 'ACTIVITY') {
        return [`${base} 주말 데이트`, `${base} 가볼만한 곳`];
      }

      if (type === 'CAFE') {
        return [`${base} 주말 카페`, `${base} 데이트 카페`];
      }

      return [`${base} 주말 맛집`, `${base} 데이트 맛집`];
    }

    if (type === 'ACTIVITY') {
      return [`${base} 가볍게 놀거리`, `${base} 데이트 코스`];
    }

    if (type === 'CAFE') {
      return [`${base} 조용한 카페`, `${base} 분위기 좋은 카페`];
    }

    return [`${base} 저녁 맛집`, `${base} 점심 맛집`];
  }

  private buildDatePrioritySearchQueries(
    base: string,
    type: PlaceType,
    dateContext: DateRecommendationContext,
  ) {
    const monthLabel = this.formatKoreanMonthLabel(dateContext);
    const dateLabel = this.formatKoreanDateLabel(dateContext);

    if (type === 'ACTIVITY') {
      return [
        `${dateLabel} ${base} 팝업`,
        `${dateLabel} ${base} 이벤트`,
        `${monthLabel} ${base} 팝업`,
        `${monthLabel} ${base} 팝업스토어`,
        `${monthLabel} ${base} 팝업 전시`,
        `${monthLabel} ${base} 기간한정`,
        `${monthLabel} ${base} 전시`,
        `${monthLabel} ${base} 축제`,
        `${monthLabel} ${base} 이벤트`,
        `${monthLabel} ${base} 한정 전시`,
        `${dateLabel} ${base} 오픈`,
        `${dateLabel} ${base} 한정`,
      ];
    }

    if (type === 'CAFE') {
      return [
        `${dateLabel} ${base} 팝업 카페`,
        `${monthLabel} ${base} 팝업 카페`,
        `${monthLabel} ${base} 기간한정 카페`,
        `${monthLabel} ${base} 신상 카페`,
      ];
    }

    return [
      `${dateLabel} ${base} 팝업 맛집`,
      `${monthLabel} ${base} 팝업 맛집`,
      `${monthLabel} ${base} 기간한정 맛집`,
      `${monthLabel} ${base} 신상 맛집`,
    ];
  }

  private toSearchLocationName(station: SubwayStation) {
    const stationKeyword = this.toSearchStationAreaName(station.name);
    const regionKeyword = this.toSearchRegionName(station.region?.name);

    if (!regionKeyword) {
      return this.toSearchStationName(station.name);
    }

    if (
      this.normalize(stationKeyword).startsWith(this.normalize(regionKeyword))
    ) {
      return stationKeyword;
    }

    return `${regionKeyword} ${stationKeyword}`;
  }

  private toSearchRegionName(regionName?: string | null) {
    const normalizedRegionName = regionName?.trim();

    if (!normalizedRegionName) {
      return null;
    }

    if (BROAD_SEARCH_REGION_NAMES.includes(normalizedRegionName)) {
      return null;
    }

    return normalizedRegionName;
  }

  private toSearchStationAreaName(stationName: string) {
    return stationName.trim().replace(/역$/, '');
  }

  private toSearchStationName(stationName: string) {
    return stationName.endsWith('역') ? stationName : `${stationName}역`;
  }


  private toPlaceResponse(
    item: NaverLocalItem,
    type: PlaceType,
  ): PlaceResponse {
    const name = this.stripHtml(item.title);
    const naverPlaceId = this.extractNaverPlaceId(item.link);
    const address = item.roadAddress || item.address || null;
    const placeKey = this.createPlaceKey('NAVER', naverPlaceId, name, address);
    const links = this.classifyPlaceLink(item.link);

    return {
      placeKey,
      kakaoPlaceId: null,
      naverPlaceId,
      provider: 'NAVER',
      type,
      name,
      description: this.stripHtml(item.description),
      categoryName: item.category || '',
      address,
      lat: Number(item.mapy) / 10_000_000,
      lng: Number(item.mapx) / 10_000_000,
      distanceMeters: null,
      phone: item.telephone || null,
      mapLink: links.mapLink,
      externalLink: links.externalLink,
      instagramLink: links.instagramLink,
      reservationLink: links.reservationLink,
      matchedQueries: [],
    };
  }

  private async cachePlaces(places: PlaceResponse[]) {
    if (places.length === 0) {
      return;
    }

    const rows = places.map((place) => ({
      placeKey: place.placeKey,
      provider: place.provider ?? 'NAVER',
      externalId: place.naverPlaceId ?? place.kakaoPlaceId ?? null,
      placeType: place.type,
      name: place.name,
      description: place.description || null,
      categoryName: place.categoryName || null,
      address: place.address,
      lat: place.lat,
      lng: place.lng,
      phone: place.phone,
      openingHours: '알 수 없음',
      externalLink: place.externalLink,
      mapLink: place.mapLink ?? null,
      instagramLink: place.instagramLink ?? null,
      reservationLink: place.reservationLink ?? null,
      tags: place.tags ?? [],
      tagDetails: place.tagDetails ?? [],
      rawLocal: {
        matchedQueries: place.matchedQueries ?? [],
        recommendationScore: place.recommendationScore ?? null,
      },
    }));

    await this.placeCacheRepository.upsert(rows as any[], ['placeKey']);
  }

  private async refreshPlaceTagsIfNeeded(place: PlaceCache) {
    if (!this.shouldRefreshTags(place)) {
      return place;
    }

    const blogItems = await this.safeSearchBlogsForPlace(place);
    const tagResult = this.placeTagService.infer(place, blogItems);

    await this.placeCacheRepository.update(place.placeKey, {
      summary: tagResult.summary,
      tags: tagResult.tags,
      tagDetails: tagResult.tagDetails,
      rawBlog: blogItems,
      tagCachedAt: new Date(),
    });

    return Object.assign(place, {
      summary: tagResult.summary,
      tags: tagResult.tags,
      tagDetails: tagResult.tagDetails,
      rawBlog: blogItems,
      tagCachedAt: new Date(),
    });
  }

  private shouldRefreshTags(place: PlaceCache) {
    if (!place.tagCachedAt) {
      return true;
    }

    const ttlMs = 1000 * 60 * 60 * 24 * 7;

    return Date.now() - place.tagCachedAt.getTime() > ttlMs;
  }

  private async safeSearchBlogsForPlace(place: PlaceCache) {
    try {
      return await this.naverBlogClient.searchBlogs({
        query: this.buildBlogSearchQuery(place),
        display: 10,
        sort: 'sim',
      });
    } catch (error) {
      this.logger.warn(
        `네이버 블로그 검색 실패: place=${place.name}, error=${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return [];
    }
  }

  private buildBlogSearchQuery(place: PlaceCache) {
    const addressKeyword = this.extractUsefulAddress(place.address ?? '');

    if (place.placeType === 'CAFE') {
      return `${place.name} ${addressKeyword} 후기 분위기 디저트 감성`;
    }

    if (place.placeType === 'ACTIVITY') {
      return `${place.name} ${addressKeyword} 후기 데이트 분위기`;
    }

    return `${place.name} ${addressKeyword} 후기 분위기 맛집 데이트`;
  }

  private extractUsefulAddress(address: string) {
    const parts = address.split(' ').filter(Boolean);

    return parts.slice(0, 3).join(' ');
  }

  private toPlaceDetailResponse(place: PlaceCache): PlaceDetailResponse {
    return {
      placeKey: place.placeKey,
      provider: place.provider,
      externalId: place.externalId,
      type: place.placeType,
      name: place.name,
      summary: place.summary,
      description: place.description,
      categoryName: place.categoryName,
      address: place.address,
      lat: place.lat === null ? null : Number(place.lat),
      lng: place.lng === null ? null : Number(place.lng),
      phone: place.phone,
      openingHours: place.openingHours || '알 수 없음',
      mapLink: place.mapLink,
      externalLink: place.externalLink,
      instagramLink: place.instagramLink,
      reservationLink: place.reservationLink,
      tags: place.tags ?? [],
      tagDetails: place.tagDetails ?? [],
    };
  }

  private parseDateRecommendationContext(
    date: string,
  ): DateRecommendationContext {
    if (!date) {
      throw new BadRequestException('date는 필수입니다.');
    }

    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) {
      throw new BadRequestException('date는 YYYY-MM-DD 형식이어야 합니다.');
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));

    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) {
      throw new BadRequestException('유효한 날짜를 입력해주세요.');
    }

    const dayOfWeek = parsed.getUTCDay();

    return {
      date,
      year,
      month,
      day,
      dayOfWeek,
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      season: this.getSeason(month),
    };
  }

  private getSeason(month: number): DateRecommendationContext['season'] {
    if (month >= 3 && month <= 5) {
      return 'SPRING';
    }

    if (month >= 6 && month <= 8) {
      return 'SUMMER';
    }

    if (month >= 9 && month <= 11) {
      return 'FALL';
    }

    return 'WINTER';
  }

  private scorePlaceByDateContext(
    place: PlaceResponse,
    dateContext: DateRecommendationContext,
  ) {
    const text = this.normalize(
      `${place.name} ${place.categoryName} ${place.description} ${
        place.matchedQueries?.join(' ') ?? ''
      }`,
    );
    let score = 0;
    score += this.scoreDatePriority(place, dateContext);
    score += this.scoreDateRecommendationTypePriority(place, dateContext);

    if (dateContext.isWeekend) {
      score += place.type === 'ACTIVITY' ? 18 : 8;
    } else {
      score += place.type === 'RESTAURANT' || place.type === 'CAFE' ? 12 : 6;
    }

    if (dateContext.season === 'SUMMER' || dateContext.season === 'WINTER') {
      score += this.scoreByKeywords(text, INDOOR_COMFORT_KEYWORDS, 18);
      score += place.type === 'CAFE' ? 8 : 0;
      score += place.type === 'ACTIVITY' ? 6 : 0;
      score -= this.scoreByKeywords(text, WEATHER_SENSITIVE_KEYWORDS, 14);
    }

    if (dateContext.season === 'SPRING' || dateContext.season === 'FALL') {
      score += this.scoreByKeywords(text, WALKABLE_DATE_KEYWORDS, 14);
      score += place.type === 'ACTIVITY' ? 10 : 0;
    }

    return score;
  }

  private scoreDateRecommendationTypePriority(
    place: PlaceResponse,
    dateContext: DateRecommendationContext,
  ) {
    if (this.isDateLimitedEventPlace(place, dateContext)) {
      return 0;
    }

    if (place.type === 'ACTIVITY') {
      return 120;
    }

    return -1_000;
  }

  private scoreDatePriority(
    place: PlaceResponse,
    dateContext: DateRecommendationContext,
  ) {
    const resultText = this.getDatePriorityResultText(place);
    const matchedQueryText = this.normalize(
      place.matchedQueries?.join(' ') ?? '',
    );
    const hasExactDateInResult = this.getExactDateKeywords(dateContext).some(
      (keyword) => resultText.includes(this.normalize(keyword)),
    );
    const hasExactDateInQuery = this.getExactDateKeywords(dateContext).some(
      (keyword) => matchedQueryText.includes(this.normalize(keyword)),
    );
    const hasMonthInResult = resultText.includes(
      this.normalize(`${dateContext.month}월`),
    );
    const resultEventScore = this.scoreByKeywords(
      resultText,
      DATE_LIMITED_EVENT_KEYWORDS,
      34,
    );
    const queryEventScore = this.scoreByKeywords(
      matchedQueryText,
      DATE_LIMITED_EVENT_KEYWORDS,
      8,
    );
    const resultPopularScore = this.scoreByKeywords(
      resultText,
      POPULAR_PLACE_KEYWORDS,
      18,
    );
    const queryPopularScore = this.scoreByKeywords(
      matchedQueryText,
      POPULAR_PLACE_KEYWORDS,
      6,
    );
    let score =
      resultEventScore +
      queryEventScore +
      resultPopularScore +
      queryPopularScore;

    if (hasExactDateInResult && resultEventScore > 0) {
      score += 180;
    } else if (hasExactDateInResult) {
      score += 90;
    } else if (hasMonthInResult && resultEventScore > 0) {
      score += 80;
    } else if (hasExactDateInQuery && resultEventScore > 0) {
      score += 45;
    } else if (hasExactDateInQuery && queryEventScore > 0) {
      score += 20;
    }

    if (resultEventScore > 0) {
      score += place.type === 'ACTIVITY' ? 35 : 20;
    }

    return score;
  }

  private isDateLimitedEventPlace(
    place: PlaceResponse,
    dateContext: DateRecommendationContext,
  ) {
    const resultText = this.getDatePriorityResultText(place);
    const hasEventKeyword = DATE_LIMITED_EVENT_KEYWORDS.some((keyword) =>
      resultText.includes(this.normalize(keyword)),
    );

    if (!hasEventKeyword) {
      return false;
    }

    const hasExactDate = this.getExactDateKeywords(dateContext).some(
      (keyword) => resultText.includes(this.normalize(keyword)),
    );
    const hasMonth = resultText.includes(
      this.normalize(`${dateContext.month}월`),
    );
    const hasLimitedSignal = DATE_LIMITED_STRONG_KEYWORDS.some((keyword) =>
      resultText.includes(this.normalize(keyword)),
    );

    return hasExactDate || hasMonth || hasLimitedSignal;
  }

  private isDateEventSearchCandidate(
    place: PlaceResponse,
    dateContext: DateRecommendationContext,
  ) {
    if (this.isDateLimitedEventPlace(place, dateContext)) {
      return true;
    }

    const matchedQueryText = this.normalize(
      place.matchedQueries?.join(' ') ?? '',
    );
    const hasSelectedMonth = matchedQueryText.includes(
      this.normalize(this.formatKoreanMonthLabel(dateContext)),
    );
    const hasEventKeyword = DATE_LIMITED_EVENT_KEYWORDS.some((keyword) =>
      matchedQueryText.includes(this.normalize(keyword)),
    );

    return hasSelectedMonth && hasEventKeyword;
  }

  private getDatePriorityResultText(place: PlaceResponse) {
    return this.normalize(
      `${place.name} ${place.categoryName} ${place.description}`,
    );
  }

  private buildDateRecommendationReason(
    place: PlaceResponse,
    stationName: string,
    dateContext: DateRecommendationContext,
  ) {
    const snippet = this.extractReasonSnippet(place);
    if (snippet) return snippet;

    const dateReason = this.getShortDateReason(dateContext);
    const typeReason = this.getShortTypeReason(place.type);
    return `${this.toSearchStationName(stationName)} 근처에서 ${dateReason} ${typeReason} 좋아요.`;
  }

  private extractReasonSnippet(place: PlaceResponse): string | null {
    const desc = place.description?.trim();
    if (!desc || desc.length < 8) return null;

    const MAX = 80;

    // 첫 문장 끝 마커 위치
    const sentenceEnd = desc.search(/[.!?。]/);
    if (sentenceEnd > 5 && sentenceEnd <= MAX) {
      return desc.slice(0, sentenceEnd + 1);
    }

    if (desc.length <= MAX) return desc;

    // 단어 경계에서 자르기
    const cut = desc.lastIndexOf(' ', MAX);
    return desc.slice(0, cut > 20 ? cut : MAX) + '…';
  }

  private isDatePriorityPlace(
    place: PlaceResponse,
    dateContext: DateRecommendationContext,
  ) {
    if (this.isDateLimitedEventPlace(place, dateContext)) {
      return true;
    }

    const resultText = this.getDatePriorityResultText(place);

    return POPULAR_PLACE_KEYWORDS.some((keyword) =>
      resultText.includes(this.normalize(keyword)),
    );
  }

  private formatKoreanDateLabel(dateContext: DateRecommendationContext) {
    return `${dateContext.month}월 ${dateContext.day}일`;
  }

  private formatKoreanMonthLabel(dateContext: DateRecommendationContext) {
    return `${dateContext.year}년 ${dateContext.month}월`;
  }

  private getExactDateKeywords(dateContext: DateRecommendationContext) {
    return [
      dateContext.date,
      this.formatKoreanDateLabel(dateContext),
      `${dateContext.month}월${dateContext.day}일`,
    ];
  }

  private getShortDateReason(dateContext: DateRecommendationContext) {
    if (dateContext.season === 'SUMMER') {
      return '더운 날에도 부담 없이 머물기';
    }

    if (dateContext.season === 'WINTER') {
      return '추운 날 실내에서 편하게 보내기';
    }

    if (dateContext.isWeekend) {
      return '주말 데이트 코스로 들르기';
    }

    return '평일에 가볍게 들르기';
  }

  private getShortTypeReason(type: PlaceType) {
    if (type === 'ACTIVITY') {
      return '좋은 놀거리라';
    }

    if (type === 'CAFE') {
      return '좋은 카페라';
    }

    return '좋은 식당이라';
  }

  private toPlaceCategoryLabel(type: PlaceType) {
    if (type === 'RESTAURANT') {
      return '식당';
    }

    if (type === 'CAFE') {
      return '카페';
    }

    return '놀거리';
  }

  private rankPlaces(
    places: CandidatePlace[],
    type: PlaceType,
    mealTime?: MealTime,
  ): PlaceResponse[] {
    return places
      .map((place) => ({
        ...place,
        recommendationScore: this.scorePlace(place, type, mealTime),
      }))
      .sort((a, b) => {
        const scoreDiff =
          (b.recommendationScore ?? 0) - (a.recommendationScore ?? 0);

        if (scoreDiff !== 0) {
          return scoreDiff;
        }

        const matchedQueryDiff =
          b.matchedQueries.length - a.matchedQueries.length;

        if (matchedQueryDiff !== 0) {
          return matchedQueryDiff;
        }

        const aDistance = a.distanceMeters ?? Number.POSITIVE_INFINITY;
        const bDistance = b.distanceMeters ?? Number.POSITIVE_INFINITY;

        return aDistance - bDistance;
      });
  }

  private filterPlacesWithinStationDistance(
    places: CandidatePlace[],
    station: SubwayStation,
  ): CandidatePlace[] {
    const stationCoordinates = this.toValidCoordinates(station);

    if (!stationCoordinates) {
      return places;
    }

    return places.flatMap((place) => {
      const placeCoordinates = this.toValidCoordinates(place);

      if (!placeCoordinates) {
        return [];
      }

      const distanceMeters = Math.round(
        this.calculateStraightLineDistanceMeters(
          stationCoordinates,
          placeCoordinates,
        ),
      );

      if (distanceMeters > PLACE_DISTANCE_LIMIT_METERS) {
        return [];
      }

      return [
        {
          ...place,
          distanceMeters,
        },
      ];
    });
  }

  private toValidCoordinates(value: {
    lat: number | string | null;
    lng: number | string | null;
  }): Coordinates | null {
    if (value.lat === null || value.lng === null) {
      return null;
    }

    const lat = Number(value.lat);
    const lng = Number(value.lng);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return null;
    }

    return { lat, lng };
  }

  private calculateStraightLineDistanceMeters(
    from: Coordinates,
    to: Coordinates,
  ) {
    const fromLat = this.toRadians(from.lat);
    const toLat = this.toRadians(to.lat);
    const deltaLat = this.toRadians(to.lat - from.lat);
    const deltaLng = this.toRadians(to.lng - from.lng);

    const halfChordLength =
      Math.sin(deltaLat / 2) ** 2 +
      Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) ** 2;
    const angularDistance =
      2 *
      Math.atan2(Math.sqrt(halfChordLength), Math.sqrt(1 - halfChordLength));

    return EARTH_RADIUS_METERS * angularDistance;
  }

  private toRadians(value: number) {
    return (value * Math.PI) / 180;
  }

  private scorePlace(
    place: CandidatePlace,
    type: PlaceType,
    mealTime?: MealTime,
  ) {
    const text = this.normalize(
      `${place.name} ${place.categoryName} ${place.description ?? ''} ${place.address ?? ''}`,
    );
    const matchedQueryText = this.normalize(place.matchedQueries.join(' '));
    let score = 0;

    score += place.matchedQueries.length * 25;
    score += this.scoreByKeywords(matchedQueryText, INTENT_KEYWORDS, 18);
    score += this.scoreByKeywords(text, STRONG_DATE_KEYWORDS, 18);
    score += this.scoreByKeywords(text, MOOD_KEYWORDS, 12);
    score += this.scoreByKeywords(text, MODERATE_DATE_KEYWORDS, 8);
    score += this.scoreByKeywords(text, GENERAL_OK_KEYWORDS, 4);

    if (type === 'RESTAURANT') {
      score += this.scoreRestaurantByMealTime(text, mealTime);
    }

    if (type === 'CAFE') {
      score += this.scoreByKeywords(text, CAFE_KEYWORDS, 16);
    }

    if (type === 'ACTIVITY') {
      score += this.scoreByKeywords(text, ACTIVITY_KEYWORDS, 16);
      score += this.scoreByKeywords(text, DATE_LIMITED_EVENT_KEYWORDS, 28);
      score += this.scoreByKeywords(
        matchedQueryText,
        DATE_LIMITED_EVENT_KEYWORDS,
        12,
      );
    }

    score -= this.scoreByKeywords(text, FRANCHISE_KEYWORDS, 35);
    score -= this.scoreByKeywords(text, LOW_DATE_FIT_KEYWORDS, 45);
    score -= this.scoreBranchLikeName(place.name);

    // 역에서 가까울수록 소폭 가산 (최대 +10, 2km에서 0)
    if (place.distanceMeters !== null) {
      score += Math.round(
        10 * (1 - place.distanceMeters / PLACE_DISTANCE_LIMIT_METERS),
      );
    }

    return score;
  }

  private scoreRestaurantByMealTime(text: string, mealTime?: MealTime) {
    if (!mealTime) {
      return 0;
    }

    if (mealTime === 'LUNCH') {
      return (
        this.scoreByKeywords(text, LUNCH_POSITIVE_KEYWORDS, 14) -
        this.scoreByKeywords(text, LUNCH_NEGATIVE_KEYWORDS, 16)
      );
    }

    return (
      this.scoreByKeywords(text, DINNER_POSITIVE_KEYWORDS, 14) -
      this.scoreByKeywords(text, DINNER_NEGATIVE_KEYWORDS, 12)
    );
  }

  private scoreByKeywords(text: string, keywords: string[], weight: number) {
    let score = 0;

    for (const keyword of keywords) {
      if (text.includes(this.normalize(keyword))) {
        score += weight;
      }
    }

    return score;
  }

  private scoreBranchLikeName(name: string) {
    const normalizedName = this.normalize(name);
    let penalty = 0;

    for (const keyword of BRANCH_LIKE_KEYWORDS) {
      if (normalizedName.includes(this.normalize(keyword))) {
        penalty += 8;
      }
    }

    return penalty;
  }

  private getDedupKey(place: PlaceResponse) {
    if (place.naverPlaceId) {
      return `naver:${place.naverPlaceId}`;
    }

    return `${this.normalize(place.name)}:${this.normalize(place.address ?? '')}`;
  }

  private createPlaceKey(
    provider: 'NAVER' | 'KAKAO',
    externalId: string | null,
    name: string,
    address: string | null,
  ) {
    if (externalId) {
      return `${provider.toLowerCase()}:${externalId}`;
    }

    const hash = createHash('sha1')
      .update(
        `${provider}:${this.normalize(name)}:${this.normalize(address ?? '')}`,
      )
      .digest('hex')
      .slice(0, 24);

    return `${provider.toLowerCase()}:hash:${hash}`;
  }

  private extractNaverPlaceId(link: string) {
    const match = link.match(/\/place\/(\d+)/);

    return match?.[1] ?? null;
  }

  private classifyPlaceLink(link: string) {
    if (!link) {
      return {
        externalLink: null,
        mapLink: null,
        instagramLink: null,
        reservationLink: null,
      };
    }

    const normalizedLink = link.toLowerCase();

    if (
      normalizedLink.includes('instagram.com') ||
      normalizedLink.includes('instagr.am')
    ) {
      return {
        externalLink: null,
        mapLink: null,
        instagramLink: link,
        reservationLink: null,
      };
    }

    if (
      normalizedLink.includes('catchtable.co.kr') ||
      normalizedLink.includes('app.catchtable') ||
      normalizedLink.includes('catchtable')
    ) {
      return {
        externalLink: null,
        mapLink: null,
        instagramLink: null,
        reservationLink: link,
      };
    }

    if (
      normalizedLink.includes('booking.naver.com') ||
      normalizedLink.includes('m.booking.naver.com')
    ) {
      return {
        externalLink: null,
        mapLink: null,
        instagramLink: null,
        reservationLink: link,
      };
    }

    if (this.isMapLink(normalizedLink)) {
      return {
        externalLink: link,
        mapLink: link,
        instagramLink: null,
        reservationLink: null,
      };
    }

    return {
      externalLink: link,
      mapLink: null,
      instagramLink: null,
      reservationLink: null,
    };
  }

  private isMapLink(normalizedLink: string) {
    return (
      normalizedLink.includes('map.naver.com') ||
      normalizedLink.includes('m.place.naver.com') ||
      normalizedLink.includes('pcmap.place.naver.com') ||
      normalizedLink.includes('place.map.kakao.com') ||
      /\/place\/\d+/.test(normalizedLink)
    );
  }

  private stripHtml(value: string) {
    return value
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .trim();
  }

  private truncateForLog(value: string, maxLength: number) {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength)}...`;
  }

  private normalize(value: string) {
    return value.toLowerCase().replace(/\s+/g, '');
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private validatePlaceType(type: string): asserts type is PlaceType {
    if (!PLACE_TYPES.includes(type as PlaceType)) {
      throw new BadRequestException(
        'type은 RESTAURANT, CAFE, ACTIVITY 중 하나여야 합니다.',
      );
    }
  }

  private validateMealTime(type: PlaceType, mealTime?: MealTime) {
    if (!mealTime) {
      return;
    }

    if (type !== 'RESTAURANT') {
      throw new BadRequestException(
        'mealTime은 type이 RESTAURANT일 때만 사용할 수 있습니다.',
      );
    }

    if (!MEAL_TIMES.includes(mealTime)) {
      throw new BadRequestException('mealTime은 LUNCH 또는 DINNER여야 합니다.');
    }
  }
}

const INTENT_KEYWORDS = [
  '데이트',
  '핫플',
  '분위기',
  '감성',
  '추천',
  '가볼만한',
  '맛집',
];

const DATE_LIMITED_EVENT_KEYWORDS = [
  '팝업',
  '팝업스토어',
  '기간한정',
  '한정',
  '하루만',
  '이벤트',
  '축제',
  '페스티벌',
  '전시',
  '기획전',
  '마켓',
  '플리마켓',
  '시즌',
  '오픈',
];

const DATE_LIMITED_STRONG_KEYWORDS = [
  '팝업',
  '팝업스토어',
  '기간한정',
  '한정',
  '하루만',
  '이벤트',
  '축제',
  '페스티벌',
  '기획전',
  '플리마켓',
];

const DATE_EVENT_NAME_STOPWORDS = [
  '팝업',
  '팝업스토어',
  '팝업전시',
  '전시',
  '전시회',
  '이벤트',
  '축제',
  '기간한정',
  '한정',
  '성수',
  '성수역',
  '서울',
];

const POPULAR_PLACE_KEYWORDS = [
  '인기',
  '핫플',
  '요즘',
  '신상',
  '추천',
  '웨이팅',
  '예약',
];

const ACTIVITY_EXCLUDED_CATEGORY_KEYWORDS = [
  '음식점',
  '카페',
  '디저트',
  '베이커리',
  '커피',
  '술집',
  '주점',
  '호프',
  '바',
];

const BROAD_SEARCH_REGION_NAMES = ['수도권', '전국', '전체'];

const STRONG_DATE_KEYWORDS = [
  '다이닝',
  '비스트로',
  '와인',
  '와인바',
  '오마카세',
  '스시',
  '초밥',
  '이자카야',
  '프렌치',
  '이탈리안',
  '파스타',
  '스테이크',
  '브런치',
  '멕시칸',
  '타코',
  '칵테일',
  '루프탑',
];

const MOOD_KEYWORDS = [
  '카페',
  '디저트',
  '베이커리',
  '브런치',
  '바',
  '펍',
  '라운지',
  '갤러리',
  '전시',
  '소품',
  '편집샵',
  '공방',
  '스튜디오',
  '테라스',
  '한옥',
  '정원',
  '리버뷰',
  '뷰',
  '공간',
];

const MODERATE_DATE_KEYWORDS = [
  '양식',
  '일식',
  '롤',
  '사시미',
  '돈카츠',
  '라멘',
  '피자',
  '그릭',
  '샐러드',
  '아시안',
  '태국',
  '베트남',
  '요리주점',
  '호프',
  '술집',
];

const GENERAL_OK_KEYWORDS = [
  '한식',
  '육류',
  '고기',
  '구이',
  '해물',
  '생선',
  '장어',
  '낙지',
  '오리',
  '샤브샤브',
  '중식',
  '중화요리',
];

const CAFE_KEYWORDS = [
  '카페',
  '디저트',
  '베이커리',
  '브런치',
  '케이크',
  '커피',
  '로스터리',
  '티룸',
  '한옥',
  '테라스',
  '정원',
];

const ACTIVITY_KEYWORDS = [
  '전시',
  '미술관',
  '박물관',
  '갤러리',
  '공방',
  '소품샵',
  '편집샵',
  '서점',
  '독립서점',
  '영화관',
  '공원',
  '산책',
  '문화',
  '체험',
];

const INDOOR_COMFORT_KEYWORDS = [
  '실내',
  '전시',
  '미술관',
  '박물관',
  '갤러리',
  '영화관',
  '아쿠아리움',
  '공방',
  '카페',
  '디저트',
  '빙수',
  '서점',
  '편집샵',
];

const WEATHER_SENSITIVE_KEYWORDS = ['공원', '산책', '테라스', '루프탑', '야외'];

const WALKABLE_DATE_KEYWORDS = [
  '공원',
  '산책',
  '거리',
  '시장',
  '전시',
  '갤러리',
  '소품샵',
  '편집샵',
  '서점',
  '테라스',
];

const LUNCH_POSITIVE_KEYWORDS = [
  '브런치',
  '샐러드',
  '파스타',
  '피자',
  '돈카츠',
  '쌀국수',
  '덮밥',
  '라멘',
  '초밥',
  '롤',
  '한식',
  '백반',
  '국수',
  '베이커리',
  '카페',
];

const LUNCH_NEGATIVE_KEYWORDS = [
  '술집',
  '호프',
  '요리주점',
  '이자카야',
  '바',
  '펍',
  '칵테일',
  '라운지',
];

const DINNER_POSITIVE_KEYWORDS = [
  '와인',
  '와인바',
  '다이닝',
  '비스트로',
  '스테이크',
  '오마카세',
  '이자카야',
  '사시미',
  '고기',
  '구이',
  '곱창',
  '막창',
  '족발',
  '보쌈',
  '요리주점',
  '술집',
  '호프',
  '바',
  '펍',
  '칵테일',
];

const DINNER_NEGATIVE_KEYWORDS = ['분식', '백반', '국수', '김밥', '도시락'];

const FRANCHISE_KEYWORDS = [
  '스타벅스',
  '투썸플레이스',
  '이디야',
  '메가커피',
  '컴포즈커피',
  '빽다방',
  '할리스',
  '커피빈',
  '파리바게뜨',
  '뚜레쥬르',
  '던킨',
  '배스킨라빈스',
  '맥도날드',
  '버거킹',
  '롯데리아',
  '맘스터치',
  '서브웨이',
  '김밥천국',
  '김가네',
  '본죽',
  '한솥',
  '홍콩반점',
  '새마을식당',
  '역전우동',
  '명륜진사갈비',
  '고봉민김밥',
  '노브랜드버거',
];

const LOW_DATE_FIT_KEYWORDS = [
  '편의점',
  '은행',
  '약국',
  '병원',
  '의원',
  '주차장',
  '화장실',
  '부동산',
  '마트',
  '슈퍼',
  '구내식당',
  '푸드코트',
  '고시원',
  '모텔',
  '노래방',
  'pc방',
  '피시방',
  '당구장',
  '스크린골프',
];

const BRANCH_LIKE_KEYWORDS = [
  '지점',
  '역점',
  '센터점',
  '몰점',
  '백화점',
  '마트점',
  '터미널점',
  '플라자점',
];
