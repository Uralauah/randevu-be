import { Injectable, Logger } from '@nestjs/common';
import { SubwayStation } from '../stations/entities';
import { NaverLocalClient, NaverLocalItem } from './naver-local.client';
import { KakaoLocalClient } from './kakao-local.client';
import {
  CandidatePlace,
  MealTime,
  PlaceResponse,
  PlaceType,
} from './places.type';
import {
  ACTIVITY_EXCLUDED_CATEGORY_KEYWORDS,
  DATE_LIMITED_EVENT_KEYWORDS,
  KAKAO_CATEGORY_CODES_BY_TYPE,
  KAKAO_SEARCH_SIZE,
  NAVER_DISPLAY_PER_QUERY,
  NAVER_LOCAL_QUERY_DELAY_MS,
  NAVER_QUERY_CONCURRENCY,
  PLACE_CATEGORY_CONFIG,
  PLACE_DISTANCE_LIMIT_METERS,
} from './places.constants';
import {
  calculateStraightLineDistanceMeters,
  classifyPlaceLink,
  createPlaceKey,
  DateRecommendationContext,
  delay,
  extractNaverPlaceId,
  formatKoreanDateLabel,
  formatKoreanMonthLabel,
  getDedupKey,
  normalize,
  stripHtml,
  toSearchLocationName,
  toValidCoordinates,
} from './places.util';

interface FetchNaverCandidateOptions {
  skipTypeCompatibility?: boolean;
}

@Injectable()
export class PlaceSearchService {
  private readonly logger = new Logger(PlaceSearchService.name);

  constructor(
    private readonly naverLocalClient: NaverLocalClient,

    private readonly kakaoLocalClient: KakaoLocalClient,
  ) {}

