import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubwayStation } from '../stations/entities';
import { NaverLocalClient } from './naver-local.client';
import {
  CandidatePlace,
  MEAL_TIMES,
  PLACE_TYPES,
  MealTime,
  PlaceDateRecommendationResponse,
  PlaceDetailResponse,
  PlaceResponse,
  PlaceType,
} from './places.type';
import { PlaceCache } from './entities';
import { NaverBlogClient } from './naver-blog.client';
import { PlaceTagService } from './place-tag.service';
import { PlaceScoringService } from './place-scoring.service';
import { PlaceSearchService } from './place-search.service';
import { BlogDateEventService } from './blog-date-event.service';
import {
  DATE_RECOMMENDATION_TYPE_ORDER,
  KEYWORD_SEARCH_DISPLAY,
  KEYWORD_SEARCH_DISTANCE_LIMIT_METERS,
  PLACE_CATEGORY_CONFIG,
  PLACE_LIST_CACHE_TTL_MS,
  PLACE_SEARCH_DISPLAY,
  RECOMMENDATION_CACHE_TTL_MS,
  RESPONSE_LIMIT_BY_TYPE,
} from './places.constants';
import {
  calculateStraightLineDistanceMeters,
  Coordinates,
  DateRecommendationContext,
  getDedupKey,
  normalize,
  parseDateRecommendationContext,
  toSearchLocationName,
  toSearchStationAreaName,
  toValidCoordinates,
} from './places.util';

interface CoursePlaceExclusions {
  placeKeys: Set<string>;
  nameAddressKeys: Set<string>;
  nameCoordinateKeys: Set<string>;
  nameKeys: Set<string>;
}

@Injectable()
export class PlacesService {
  private readonly logger = new Logger(PlacesService.name);
  private readonly placeListCache = new Map<
    string,
    { places: PlaceResponse[]; expiresAt: number }
  >();
  private readonly recommendationCache = new Map<
    string,
    { candidates: PlaceResponse[]; expiresAt: number }
  >();

  constructor(
    @InjectRepository(SubwayStation)
    private readonly stationRepository: Repository<SubwayStation>,

    @InjectRepository(PlaceCache)
    private readonly placeCacheRepository: Repository<PlaceCache>,

    private readonly naverLocalClient: NaverLocalClient,

    private readonly naverBlogClient: NaverBlogClient,

    private readonly placeTagService: PlaceTagService,

    private readonly placeScoringService: PlaceScoringService,

    private readonly placeSearchService: PlaceSearchService,

    private readonly blogDateEventService: BlogDateEventService,
  ) {}

