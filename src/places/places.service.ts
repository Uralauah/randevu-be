import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubwayStation } from '../stations/entities';
import { NaverLocalClient, NaverLocalItem } from './naver-local.client';
import {
  MEAL_TIMES,
  PLACE_TYPES,
  MealTime,
  PlaceResponse,
  PlaceType,
} from './places.type';

interface CandidatePlace extends PlaceResponse {
  matchedQueries: string[];
}

const RESPONSE_LIMIT_BY_TYPE: Record<PlaceType, number> = {
  RESTAURANT: 10,
  CAFE: 10,
  ACTIVITY: 10,
};

const NAVER_DISPLAY_PER_QUERY = 5;

@Injectable()
export class PlacesService {
  private readonly logger = new Logger(PlacesService.name);

  constructor(
    @InjectRepository(SubwayStation)
    private readonly stationRepository: Repository<SubwayStation>,

    private readonly naverLocalClient: NaverLocalClient,
  ) {}

  async findPlacesByStation(
    stationId: number,
    type: PlaceType,
    mealTime?: MealTime,
  ) {
    this.validatePlaceType(type);
    this.validateMealTime(type, mealTime);

    const station = await this.stationRepository.findOne({
      where: { id: stationId },
    });

    if (!station) {
      throw new NotFoundException('역을 찾을 수 없습니다.');
    }

    const places = await this.searchPlaces(station, type, mealTime);

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

  private async searchPlaces(
    station: SubwayStation,
    type: PlaceType,
    mealTime?: MealTime,
  ): Promise<PlaceResponse[]> {
    const queries = this.buildSearchQueries(station.name, type, mealTime);
    const candidates = await this.fetchNaverCandidates(queries, type);
    const rankedPlaces = this.rankPlaces(candidates, type, mealTime);

    const qualifiedPlaces = rankedPlaces.filter(
      (place) =>
        place.recommendationScore !== undefined &&
        place.recommendationScore > 0,
    );

    const finalPlaces =
      qualifiedPlaces.length >= 5 ? qualifiedPlaces : rankedPlaces;

    return finalPlaces.slice(0, RESPONSE_LIMIT_BY_TYPE[type]);
  }

  private async fetchNaverCandidates(
    queries: string[],
    type: PlaceType,
  ): Promise<CandidatePlace[]> {
    const settledResults = await Promise.allSettled(
      queries.map(async (query) => {
        const items = await this.naverLocalClient.searchLocal({
          query,
          display: NAVER_DISPLAY_PER_QUERY,
          sort: 'comment',
        });

        return { query, items };
      }),
    );

    const rejectedCount = settledResults.filter(
      (result) => result.status === 'rejected',
    ).length;

    if (rejectedCount > 0) {
      this.logger.warn(
        `네이버 장소 검색 일부 실패: type=${type}, failed=${rejectedCount}, total=${queries.length}`,
      );
    }

    const merged = new Map<string, CandidatePlace>();

    for (const result of settledResults) {
      if (result.status !== 'fulfilled') {
        continue;
      }

      const { query, items } = result.value;

      for (const item of items) {
        const place = this.toPlaceResponse(item, type);
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

  private buildSearchQueries(
    stationName: string,
    type: PlaceType,
    mealTime?: MealTime,
  ) {
    const base = this.toSearchStationName(stationName);

    if (type === 'CAFE') {
      return [
        `${base} 감성카페`,
        `${base} 분위기 좋은 카페`,
        `${base} 디저트 카페`,
        `${base} 카페 추천`,
        `${base} 데이트 카페`,
      ];
    }

    if (type === 'ACTIVITY') {
      return [
        `${base} 데이트 코스`,
        `${base} 놀거리`,
        `${base} 전시`,
        `${base} 소품샵`,
        `${base} 공방`,
      ];
    }

    if (mealTime === 'LUNCH') {
      return [
        `${base} 데이트 점심 맛집`,
        `${base} 점심 맛집`,
        `${base} 브런치`,
        `${base} 파스타`,
        `${base} 분위기 좋은 점심 맛집`,
      ];
    }

    if (mealTime === 'DINNER') {
      return [
        `${base} 데이트 저녁 맛집`,
        `${base} 분위기 좋은 저녁 맛집`,
        `${base} 저녁 맛집`,
        `${base} 와인바`,
        `${base} 이자카야`,
      ];
    }

    return [
      `${base} 데이트 맛집`,
      `${base} 분위기 좋은 맛집`,
      `${base} 맛집 추천`,
      `${base} 핫플`,
      `${base} 가볼만한 곳`,
    ];
  }

  private toSearchStationName(stationName: string) {
    return stationName.endsWith('역') ? stationName : `${stationName}역`;
  }

  private toPlaceResponse(
    item: NaverLocalItem,
    type: PlaceType,
  ): PlaceResponse {
    const name = this.stripHtml(item.title);

    return {
      kakaoPlaceId: null,
      naverPlaceId: this.extractNaverPlaceId(item.link),
      provider: 'NAVER',
      type,
      name,
      categoryName: item.category || '',
      address: item.roadAddress || item.address || null,
      lat: null,
      lng: null,
      distanceMeters: null,
      phone: item.telephone || null,
      externalLink: item.link,
      matchedQueries: [],
    };
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

        return b.matchedQueries.length - a.matchedQueries.length;
      });
  }

  private scorePlace(
    place: CandidatePlace,
    type: PlaceType,
    mealTime?: MealTime,
  ) {
    const text = this.normalize(
      `${place.name} ${place.categoryName} ${place.address ?? ''}`,
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
    }

    score -= this.scoreByKeywords(text, FRANCHISE_KEYWORDS, 35);
    score -= this.scoreByKeywords(text, LOW_DATE_FIT_KEYWORDS, 45);
    score -= this.scoreBranchLikeName(place.name);

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
    const normalizedName = this.normalize(place.name);
    const normalizedAddress = this.normalize(place.address ?? '');

    return `${normalizedName}:${normalizedAddress}`;
  }

  private extractNaverPlaceId(link: string) {
    const match = link.match(/\/place\/(\d+)/);

    return match?.[1] ?? null;
  }

  private stripHtml(value: string) {
    return value
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .trim();
  }

  private normalize(value: string) {
    return value.toLowerCase().replace(/\s+/g, '');
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
