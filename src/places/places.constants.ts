import { PlaceType } from './places.type';

export const RESPONSE_LIMIT_BY_TYPE: Record<PlaceType, number> = {
  RESTAURANT: 40,
  CAFE: 40,
  ACTIVITY: 40,
};

export const NAVER_DISPLAY_PER_QUERY = 5;
export const PLACE_SEARCH_DISPLAY = 5;
/** 키워드 직접 검색 시: 더 많이 가져와서 거리 기준으로 추린다 */
export const KEYWORD_SEARCH_DISPLAY = 20;
/** 키워드 검색 결과의 역 기준 최대 거리 (주변 추천 2km보다 여유 있게) */
export const KEYWORD_SEARCH_DISTANCE_LIMIT_METERS = 5_000;
export const NAVER_BLOG_DISPLAY_PER_QUERY = 5;
export const PLACE_DISTANCE_LIMIT_METERS = 2_000;
export const EARTH_RADIUS_METERS = 6_371_000;
export const NAVER_QUERY_CONCURRENCY = 4;
export const PLACE_LIST_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
export const RECOMMENDATION_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const BLOG_QUERY_CONCURRENCY = 4;
export const BLOG_EVENT_NAME_LIMIT = 4;
export const DATE_RECOMMENDATION_TYPE_ORDER: PlaceType[] = [
  'ACTIVITY',
  'CAFE',
  'RESTAURANT',
];

/** 카카오 로컬 카테고리 그룹 코드 (타입별 보강 검색용) */
export const KAKAO_CATEGORY_CODES_BY_TYPE: Record<PlaceType, string[]> = {
  RESTAURANT: ['FD6'], // 음식점
  CAFE: ['CE7'], // 카페
  ACTIVITY: ['CT1', 'AT4'], // 문화시설, 관광명소
};

export const KAKAO_SEARCH_SIZE = 15;

export const INTENT_KEYWORDS = [
  '데이트',
  '핫플',
  '분위기',
  '감성',
  '추천',
  '가볼만한',
  '맛집',
  '인스타',
  'sns',
  '힙한',
  '요즘',
];

