import { Repository } from 'typeorm';
import { User } from '../auth/entities';
import { SubwayStation } from '../stations/entities';
import { DateCoursesService } from './date-courses.service';
import { DateCourse, DateCourseItem, DateCourseParticipant } from './entities';

describe('DateCoursesService', () => {
  let service: DateCoursesService;

  beforeEach(() => {
    service = new DateCoursesService(
      mockRepository<DateCourse>(),
      mockRepository<DateCourseItem>(),
      mockRepository<DateCourseParticipant>(),
      mockRepository<User>(),
      mockRepository<SubwayStation>(),
    );
  });

  describe('toCourseResponse', () => {
    it('adds walking segments between consecutive course items', () => {
      const response = callToCourseResponse(service, {
        items: [
          createCourseItem({
            id: 'second',
            itemOrder: 2,
            name: '카페',
            lat: 37.001,
            lng: 127,
          }),
          createCourseItem({
            id: 'first',
            itemOrder: 1,
            name: '식당',
            lat: 37,
            lng: 127,
          }),
        ],
      });

      expect(response.walkingSegments).toEqual([
        {
          fromItemId: 'first',
          fromItemOrder: 1,
          fromItemName: '식당',
          toItemId: 'second',
          toItemOrder: 2,
          toItemName: '카페',
          distanceMeters: 139,
          estimatedWalkingMinutes: 2,
          calculationMethod: 'COORDINATE_ESTIMATE',
        },
      ]);
    });

    it('returns null distance for segments without coordinates', () => {
      const response = callToCourseResponse(service, {
        items: [
          createCourseItem({
            id: 'first',
            itemOrder: 1,
            name: '식당',
            lat: null,
            lng: null,
          }),
          createCourseItem({
            id: 'second',
            itemOrder: 2,
            name: '카페',
            lat: 37.001,
            lng: 127,
          }),
        ],
      });

      expect(response.walkingSegments[0]).toMatchObject({
        distanceMeters: null,
        estimatedWalkingMinutes: null,
        calculationMethod: 'UNAVAILABLE',
      });
    });
  });

  describe('previewWalkingSegments', () => {
    it('calculates walking segments without saving a course', () => {
      expect(
        service.previewWalkingSegments({
          items: [
            {
              itemId: 'second',
              itemOrder: 2,
              name: '카페',
              lat: 37.001,
              lng: 127,
            },
            {
              itemId: 'first',
              itemOrder: 1,
              name: '식당',
              lat: 37,
              lng: 127,
            },
          ],
        }),
      ).toEqual({
        walkingSegments: [
          {
            fromItemId: 'first',
            fromItemOrder: 1,
            fromItemName: '식당',
            toItemId: 'second',
            toItemOrder: 2,
            toItemName: '카페',
            distanceMeters: 139,
            estimatedWalkingMinutes: 2,
            calculationMethod: 'COORDINATE_ESTIMATE',
          },
        ],
      });
    });
  });
});

function callToCourseResponse(
  service: DateCoursesService,
  course: Partial<DateCourse>,
) {
  return (
    service as unknown as {
      toCourseResponse(course: DateCourse): {
        walkingSegments: Array<{
          distanceMeters: number | null;
          estimatedWalkingMinutes: number | null;
          calculationMethod: string;
        }>;
      };
    }
  ).toCourseResponse({
    id: 'course-id',
    ownerUserId: 'user-id',
    date: '2026-06-04',
    title: '데이트 코스',
    memo: null,
    inviteToken: null,
    inviteExpiresAt: null,
    station: null,
    participants: [],
    createdAt: new Date('2026-06-04T00:00:00.000Z'),
    updatedAt: new Date('2026-06-04T00:00:00.000Z'),
    ...course,
  } as DateCourse);
}

function createCourseItem(params: {
  id: string;
  itemOrder: number;
  name: string;
  lat: number | null;
  lng: number | null;
}) {
  return {
    id: params.id,
    itemType: 'CUSTOM',
    itemOrder: params.itemOrder,
    placeKey: null,
    name: params.name,
    categoryName: null,
    address: null,
    lat: params.lat,
    lng: params.lng,
    externalLink: null,
    mapLink: null,
    instagramLink: null,
    reservationLink: null,
    memo: null,
  } as DateCourseItem;
}

function mockRepository<T extends object>() {
  return {} as Repository<T>;
}