  async fetchNaverCandidates(
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
            .searchLocal({
              query,
              display: NAVER_DISPLAY_PER_QUERY,
              sort: 'comment',
            })
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
        await delay(NAVER_LOCAL_QUERY_DELAY_MS);
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

        const key = getDedupKey(place);
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

  /**
   * 카카오 로컬 카테고리 검색으로 역 반경 내 후보를 가져온다.
   * radius 기반이라 좌표 정확도가 높고, 네이버 키워드 결과를 보강한다.
   */
  async fetchKakaoCandidates(
    station: SubwayStation,
    type: PlaceType,
  ): Promise<CandidatePlace[]> {
    const coords = toValidCoordinates(station);

    if (!coords) {
      return [];
    }

    const codes = KAKAO_CATEGORY_CODES_BY_TYPE[type] ?? [];
    const merged = new Map<string, CandidatePlace>();

    const results = await Promise.allSettled(
      codes.map((code) =>
        this.kakaoLocalClient.searchByCategory({
          categoryGroupCode: code,
          lat: coords.lat,
          lng: coords.lng,
          radius: PLACE_DISTANCE_LIMIT_METERS,
          size: KAKAO_SEARCH_SIZE,
        }),
      ),
    );

    for (const result of results) {
      if (result.status !== 'fulfilled') {
        continue;
      }

      for (const document of result.value) {
        const place = this.toKakaoPlaceResponse(document, type);

        if (!this.isPlaceCompatibleWithType(place, type)) {
          continue;
        }

        const key = getDedupKey(place);

        if (!merged.has(key)) {
          merged.set(key, { ...place, matchedQueries: ['카카오 주변'] });
        }
      }
    }

    return [...merged.values()];
  }

  private toKakaoPlaceResponse(
    document: {
      id: string;
      place_name: string;
      category_name: string;
      phone: string;
      address_name: string;
      road_address_name: string;
      x: string;
      y: string;
      place_url: string;
      distance?: string;
    },
    type: PlaceType,
  ): PlaceResponse {
    const name = stripHtml(document.place_name);
    const address = document.road_address_name || document.address_name || null;
    const placeUrl = document.place_url || null;
    const distanceMeters =
      document.distance && document.distance.length > 0
        ? Number(document.distance)
        : null;

    return {
      placeKey: createPlaceKey('KAKAO', document.id, name, address),
      kakaoPlaceId: document.id,
      naverPlaceId: null,
      provider: 'KAKAO',
      type,
      name,
      description: '',
      categoryName: document.category_name || '',
      address,
      lat: document.y ? Number(document.y) : null,
      lng: document.x ? Number(document.x) : null,
      distanceMeters: Number.isFinite(distanceMeters as number)
        ? distanceMeters
        : null,
      phone: document.phone || null,
      mapLink: placeUrl,
      externalLink: placeUrl,
      instagramLink: null,
      reservationLink: null,
      matchedQueries: [],
    };
  }

  mergeCandidatePools(
    primary: CandidatePlace[],
    supplementary: CandidatePlace[],
  ): CandidatePlace[] {
    const merged = new Map<string, CandidatePlace>();

    for (const candidate of [...primary, ...supplementary]) {
      const key = getDedupKey(candidate);
      const existing = merged.get(key);

      if (existing) {
        existing.matchedQueries.push(...candidate.matchedQueries);
        continue;
      }

      merged.set(key, { ...candidate });
    }

    return [...merged.values()];
  }

  toPlaceResponse(item: NaverLocalItem, type: PlaceType): PlaceResponse {
    const name = stripHtml(item.title);
    const naverPlaceId = extractNaverPlaceId(item.link);
    const address = item.roadAddress || item.address || null;
    const placeKey = createPlaceKey('NAVER', naverPlaceId, name, address);
    const links = classifyPlaceLink(item.link);

    return {
      placeKey,
      kakaoPlaceId: null,
      naverPlaceId,
      provider: 'NAVER',
      type,
      name,
      description: stripHtml(item.description),
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

  private isPlaceCompatibleWithType(
    place: PlaceResponse,
    type: PlaceType,
    query?: string,
  ) {
    if (type !== 'ACTIVITY') {
      return true;
    }

    const eventText = normalize(
      `${place.name} ${place.categoryName} ${place.description} ${query ?? ''}`,
    );

    if (
      DATE_LIMITED_EVENT_KEYWORDS.some((keyword) =>
        eventText.includes(normalize(keyword)),
      )
    ) {
      return true;
    }

    const categoryText = normalize(place.categoryName);

    return !ACTIVITY_EXCLUDED_CATEGORY_KEYWORDS.some((keyword) =>
      categoryText.includes(normalize(keyword)),
    );
  }

  buildSearchQueries(
    station: SubwayStation,
    type: PlaceType,
    mealTime?: MealTime,
  ) {
    const base = toSearchLocationName(station);

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
        `${base} 인스타 카페`,
        `${base} SNS 핫플 카페`,
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
        `${base} 인스타 핫플`,
        `${base} SNS 핫플`,
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
        `${base} 인스타 점심 맛집`,
        `${base} 요즘 핫한 점심`,
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
        `${base} 인스타 저녁 맛집`,
        `${base} 요즘 핫한 식당`,
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
      `${base} 인스타 맛집`,
      `${base} SNS 맛집`,
    ];
  }

  buildDateRecommendationFallbackSearchQueries(
    station: SubwayStation,
    type: PlaceType,
    dateContext: DateRecommendationContext,
  ) {
    const base = toSearchLocationName(station);

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

  buildDatePrioritySearchQueries(
    base: string,
    type: PlaceType,
    dateContext: DateRecommendationContext,
  ) {
    const monthLabel = formatKoreanMonthLabel(dateContext);
    const dateLabel = formatKoreanDateLabel(dateContext);

    if (type === 'ACTIVITY') {
      // 고신호 쿼리만 유지 (중복 변형 제거 → 외부 호출 수 절감)
      return [
        `${dateLabel} ${base} 팝업`,
        `${monthLabel} ${base} 팝업스토어`,
        `${monthLabel} ${base} 팝업 전시`,
        `${monthLabel} ${base} 전시`,
        `${monthLabel} ${base} 이벤트`,
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

  filterPlacesWithinStationDistance(
    places: CandidatePlace[],
    station: SubwayStation,
  ): CandidatePlace[] {
    const stationCoordinates = toValidCoordinates(station);

    if (!stationCoordinates) {
      return places;
    }

    return places.flatMap((place) => {
      const placeCoordinates = toValidCoordinates(place);

      if (!placeCoordinates) {
        return [];
      }

      const distanceMeters = Math.round(
        calculateStraightLineDistanceMeters(
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

  buildCategorySearchQueries(
    station: SubwayStation,
    type: PlaceType,
    mealTime: MealTime | undefined,
    category: string,
  ): string[] {
    const config = PLACE_CATEGORY_CONFIG[type]?.[category];
    if (!config) {
      return this.buildSearchQueries(station, type, mealTime);
    }

    const base = toSearchLocationName(station);

    // 카테고리 전용 쿼리 (역명을 앞에 붙임)
    const categoryQueries = config.queries.map((q) => `${base} ${q}`);

    // 분위기/데이트 보완 쿼리: 카테고리 특성 + 데이트 맥락 유지
    const supplementQueries = this.buildCategorySupplementQueries(
      base,
      type,
      mealTime,
      category,
    );

    return [...categoryQueries, ...supplementQueries];
  }

  private buildCategorySupplementQueries(
    base: string,
    type: PlaceType,
    mealTime: MealTime | undefined,
    category: string,
  ): string[] {
    if (type === 'RESTAURANT') {
      const timeLabel =
        mealTime === 'DINNER' ? '저녁' : mealTime === 'LUNCH' ? '점심' : '';
      return [
        `${base} ${category} 데이트 맛집`,
        `${base} ${category} 분위기 좋은${timeLabel ? ' ' + timeLabel : ''}`,
      ];
    }
    if (type === 'CAFE') {
      return [`${base} ${category} 추천`, `${base} 데이트 카페 ${category}`];
    }
    return [`${base} ${category} 데이트`, `${base} ${category} 추천`];
  }
}
