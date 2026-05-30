export const PLACE_TYPES = ['RESTAURANT', 'CAFE', 'ACTIVITY'] as const;

export type PlaceType = (typeof PLACE_TYPES)[number];

export interface PlaceResponse {
  kakaoPlaceId?: string | null;
  naverPlaceId?: string | null;
  provider?: 'NAVER' | 'KAKAO';
  type: PlaceType;
  name: string;
  categoryName: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  distanceMeters: number | null;
  phone: string | null;
  externalLink: string;
  recommendationScore?: number;
  matchedQueries?: string[];
}

export const MEAL_TIMES = ['LUNCH', 'DINNER'] as const;
export type MealTime = (typeof MEAL_TIMES)[number];