export const DATE_LIMITED_EVENT_KEYWORDS = [
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

export const DATE_LIMITED_STRONG_KEYWORDS = [
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

export const DATE_EVENT_NAME_STOPWORDS = [
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

export const POPULAR_PLACE_KEYWORDS = [
  '인기',
  '핫플',
  '요즘',
  '신상',
  '추천',
  '웨이팅',
  '예약',
  '인스타',
  'sns',
];

export const ACTIVITY_EXCLUDED_CATEGORY_KEYWORDS = [
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

export const BROAD_SEARCH_REGION_NAMES = ['수도권', '전국', '전체'];

export const STRONG_DATE_KEYWORDS = [
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

export const MOOD_KEYWORDS = [
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
  '힙한',
  '인스타',
];

export const MODERATE_DATE_KEYWORDS = [
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

export const GENERAL_OK_KEYWORDS = [
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

export const CAFE_KEYWORDS = [
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

export const ACTIVITY_KEYWORDS = [
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

export const INDOOR_COMFORT_KEYWORDS = [
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

export const WEATHER_SENSITIVE_KEYWORDS = [
  '공원',
  '산책',
  '테라스',
  '루프탑',
  '야외',
];

export const WALKABLE_DATE_KEYWORDS = [
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

export const LUNCH_POSITIVE_KEYWORDS = [
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

export const LUNCH_NEGATIVE_KEYWORDS = [
  '술집',
  '호프',
  '요리주점',
  '이자카야',
  '바',
  '펍',
  '칵테일',
  '라운지',
];

export const DINNER_POSITIVE_KEYWORDS = [
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

export const DINNER_NEGATIVE_KEYWORDS = [
  '분식',
  '백반',
  '국수',
  '김밥',
  '도시락',
];

export const FRANCHISE_KEYWORDS = [
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

export const LOW_DATE_FIT_KEYWORDS = [
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

export const BRANCH_LIKE_KEYWORDS = [
  '지점',
  '역점',
  '센터점',
  '몰점',
  '백화점',
  '마트점',
  '터미널점',
  '플라자점',
];

// ── 카테고리별 검색 쿼리 & 키워드 ───────────────────────────────────────────────

export interface PlaceCategoryConfig {
  queries: string[];
  keywords: string[];
}

const RESTAURANT_CATEGORY_CONFIG: Record<string, PlaceCategoryConfig> = {
  한식: {
    queries: [
      '한식 맛집',
      '국밥',
      '갈비 맛집',
      '삼겹살 맛집',
      '한정식',
      '백반 맛집',
    ],
    keywords: [
      '한식',
      '국밥',
      '갈비',
      '삼겹살',
      '불고기',
      '된장',
      '한정식',
      '백반',
      '비빔밥',
      '김치찌개',
      '순두부',
    ],
  },
  일식: {
    queries: [
      '라멘 맛집',
      '초밥 맛집',
      '이자카야 추천',
      '돈카츠',
      '오마카세',
      '사시미',
    ],
    keywords: [
      '일식',
      '라멘',
      '초밥',
      '스시',
      '이자카야',
      '돈카츠',
      '돈가스',
      '사시미',
      '오마카세',
      '롤',
      '우동',
      '소바',
    ],
  },
  양식: {
    queries: [
      '파스타 맛집',
      '스테이크 맛집',
      '브런치 레스토랑',
      '피자 맛집',
      '다이닝',
    ],
    keywords: [
      '양식',
      '파스타',
      '스테이크',
      '피자',
      '브런치',
      '샐러드',
      '이탈리안',
      '프렌치',
      '다이닝',
      '비스트로',
    ],
  },
  중식: {
    queries: ['마라탕 맛집', '딤섬 맛집', '중식 맛집', '탕수육', '마라샹궈'],
    keywords: [
      '중식',
      '마라',
      '딤섬',
      '짜장',
      '짬뽕',
      '탕수육',
      '중화요리',
      '마라탕',
      '마라샹궈',
    ],
  },
  아시안: {
    queries: ['태국음식 맛집', '베트남 맛집', '쌀국수', '팟타이', '멕시칸'],
    keywords: [
      '태국',
      '베트남',
      '쌀국수',
      '팟타이',
      '아시안',
      '멕시칸',
      '타코',
      '부리또',
    ],
  },
  '술집·바': {
    queries: ['와인바 추천', '칵테일바', '이자카야 데이트', '루프탑 바'],
    keywords: [
      '와인',
      '와인바',
      '칵테일',
      '이자카야',
      '바',
      '펍',
      '요리주점',
      '루프탑바',
    ],
  },
  '면·덮밥': {
    queries: ['라멘 맛집', '우동 맛집', '덮밥 맛집', '국수 맛집', '돈부리'],
    keywords: [
      '라멘',
      '우동',
      '소바',
      '국수',
      '덮밥',
      '돈부리',
      '오야코동',
      '규동',
      '면',
      '칼국수',
      '냉면',
    ],
  },
};

const CAFE_CATEGORY_CONFIG: Record<string, PlaceCategoryConfig> = {
  감성카페: {
    queries: ['감성카페', '힙한 카페', '인스타 카페', 'SNS 핫플 카페'],
    keywords: [
      '감성',
      '힙한',
      '인스타',
      '포토존',
      '인테리어',
      '분위기좋은카페',
      '힙카페',
    ],
  },
  디저트: {
    queries: ['디저트 카페', '케이크 카페', '타르트 카페', '마카롱 카페'],
    keywords: [
      '디저트',
      '케이크',
      '타르트',
      '마카롱',
      '에클레어',
      '푸딩',
      '크림',
    ],
  },
  베이커리: {
    queries: ['베이커리 카페', '소금빵 카페', '크로와상 카페'],
    keywords: [
      '베이커리',
      '빵',
      '소금빵',
      '크로와상',
      '스콘',
      '식빵',
      '크루아상',
    ],
  },
  브런치: {
    queries: ['브런치 카페', '에그베네딕트', '팬케이크 카페'],
    keywords: [
      '브런치',
      '에그베네딕트',
      '팬케이크',
      '와플',
      '에그',
      '브런치카페',
    ],
  },
  뷰카페: {
    queries: ['루프탑 카페', '뷰 좋은 카페', '리버뷰 카페', '한강뷰 카페'],
    keywords: ['루프탑', '뷰', '리버뷰', '한강', '테라스', '야외', '전망'],
  },
  한옥카페: {
    queries: ['한옥 카페', '전통 카페', '고즈넉한 카페'],
    keywords: ['한옥', '전통', '고즈넉', '기와', '한옥카페'],
  },
};

const ACTIVITY_CATEGORY_CONFIG: Record<string, PlaceCategoryConfig> = {
  '팝업·전시': {
    queries: ['팝업스토어', '전시 데이트', '갤러리', '미술관 데이트'],
    keywords: ['팝업', '전시', '갤러리', '미술관', '기간한정', '팝업스토어'],
  },
  '공방·체험': {
    queries: ['공방 데이트', '도예 체험', '캔들 공방', '향수 만들기', '플라워'],
    keywords: [
      '공방',
      '도예',
      '캔들',
      '향수',
      '체험',
      '클래스',
      '플라워',
      '원데이',
    ],
  },
  편집샵: {
    queries: ['편집샵', '소품샵', '빈티지샵', '인테리어샵'],
    keywords: ['편집샵', '소품', '빈티지', '인테리어', '셀렉', '편집'],
  },
  독립서점: {
    queries: ['독립서점', '동네서점', '북카페'],
    keywords: ['서점', '독립서점', '책방', '북카페', '책'],
  },
  '공원·산책': {
    queries: ['공원 데이트', '산책로', '한강공원', '나들이'],
    keywords: ['공원', '산책', '한강', '숲길', '피크닉', '나들이'],
  },
};

export const PLACE_CATEGORY_CONFIG: Partial<
  Record<PlaceType, Record<string, PlaceCategoryConfig>>
> = {
  RESTAURANT: RESTAURANT_CATEGORY_CONFIG,
  CAFE: CAFE_CATEGORY_CONFIG,
  ACTIVITY: ACTIVITY_CATEGORY_CONFIG,
};
