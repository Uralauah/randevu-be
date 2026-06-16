import { Injectable, Logger } from '@nestjs/common';
import { SubwayStation } from '../stations/entities';
import { NaverBlogClient, NaverBlogItem } from './naver-blog.client';
import { CandidatePlace } from './places.type';
import { PlaceSearchService } from './place-search.service';
import {
  BLOG_EVENT_NAME_LIMIT,
  BLOG_QUERY_CONCURRENCY,
  DATE_EVENT_NAME_STOPWORDS,
  DATE_LIMITED_EVENT_KEYWORDS,
  NAVER_BLOG_DISPLAY_PER_QUERY,
  NAVER_LOCAL_QUERY_DELAY_MS,
  NAVER_QUERY_CONCURRENCY,
} from './places.constants';
import {
  createPlaceKey,
  DateRecommendationContext,
  delay,
  escapeRegExp,
  formatKoreanMonthLabel,
  getDedupKey,
  mapWithConcurrency,
  normalize,
  stripHtml,
  toSearchStationAreaName,
  toSearchStationName,
  truncateForLog,
} from './places.util';

interface BlogDateEvent {
  name: string;
  blogQuery: string;
  evidenceText: string;
  link: string | null;
}

@Injectable()
export class BlogDateEventService {
  private readonly logger = new Logger(BlogDateEventService.name);

  constructor(
    private readonly naverBlogClient: NaverBlogClient,

    private readonly placeSearchService: PlaceSearchService,
  ) {}

  async fetchDateEventCandidatesFromBlogs(
    station: SubwayStation,
    base: string,
    dateContext: DateRecommendationContext,
  ): Promise<CandidatePlace[]> {
    const blogQueries = this.placeSearchService.buildDatePrioritySearchQueries(
      base,
      'ACTIVITY',
      dateContext,
    );
    const eventNames = new Map<string, BlogDateEvent>();

    // 블로그 쿼리 병렬 배치 실행
    for (let i = 0; i < blogQueries.length; i += BLOG_QUERY_CONCURRENCY) {
      const batch = blogQueries.slice(i, i + BLOG_QUERY_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((query) =>
          this.safeSearchBlogsForDateEvent(query).then((items) => ({
            query,
            items,
          })),
        ),
      );

      for (const { query, items } of batchResults) {
        for (const item of items) {
          const evidenceText = this.toBlogEvidenceText(item);

          if (!this.hasDateEventEvidence(evidenceText, dateContext)) {
            continue;
          }

          for (const name of this.extractDateEventNameCandidates(
            item,
            station,
            dateContext,
          )) {
            const key = normalize(name);

            if (!key || eventNames.has(key)) {
              continue;
            }

            eventNames.set(key, {
              name,
              blogQuery: query,
              evidenceText,
              link: item.link || null,
            });

            if (eventNames.size >= BLOG_EVENT_NAME_LIMIT) break;
          }

          if (eventNames.size >= BLOG_EVENT_NAME_LIMIT) break;
        }

        if (eventNames.size >= BLOG_EVENT_NAME_LIMIT) break;
      }

      if (eventNames.size >= BLOG_EVENT_NAME_LIMIT) break;

      if (i + BLOG_QUERY_CONCURRENCY < blogQueries.length) {
        await delay(NAVER_LOCAL_QUERY_DELAY_MS);
      }
    }

    this.logDateEventExtractedNames([...eventNames.values()]);

    // 이벤트명 로컬 검색을 동시성 제한하에 실행 (429 burst 방지)
    const localSearchResults = await mapWithConcurrency(
      [...eventNames.values()],
      NAVER_QUERY_CONCURRENCY,
      async (event) => {
        const localQueries = this.buildDateEventLocalMatchQueries(
          event.name,
          station,
        );
        const localCandidates =
          await this.placeSearchService.fetchNaverCandidates(
            localQueries,
            'ACTIVITY',
            { skipTypeCompatibility: true },
          );
        const nearbyCandidates =
          this.placeSearchService.filterPlacesWithinStationDistance(
            localCandidates,
            station,
          );
        this.logDateEventLocalMatchResults(
          event.name,
          localQueries,
          nearbyCandidates,
        );
        return { event, nearbyCandidates };
      },
    );

    const merged = new Map<string, CandidatePlace>();

    for (const { event, nearbyCandidates } of localSearchResults) {
      if (
        nearbyCandidates.length === 0 &&
        this.hasStationLocationEvidence(event.evidenceText, station)
      ) {
        const blogOnlyCandidate = this.toBlogDateEventCandidate(event);
        merged.set(getDedupKey(blogOnlyCandidate), blogOnlyCandidate);
        continue;
      }

      for (const candidate of nearbyCandidates) {
        const key = getDedupKey(candidate);
        const existing = merged.get(key);
        const enrichedCandidate = {
          ...candidate,
          description: this.mergeDescriptionWithBlogEvidence(
            candidate.description,
            event.evidenceText,
          ),
          matchedQueries: [
            event.blogQuery,
            ...candidate.matchedQueries,
            event.name,
          ],
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
      placeKey: createPlaceKey('NAVER', null, name, event.link),
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
          제목: stripHtml(item.title),
          설명: truncateForLog(stripHtml(item.description), 120),
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
    const stationAreaName = toSearchStationAreaName(station.name);

    return [`${eventName} ${stationAreaName}`, eventName];
  }

  private extractDateEventNameCandidates(
    item: NaverBlogItem,
    station: SubwayStation,
    dateContext: DateRecommendationContext,
  ) {
    const title = stripHtml(item.title);
    const description = stripHtml(item.description ?? '');
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
        const key = normalize(value);

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
    const normalizedTitle = stripHtml(title)
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
    let result = stripHtml(value)
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
        new RegExp(escapeRegExp(toSearchStationName(station.name)), 'g'),
        ' ',
      )
      .replace(
        new RegExp(escapeRegExp(toSearchStationAreaName(station.name)), 'g'),
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
    const normalizedValue = normalize(value);

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
    if (
      /^\d{1,2}월\s*(팝업스토어|팝업|전시회|전시|기획전|페스티벌|축제|이벤트|플리마켓|한정)$/.test(
        value.trim(),
      )
    ) {
      return false;
    }

    return !DATE_EVENT_NAME_STOPWORDS.some(
      (stopword) => normalizedValue === normalize(stopword),
    );
  }

  private hasDateEventEvidence(
    evidenceText: string,
    dateContext: DateRecommendationContext,
  ) {
    const normalizedText = normalize(evidenceText);
    const hasSelectedMonth = normalizedText.includes(
      normalize(formatKoreanMonthLabel(dateContext)),
    );
    const hasShortMonth = normalizedText.includes(
      normalize(`${dateContext.month}월`),
    );
    const hasEventKeyword = DATE_LIMITED_EVENT_KEYWORDS.some((keyword) =>
      normalizedText.includes(normalize(keyword)),
    );

    return (hasSelectedMonth || hasShortMonth) && hasEventKeyword;
  }

  private hasStationLocationEvidence(
    evidenceText: string,
    station: SubwayStation,
  ) {
    const normalizedText = normalize(evidenceText);

    return [
      toSearchStationName(station.name),
      toSearchStationAreaName(station.name),
    ].some((keyword) => normalizedText.includes(normalize(keyword)));
  }

  private toBlogEvidenceText(item: NaverBlogItem) {
    return stripHtml(`${item.title} ${item.description}`);
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
}
