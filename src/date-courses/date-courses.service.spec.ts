import { Repository } from 'typeorm';
import { SocialAccount, User } from '../auth/entities';
import { SubwayStation } from '../stations/entities';
import { DateCoursesGateway } from './date-courses.gateway';
import { DateCoursesService } from './date-courses.service';
import { DateCourse, DateCourseItem, DateCourseParticipant } from './entities';

describe('DateCoursesService', () => {
  let service: DateCoursesService;
  let courseRepository: MockRepository<DateCourse>;
  let participantRepository: MockRepository<DateCourseParticipant>;
  let userRepository: MockRepository<User>;
  let dateCoursesGateway: Pick<DateCoursesGateway, 'emitParticipantJoined'>;

  beforeEach(() => {
    courseRepository = mockRepository<DateCourse>();
    participantRepository = mockRepository<DateCourseParticipant>();
    userRepository = mockRepository<User>();
    dateCoursesGateway = {
      emitParticipantJoined: jest.fn(),
    };

    service = new DateCoursesService(
      courseRepository,
      mockRepository<DateCourseItem>(),
      participantRepository,
      userRepository,
      mockRepository<SubwayStation>(),
      dateCoursesGateway as DateCoursesGateway,
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

    it('adds participant nickname and platform', () => {
      const response = callToCourseResponse(service, {
        participants: [
          createCourseParticipant({
            userId: 'partner-id',
            nickname: '민지',
            platform: 'KAKAO',
            role: 'PARTNER',
          }),
        ],
      });

      expect(response.participants).toEqual([
        {
          userId: 'partner-id',
          nickname: '민지',
          platform: 'KAKAO',
          role: 'PARTNER',
          joinedAt: new Date('2026-06-04T00:00:00.000Z'),
        },
      ]);
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

  describe('acceptInvite', () => {
    it('emits a socket event when a new participant joins', async () => {
      const course = {
        id: 'course-id',
        ownerUserId: 'owner-id',
        inviteToken: 'invite-token',
        inviteExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
      } as DateCourse;
      const participant = {
        courseId: course.id,
        userId: 'partner-id',
        role: 'PARTNER',
        createdAt: new Date('2026-06-04T00:00:00.000Z'),
      } as DateCourseParticipant;
      const joiningUser = createUser({
        id: 'partner-id',
        nickname: '민지',
        platform: 'KAKAO',
      });

      userRepository.findOne.mockResolvedValueOnce(joiningUser);
      courseRepository.findOne
        .mockResolvedValueOnce(course)
        .mockResolvedValueOnce({
          ...course,
          station: null,
          items: [],
          participants: [participant],
          createdAt: new Date('2026-06-04T00:00:00.000Z'),
          updatedAt: new Date('2026-06-04T00:00:00.000Z'),
        } as DateCourse);
      participantRepository.findOne.mockResolvedValueOnce(null);
      participantRepository.save.mockResolvedValueOnce(participant);
      participantRepository.findOne.mockResolvedValueOnce(participant);

      await service.acceptInvite('invite-token', 'partner-id');

      expect(dateCoursesGateway.emitParticipantJoined).toHaveBeenCalledWith({
        courseId: course.id,
        participant: {
          userId: 'partner-id',
          nickname: '민지',
          platform: 'KAKAO',
          role: 'PARTNER',
          joinedAt: participant.createdAt,
        },
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
        participants: Array<{
          userId: string;
          nickname: string | null;
          platform: string | null;
          role: 'OWNER' | 'PARTNER';
          joinedAt: Date;
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

function createCourseParticipant(params: {
  userId: string;
  nickname: string;
  platform: string;
  role: 'OWNER' | 'PARTNER';
}) {
  return {
    courseId: 'course-id',
    userId: params.userId,
    role: params.role,
    createdAt: new Date('2026-06-04T00:00:00.000Z'),
    user: createUser({
      id: params.userId,
      nickname: params.nickname,
      platform: params.platform,
    }),
  } as DateCourseParticipant;
}

function createUser(params: {
  id: string;
  nickname: string;
  platform: string;
}) {
  return {
    id: params.id,
    nickname: params.nickname,
    socialAccounts: [
      {
        provider: params.platform,
        createdAt: new Date('2026-06-04T00:00:00.000Z'),
      } as SocialAccount,
    ],
  } as User;
}

type MockRepository<T extends object> = {
  [K in keyof Repository<T>]: Repository<T>[K] extends (
    ...args: infer A
  ) => infer R
    ? jest.Mock<R, A>
    : Repository<T>[K];
};

function mockRepository<T extends object>() {
  return {
    count: jest.fn(),
    create: jest.fn((entity: T) => entity),
    delete: jest.fn(),
    exists: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn((entity: T) => entity),
    update: jest.fn(),
  } as unknown as MockRepository<T>;
}
