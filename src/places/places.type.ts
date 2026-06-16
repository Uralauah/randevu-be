export const PLACE_TYPES = ['RESTAURANT', 'CAFE', 'ACTIVITY'] as const;

export type PlaceType = (typeof PLACE_TYPES)[number];

export interface PlaceResponse {
  placeKey: string;
  kakaoPlaceId?: string | null;
  naverPlaceId?: string | null;
  provider?: 'NAVER' | 'KAKAO';
  type: PlaceType;
  name: string;
  description: string;
  categoryName: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  distanceMeters: number | null;
  phone: string | null;
  mapLink?: string | null;
  externalLink: string | null;
  instagramLink?: string | null;
  reservationLink?: string | null;
  recommendationScore?: number;
  matchedQueries?: string[];
  tags?: string[];
  tagDetails?: PlaceTagResponse[];
}

export interface CandidatePlace extends PlaceResponse {
  matchedQueries: string[];
}

export interface PlaceDateRecommendationResponse {
  station: {
    id: number;
    name: string;
    lat: number | null;
    lng: number | null;
  };
  source: 'NAVER';
  date: string;
  recommendation: PlaceDateRecommendation;
}

export interface PlaceDateRecommendation extends PlaceResponse {
  category: '식당' | '카페' | '놀거리';
  reason: string;
}

export interface PlaceDetailResponse {
  placeKey: string;
  provider: 'NAVER' | 'KAKAO';
  externalId: string | null;
  type: PlaceType;
  name: string;
  summary: string | null;
  description: string | null;
  categoryName: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  openingHours: string;
  mapLink: string | null;
  externalLink: string | null;
  instagramLink: string | null;
  reservationLink: string | null;
  tags: string[];
  tagDetails: PlaceTagResponse[];
}

export interface PlaceTagResponse {
  name: string;
  score: number;
  source: 'category' | 'naver_blog';
  confidence: 'low' | 'medium' | 'high';
}

export const MEAL_TIMES = ['LUNCH', 'DINNER'] as const;
export type MealTime = (typeof MEAL_TIMES)[number];
