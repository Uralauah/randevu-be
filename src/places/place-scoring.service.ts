import { Injectable } from '@nestjs/common';
import {
  CandidatePlace,
  MealTime,
  PlaceResponse,
  PlaceType,
} from './places.type';
import {
  ACTIVITY_KEYWORDS,
  CAFE_KEYWORDS,
  DATE_LIMITED_EVENT_KEYWORDS,
  DATE_LIMITED_STRONG_KEYWORDS,
  DINNER_NEGATIVE_KEYWORDS,
  DINNER_POSITIVE_KEYWORDS,
  FRANCHISE_KEYWORDS,
  GENERAL_OK_KEYWORDS,
  INDOOR_COMFORT_KEYWORDS,
  INTENT_KEYWORDS,
  LOW_DATE_FIT_KEYWORDS,
  LUNCH_NEGATIVE_KEYWORDS,
  LUNCH_POSITIVE_KEYWORDS,
  MODERATE_DATE_KEYWORDS,
  MOOD_KEYWORDS,
  PLACE_CATEGORY_CONFIG,
  PLACE_DISTANCE_LIMIT_METERS,
  POPULAR_PLACE_KEYWORDS,
  STRONG_DATE_KEYWORDS,
  WALKABLE_DATE_KEYWORDS,
  WEATHER_SENSITIVE_KEYWORDS,
} from './places.constants';
import {
  DateRecommendationContext,
  formatKoreanMonthLabel,
  getExactDateKeywords,
  normalize,
  scoreBranchLikeName,
  scoreByKeywords,
  toSearchStationName,
} from './places.util';