  async findPlacesByStation(
    stationId: number,
    type: PlaceType,
    mealTime?: MealTime,
    excludedPlaceKeys?: string,
    category?: string,
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

    const normalizedCategory = this.normalizeCategory(type, category);
    const cacheKey = `${stationId}:${type}:${mealTime ?? 'none'}:${normalizedCategory ?? 'all'}`;
    let allPlaces = this.getPlaceListCache(cacheKey);

    if (!allPlaces) {
      allPlaces = await this.searchPlaces(
        station,
        type,
        mealTime,
        normalizedCategory,
      );
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

    const cacheKey = `search:${type}:${stationId ?? 'none'}:${normalize(query)}`;
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
      .map((item) => this.placeSearchService.toPlaceResponse(item, type))
      .filter((place) => {
        const dedupKey = getDedupKey(place);
        if (seen.has(dedupKey)) return false;
        seen.add(dedupKey);
        return true;
      });

    // 역 좌표 기준으로 거리 계산 → 정렬 → 원거리 제거 (역 정보 재사용)
    const stationCoords = station ? toValidCoordinates(station) : null;

    const places: PlaceResponse[] = stationCoords
      ? candidates
          .map((p) => {
            const coords = toValidCoordinates(p);
            const distanceMeters = coords
              ? Math.round(
                  calculateStraightLineDistanceMeters(stationCoords, coords),
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

    this.cachePlacesInBackground(places);
    this.setPlaceListCache(cacheKey, places);

    return { source: 'NAVER' as const, type, query, places };
  }

  /**
   * 검색어에 지역명이 포함되지 않은 경우 역 지역명을 앞에 추가한다.
   * 이미 역 이름 또는 지역을 나타내는 접미사(역·구·동·로 등)를 가진 토큰이
   * 검색어 어디에든 있으면 그대로 반환.
   */
  private buildLocationAwareQuery(
    query: string,
    station: SubwayStation,
  ): string {
    const areaName = toSearchStationAreaName(station.name); // "성수역" → "성수"
    const normalizedQuery = normalize(query);

    // 이미 역 지역명이 포함된 경우
    if (normalizedQuery.includes(normalize(areaName))) {
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
    const dateContext = parseDateRecommendationContext(date);
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

    // 팝업·이벤트는 월 단위로 운영되므로 역+월로 캐시해 hit rate를 높인다.
    const cacheKey = `rec:${stationId}:${dateContext.year}-${dateContext.month}`;
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

    this.cachePlacesInBackground([recommendation]);

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
        category: this.placeScoringService.toPlaceCategoryLabel(
          recommendation.type,
        ),
        reason: this.placeScoringService.buildDateRecommendationReason(
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
      const base = toSearchLocationName(station);
      const blogCandidates =
        type === 'ACTIVITY'
          ? await this.blogDateEventService.fetchDateEventCandidatesFromBlogs(
              station,
              base,
              dateContext,
            )
          : [];

      if (blogCandidates.length > 0) {
        const places = this.placeScoringService
          .rankPlaces(blogCandidates, type)
          .map((place) => ({
            ...place,
            recommendationScore:
              (place.recommendationScore ?? 0) +
              this.placeScoringService.scorePlaceByDateContext(
                place,
                dateContext,
              ),
          }));

        if (places.length > 0) {
          recommendationGroups.push(places);
          break;
        }
      }

      const priorityQueries =
        this.placeSearchService.buildDatePrioritySearchQueries(
          base,
          type,
          dateContext,
        );
      const candidates = await this.placeSearchService.fetchNaverCandidates(
        priorityQueries,
        type,
      );
      const nearbyCandidates =
        this.placeSearchService.filterPlacesWithinStationDistance(
          candidates,
          station,
        );
      let selectedCandidates = nearbyCandidates.filter((place) =>
        this.placeScoringService.isDateEventSearchCandidate(place, dateContext),
      );

      if (selectedCandidates.length === 0) {
        const fallbackQueries =
          this.placeSearchService.buildDateRecommendationFallbackSearchQueries(
            station,
            type,
            dateContext,
          );
        // 네이버 fallback과 카카오 반경 검색을 병렬 실행 후 병합 (추가 지연 없음)
        const [naverFallback, kakaoCandidates] = await Promise.all([
          this.placeSearchService.fetchNaverCandidates(fallbackQueries, type),
          this.placeSearchService.fetchKakaoCandidates(station, type),
        ]);
        const naverNearby =
          this.placeSearchService.filterPlacesWithinStationDistance(
            naverFallback,
            station,
          );
        const kakaoNearby =
          this.placeSearchService.filterPlacesWithinStationDistance(
            kakaoCandidates,
            station,
          );
        selectedCandidates = this.placeSearchService.mergeCandidatePools(
          naverNearby,
          kakaoNearby,
        );
      }

      const places = this.placeScoringService
        .rankPlaces(selectedCandidates, type)
        .map((place) => ({
          ...place,
          recommendationScore:
            (place.recommendationScore ?? 0) +
            this.placeScoringService.scorePlaceByDateContext(
              place,
              dateContext,
            ),
        }));

      recommendationGroups.push(places);

      if (type === 'ACTIVITY' && places.length > 0) {
        break;
      }
    }

    const sortedCandidates = recommendationGroups.flat().sort((a, b) => {
      const dateLimitedEventDiff =
        Number(
          this.placeScoringService.isDateLimitedEventPlace(b, dateContext),
        ) -
        Number(
          this.placeScoringService.isDateLimitedEventPlace(a, dateContext),
        );

      if (dateLimitedEventDiff !== 0) return dateLimitedEventDiff;

      const activityTypeDiff =
        Number(b.type === 'ACTIVITY') - Number(a.type === 'ACTIVITY');

      if (activityTypeDiff !== 0) return activityTypeDiff;

      const coordinateDiff =
        Number(toValidCoordinates(b) !== null) -
        Number(toValidCoordinates(a) !== null);

      if (coordinateDiff !== 0) return coordinateDiff;

      const scoreDiff =
        (b.recommendationScore ?? 0) - (a.recommendationScore ?? 0);

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

  private setRecommendationCache(
    key: string,
    candidates: PlaceResponse[],
  ): void {
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

    const coordinates = toValidCoordinates(place);

    if (
      coordinates &&
      exclusions.nameCoordinateKeys.has(
        this.createNameCoordinateKey(place.name, coordinates),
      )
    ) {
      return true;
    }

    return exclusions.nameKeys.has(normalize(place.name));
  }

  private createNameAddressKey(name: string, address: string) {
    return `${normalize(name)}:${normalize(address)}`;
  }

  private createNameCoordinateKey(name: string, coordinates: Coordinates) {
    return `${normalize(name)}:${coordinates.lat.toFixed(
      5,
    )}:${coordinates.lng.toFixed(5)}`;
  }

  private async searchPlaces(
    station: SubwayStation,
    type: PlaceType,
    mealTime?: MealTime,
    category?: string,
  ): Promise<PlaceResponse[]> {
    const queries = category
      ? this.placeSearchService.buildCategorySearchQueries(
          station,
          type,
          mealTime,
          category,
        )
      : this.placeSearchService.buildSearchQueries(station, type, mealTime);

    const candidates = await this.placeSearchService.fetchNaverCandidates(
      queries,
      type,
    );
    const nearbyCandidates =
      this.placeSearchService.filterPlacesWithinStationDistance(
        candidates,
        station,
      );
    const rankedPlaces = this.placeScoringService.rankPlaces(
      nearbyCandidates,
      type,
      mealTime,
      category,
    );

    const qualifiedPlaces = rankedPlaces.filter(
      (place) => (place.recommendationScore ?? 0) > 0,
    );
    const decentPlaces = rankedPlaces.filter(
      (place) => (place.recommendationScore ?? 0) >= 0,
    );

    const finalPlaces =
      qualifiedPlaces.length >= 5
        ? qualifiedPlaces
        : decentPlaces.length >= 5
          ? decentPlaces
          : rankedPlaces;

    const selectedPlaces = finalPlaces.slice(0, RESPONSE_LIMIT_BY_TYPE[type]);

    this.cachePlacesInBackground(selectedPlaces);

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

  /**
   * 장소 영속 캐시 저장은 응답 경로의 임계 지연에 포함될 필요가 없다.
   * (상세 조회 시점에 사용되는 보조 데이터) 백그라운드로 수행해 응답을 먼저 반환한다.
   */
  private cachePlacesInBackground(places: PlaceResponse[]): void {
    void this.cachePlaces(places).catch((error) =>
      this.logger.warn(
        `장소 캐시 저장 실패: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    );
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

  private normalizeCategory(
    type: PlaceType,
    category?: string,
  ): string | undefined {
    if (!category) return undefined;
    const config = PLACE_CATEGORY_CONFIG[type];
    if (!config) return undefined;
    // 전달된 카테고리가 해당 타입에 유효한지 검증 후 반환
    return Object.keys(config).includes(category) ? category : undefined;
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
