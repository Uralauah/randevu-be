import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { SubwayStation } from '../stations/entities';
import { PlaceResponse } from './places.type';
import {
  BRANCH_LIKE_KEYWORDS,
  BROAD_SEARCH_REGION_NAMES,
  EARTH_RADIUS_METERS,
} from './places.constants';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface DateRecommendationContext {
  date: string;
  year: number;
  month: number;
  day: number;
  dayOfWeek: number;
  isWeekend: boolean;
  season: 'SPRING' | 'SUMMER' | 'FALL' | 'WINTER';
}

export function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, '');
}

export function stripHtml(value: string) {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .trim();
}

export function truncateForLog(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function calculateStraightLineDistanceMeters(
  from: Coordinates,
  to: Coordinates,
) {
  const fromLat = toRadians(from.lat);
  const toLat = toRadians(to.lat);
  const deltaLat = toRadians(to.lat - from.lat);
  const deltaLng = toRadians(to.lng - from.lng);

  const halfChordLength =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) ** 2;
  const angularDistance =
    2 * Math.atan2(Math.sqrt(halfChordLength), Math.sqrt(1 - halfChordLength));

  return EARTH_RADIUS_METERS * angularDistance;
}

export function toValidCoordinates(value: {
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

export function getDedupKey(place: PlaceResponse) {
  if (place.naverPlaceId) {
    return `naver:${place.naverPlaceId}`;
  }

  return `${normalize(place.name)}:${normalize(place.address ?? '')}`;
}

export function createPlaceKey(
  provider: 'NAVER' | 'KAKAO',
  externalId: string | null,
  name: string,
  address: string | null,
) {
  if (externalId) {
    return `${provider.toLowerCase()}:${externalId}`;
  }

  const hash = createHash('sha1')
    .update(`${provider}:${normalize(name)}:${normalize(address ?? '')}`)
    .digest('hex')
    .slice(0, 24);

  return `${provider.toLowerCase()}:hash:${hash}`;
}

export function extractNaverPlaceId(link: string) {
  const match = link.match(/\/place\/(\d+)/);

  return match?.[1] ?? null;
}

export function isMapLink(normalizedLink: string) {
  return (
    normalizedLink.includes('map.naver.com') ||
    normalizedLink.includes('m.place.naver.com') ||
    normalizedLink.includes('pcmap.place.naver.com') ||
    normalizedLink.includes('place.map.kakao.com') ||
    /\/place\/\d+/.test(normalizedLink)
  );
}

export function classifyPlaceLink(link: string) {
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

  if (isMapLink(normalizedLink)) {
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

export function scoreByKeywords(
  text: string,
  keywords: string[],
  weight: number,
) {
  let score = 0;

  for (const keyword of keywords) {
    if (text.includes(normalize(keyword))) {
      score += weight;
    }
  }

  return score;
}

export function scoreBranchLikeName(name: string) {
  const normalizedName = normalize(name);
  let penalty = 0;

  for (const keyword of BRANCH_LIKE_KEYWORDS) {
    if (normalizedName.includes(normalize(keyword))) {
      penalty += 8;
    }
  }

  return penalty;
}

export function delay(ms: number) {
  if (process.env.NODE_ENV === 'test') {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 외부 API 호출 폭주(429)를 막기 위해 동시 실행 수를 제한하며 매핑한다.
 * 결과 순서는 입력 순서를 유지한다.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(items[index], index);
      }
    },
  );

  await Promise.all(workers);

  return results;
}

export function toSearchStationAreaName(stationName: string) {
  return stationName.trim().replace(/역$/, '');
}

export function toSearchStationName(stationName: string) {
  return stationName.endsWith('역') ? stationName : `${stationName}역`;
}

export function toSearchRegionName(regionName?: string | null) {
  const normalizedRegionName = regionName?.trim();

  if (!normalizedRegionName) {
    return null;
  }

  if (BROAD_SEARCH_REGION_NAMES.includes(normalizedRegionName)) {
    return null;
  }

  return normalizedRegionName;
}

export function toSearchLocationName(station: SubwayStation) {
  const stationKeyword = toSearchStationAreaName(station.name);
  const regionKeyword = toSearchRegionName(station.region?.name);

  if (!regionKeyword) {
    return toSearchStationName(station.name);
  }

  if (normalize(stationKeyword).startsWith(normalize(regionKeyword))) {
    return stationKeyword;
  }

  return `${regionKeyword} ${stationKeyword}`;
}

export function parseDateRecommendationContext(
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
    season: getSeason(month),
  };
}

export function getSeason(month: number): DateRecommendationContext['season'] {
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

export function formatKoreanDateLabel(dateContext: DateRecommendationContext) {
  return `${dateContext.month}월 ${dateContext.day}일`;
}

export function formatKoreanMonthLabel(dateContext: DateRecommendationContext) {
  return `${dateContext.year}년 ${dateContext.month}월`;
}

export function getExactDateKeywords(dateContext: DateRecommendationContext) {
  return [
    dateContext.date,
    formatKoreanDateLabel(dateContext),
    `${dateContext.month}월${dateContext.day}일`,
  ];
}
