import { Injectable } from '@nestjs/common';
import { PlaceCache } from './entities';
import { NaverBlogItem } from './naver-blog.client';
import { PlaceTagResponse } from './places.type';

@Injectable()
export class PlaceTagService {
  infer(place: PlaceCache, blogItems: NaverBlogItem[]) {
    const scoreMap = new Map<
      string,
      {
        score: number;
        source: 'category' | 'naver_blog';
      }
    >();

    this.addCategoryBasedTags(place, scoreMap);
    this.addBlogBasedTags(blogItems, scoreMap);

    const tagDetails = [...scoreMap.entries()]
      .map(([name, value]) => ({
        name,
        score: value.score,
        source: value.source,
        confidence: this.toTagConfidence(value.score),
      }))
      .filter((tag) => tag.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    return {
      tags: tagDetails
        .filter((tag) => tag.confidence !== 'low')
        .map((tag) => tag.name),
      tagDetails,
      summary: this.buildSummary(place, tagDetails),
    };
  }

  private addCategoryBasedTags(
    place: PlaceCache,
    scoreMap: Map<
      string,
      {
        score: number;
        source: 'category' | 'naver_blog';
      }
    >,
  ) {
    const text = this.normalize(`${place.name} ${place.categoryName ?? ''}`);

    for (const [tagName, keywords] of Object.entries(CATEGORY_TAG_KEYWORDS)) {
      if (keywords.some((keyword) => text.includes(this.normalize(keyword)))) {
        scoreMap.set(tagName, { score: 3, source: 'category' });
      }
    }
  }

  private addBlogBasedTags(
    blogItems: NaverBlogItem[],
    scoreMap: Map<
      string,
      {
        score: number;
        source: 'category' | 'naver_blog';
      }
    >,
  ) {
    const blogText = this.normalize(
      blogItems
        .map((item) => `${this.stripHtml(item.title)} ${this.stripHtml(item.description)}`)
        .join(' '),
    );

    for (const [tagName, keywords] of Object.entries(BLOG_TAG_KEYWORDS)) {
      const score = keywords.reduce(
        (sum, keyword) => sum + this.countKeyword(blogText, keyword),
        0,
      );

      if (score <= 0) {
        continue;
      }

      const existing = scoreMap.get(tagName);

      scoreMap.set(tagName, {
        score: (existing?.score ?? 0) + score,
        source: existing?.source ?? 'naver_blog',
      });
    }
  }

  private buildSummary(place: PlaceCache, tagDetails: PlaceTagResponse[]) {
    const topTags = tagDetails
      .filter((tag) => tag.confidence !== 'low')
      .slice(0, 2)
      .map((tag) => tag.name);

    if (topTags.length > 0) {
      return `${topTags.join(', ')} 분위기로 가볍게 들르기 좋은 곳`;
    }

    if (place.categoryName) {
      return `${place.categoryName.split('>').at(-1)?.trim() ?? place.categoryName} 계열의 장소`;
    }

    return '데이트 코스로 가볍게 확인해볼 만한 장소';
  }

  private countKeyword(text: string, keyword: string) {
    const normalizedKeyword = this.normalize(keyword);

    if (!text || !normalizedKeyword) {
      return 0;
    }

    return text.split(normalizedKeyword).length - 1;
  }

  private toTagConfidence(score: number): 'low' | 'medium' | 'high' {
    if (score >= 6) {
      return 'high';
    }

    if (score >= 3) {
      return 'medium';
    }

    return 'low';
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
}

const CATEGORY_TAG_KEYWORDS: Record<string, string[]> = {
  카페: ['카페', '커피'],
  디저트: ['디저트', '베이커리', '케이크', '제과'],
  브런치: ['브런치'],
  술집: ['술집', '주점', '바', '펍'],
  한식: ['한식'],
  일식: ['일식', '초밥', '스시'],
  양식: ['양식', '파스타', '스테이크', '이탈리안'],
  전시: ['전시', '미술관', '갤러리'],
  공방: ['공방', '체험'],
  소품샵: ['소품', '편집샵'],
};

const BLOG_TAG_KEYWORDS: Record<string, string[]> = {
  카페: ['카페', '커피', '라떼', '아메리카노', '로스터리', '에스프레소'],
  디저트: [
    '디저트',
    '케이크',
    '휘낭시에',
    '스콘',
    '마들렌',
    '쿠키',
    '크로플',
    '소금빵',
    '베이커리',
    '타르트',
    '푸딩',
  ],
  '인스타 감성': [
    '감성',
    '인스타',
    '사진',
    '사진찍기',
    '포토존',
    '예쁜',
    '힙한',
    '채광',
    '인테리어',
  ],
  '분위기 좋은': [
    '분위기',
    '무드',
    '데이트',
    '소개팅',
    '아늑한',
    '분위기좋은',
  ],
  차분한: ['조용한', '차분한', '한적한', '잔잔한', '여유로운', '대화하기좋은'],
  화려한: ['화려한', '핫한', '핫플', '북적', '활기찬'],
  데이트: ['데이트', '소개팅', '커플', '분위기좋은', '예쁜카페'],
  '대화하기 좋은': ['대화하기좋은', '조용한', '차분한', '소개팅', '아늑한'],
  '작업하기 좋은': ['작업하기', '노트북', '콘센트', '공부하기', '혼자오기좋은'],
  맛집: ['맛집', '맛있는', '존맛', '재방문', '추천'],
  아메리카노: ['아메리카노'],
  라떼: ['라떼'],
  케이크: ['케이크'],
  쿠키: ['쿠키'],
  소금빵: ['소금빵'],
};