@Injectable()
export class PlaceScoringService {
  rankPlaces(
    places: CandidatePlace[],
    type: PlaceType,
    mealTime?: MealTime,
    category?: string,
  ): PlaceResponse[] {
    return places
      .map((place) => ({
        ...place,
        recommendationScore: this.scorePlace(place, type, mealTime, category),
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

  private scorePlace(
    place: CandidatePlace,
    type: PlaceType,
    mealTime?: MealTime,
    category?: string,
  ) {
    const text = normalize(
      `${place.name} ${place.categoryName} ${place.description ?? ''} ${place.address ?? ''}`,
    );
    const matchedQueryText = normalize(place.matchedQueries.join(' '));
    let score = 0;

    score += place.matchedQueries.length * 25;
    score += scoreByKeywords(matchedQueryText, INTENT_KEYWORDS, 18);
    score += scoreByKeywords(text, STRONG_DATE_KEYWORDS, 18);
    score += scoreByKeywords(text, MOOD_KEYWORDS, 12);
    score += scoreByKeywords(text, MODERATE_DATE_KEYWORDS, 8);
    score += scoreByKeywords(text, GENERAL_OK_KEYWORDS, 4);

    if (type === 'RESTAURANT') {
      score += this.scoreRestaurantByMealTime(text, mealTime);
    }

    if (type === 'CAFE') {
      score += scoreByKeywords(text, CAFE_KEYWORDS, 16);
    }

    if (type === 'ACTIVITY') {
      score += scoreByKeywords(text, ACTIVITY_KEYWORDS, 16);
      score += scoreByKeywords(text, DATE_LIMITED_EVENT_KEYWORDS, 28);
      score += scoreByKeywords(
        matchedQueryText,
        DATE_LIMITED_EVENT_KEYWORDS,
        12,
      );
    }

    score -= scoreByKeywords(text, FRANCHISE_KEYWORDS, 35);
    score -= scoreByKeywords(text, LOW_DATE_FIT_KEYWORDS, 45);
    score -= scoreBranchLikeName(place.name);

    // 역에서 가까울수록 소폭 가산 (최대 +10, 2km에서 0)
    if (place.distanceMeters !== null) {
      score += Math.round(
        10 * (1 - place.distanceMeters / PLACE_DISTANCE_LIMIT_METERS),
      );
    }

    // SNS 인기 신호: 인스타/예약 링크 보유 = MZ픽·핫플 지표
    if (place.instagramLink) score += 15;
    if (place.reservationLink) score += 10;

    // 캐시된 블로그 태그 보너스 (한 번이라도 detail 조회된 장소에 적용)
    if (place.tags?.includes('인스타 감성')) score += 20;
    if (place.tags?.includes('분위기 좋은')) score += 20;
    if (place.tags?.includes('데이트')) score += 15;
    if (place.tags?.includes('화려한')) score += 10;

    // 카테고리 매칭 보너스: 키워드 적중당 +45 (데이트 핵심 신호 수준)
    if (category) {
      score += this.scorePlaceByCategory(place, type, category);
    }

    return score;
  }

  private scorePlaceByCategory(
    place: CandidatePlace,
    type: PlaceType,
    category: string,
  ): number {
    const config = PLACE_CATEGORY_CONFIG[type]?.[category];
    if (!config) return 0;
    const text = normalize(
      `${place.name} ${place.categoryName} ${place.description ?? ''}`,
    );
    return scoreByKeywords(text, config.keywords, 45);
  }

  private scoreRestaurantByMealTime(text: string, mealTime?: MealTime) {
    if (!mealTime) {
      return 0;
    }

    if (mealTime === 'LUNCH') {
      return (
        scoreByKeywords(text, LUNCH_POSITIVE_KEYWORDS, 14) -
        scoreByKeywords(text, LUNCH_NEGATIVE_KEYWORDS, 16)
      );
    }

    return (
      scoreByKeywords(text, DINNER_POSITIVE_KEYWORDS, 14) -
      scoreByKeywords(text, DINNER_NEGATIVE_KEYWORDS, 12)
    );
  }

  scorePlaceByDateContext(
    place: PlaceResponse,
    dateContext: DateRecommendationContext,
  ) {
    const text = normalize(
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
      score += scoreByKeywords(text, INDOOR_COMFORT_KEYWORDS, 18);
      score += place.type === 'CAFE' ? 8 : 0;
      score += place.type === 'ACTIVITY' ? 6 : 0;
      score -= scoreByKeywords(text, WEATHER_SENSITIVE_KEYWORDS, 14);
    }

    if (dateContext.season === 'SPRING' || dateContext.season === 'FALL') {
      score += scoreByKeywords(text, WALKABLE_DATE_KEYWORDS, 14);
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
    const matchedQueryText = normalize(place.matchedQueries?.join(' ') ?? '');
    const hasExactDateInResult = getExactDateKeywords(dateContext).some(
      (keyword) => resultText.includes(normalize(keyword)),
    );
    const hasExactDateInQuery = getExactDateKeywords(dateContext).some(
      (keyword) => matchedQueryText.includes(normalize(keyword)),
    );
    const hasMonthInResult = resultText.includes(
      normalize(`${dateContext.month}월`),
    );
    const resultEventScore = scoreByKeywords(
      resultText,
      DATE_LIMITED_EVENT_KEYWORDS,
      34,
    );
    const queryEventScore = scoreByKeywords(
      matchedQueryText,
      DATE_LIMITED_EVENT_KEYWORDS,
      8,
    );
    const resultPopularScore = scoreByKeywords(
      resultText,
      POPULAR_PLACE_KEYWORDS,
      18,
    );
    const queryPopularScore = scoreByKeywords(
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

  isDateLimitedEventPlace(
    place: PlaceResponse,
    dateContext: DateRecommendationContext,
  ) {
    const resultText = this.getDatePriorityResultText(place);
    const hasEventKeyword = DATE_LIMITED_EVENT_KEYWORDS.some((keyword) =>
      resultText.includes(normalize(keyword)),
    );

    if (!hasEventKeyword) {
      return false;
    }

    const hasExactDate = getExactDateKeywords(dateContext).some((keyword) =>
      resultText.includes(normalize(keyword)),
    );
    const hasMonth = resultText.includes(normalize(`${dateContext.month}월`));
    const hasLimitedSignal = DATE_LIMITED_STRONG_KEYWORDS.some((keyword) =>
      resultText.includes(normalize(keyword)),
    );

    return hasExactDate || hasMonth || hasLimitedSignal;
  }

  isDateEventSearchCandidate(
    place: PlaceResponse,
    dateContext: DateRecommendationContext,
  ) {
    if (this.isDateLimitedEventPlace(place, dateContext)) {
      return true;
    }

    const matchedQueryText = normalize(place.matchedQueries?.join(' ') ?? '');
    const hasSelectedMonth = matchedQueryText.includes(
      normalize(formatKoreanMonthLabel(dateContext)),
    );
    const hasEventKeyword = DATE_LIMITED_EVENT_KEYWORDS.some((keyword) =>
      matchedQueryText.includes(normalize(keyword)),
    );

    return hasSelectedMonth && hasEventKeyword;
  }

  private getDatePriorityResultText(place: PlaceResponse) {
    return normalize(
      `${place.name} ${place.categoryName} ${place.description}`,
    );
  }

  buildDateRecommendationReason(
    place: PlaceResponse,
    stationName: string,
    dateContext: DateRecommendationContext,
  ) {
    const snippet = this.extractReasonSnippet(place);
    if (snippet) return snippet;

    const dateReason = this.getShortDateReason(dateContext);
    const typeReason = this.getShortTypeReason(place.type);
    return `${toSearchStationName(stationName)} 근처에서 ${dateReason} ${typeReason} 좋아요.`;
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
      resultText.includes(normalize(keyword)),
    );
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

  toPlaceCategoryLabel(type: PlaceType) {
    if (type === 'RESTAURANT') {
      return '식당';
    }

    if (type === 'CAFE') {
      return '카페';
    }

    return '놀거리';
  }
}
