import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { SocialAccount } from '../auth/entities';
import { User } from '../users/entities';
import { UsersService } from '../users/users.service';
import { StationsService } from '../stations/stations.service';
import { DateCoursesGateway } from './date-courses.gateway';
import { DateCoursesService } from './date-courses.service';
import { DateCourse, DateCourseItem, DateCourseParticipant } from './entities';

describe('DateCoursesService', () => {
  let service: DateCoursesService;
  let courseRepository: MockRepository<DateCourse>;
  let itemRepository: MockRepository<DateCourseItem>;
  let participantRepository: MockRepository<DateCourseParticipant>;
  let usersService: jest.Mocked<
    Pick<UsersService, 'userExists' | 'findUserWithProfile'>
  >;
  let stationsService: jest.Mocked<Pick<StationsService, 'stationExists'>>;
  let dateCoursesGateway: Pick<
    DateCoursesGateway,
    'emitParticipantJoined' | 'emitCourseUpdated'
  >;
  let manager: MockEntityManager;
  let dataSource: { transaction: jest.Mock };

  beforeEach(() => {
    courseRepository = mockRepository<DateCourse>();
    itemRepository = mockRepository<DateCourseItem>();
    participantRepository = mockRepository<DateCourseParticipant>();
    usersService = {
      userExists: jest.fn().mockResolvedValue(true),
      findUserWithProfile: jest.fn(),
    };
    stationsService = {
      stationExists: jest.fn().mockResolvedValue(true),
    };
    dateCoursesGateway = {
      emitParticipantJoined: jest.fn(),
      emitCourseUpdated: jest.fn(),
    };

    manager = mockEntityManager();
    dataSource = {
      transaction: jest.fn((work: (m: MockEntityManager) => Promise<unknown>) =>
        work(manager),
      ),
    };

    service = new DateCoursesService(
      courseRepository as unknown as Repository<DateCourse>,
      itemRepository as unknown as Repository<DateCourseItem>,
      participantRepository as unknown as Repository<DateCourseParticipant>,
      usersService as unknown as UsersService,
      stationsService as unknown as StationsService,
      dateCoursesGateway as DateCoursesGateway,
      dataSource as unknown as DataSource,
    );
  });

  describe('create', () => {
    it('rejects duplicate places in a course', async () => {
      usersService.userExists.mockResolvedValue(true);
      stationsService.stationExists.mockResolvedValue(true);

      await expect(
        service.create('user-id', {
          date: '2026-06-05',
          stationId: 32,
          title: '데이트 코스',
          items: [
            {
              itemType: 'ACTIVITY',
              itemOrder: 1,
              placeKey: 'naver:100',
              name: '성수 팝업',
              address: '서울 성동구 테스트로 100',
            },
            {
              itemType: 'ACTIVITY',
              itemOrder: 2,
              placeKey: 'naver:100',
              name: '성수 팝업',
              address: '서울 성동구 테스트로 100',
            },
          ],
        }),
      ).rejects.toThrow('이미 코스에 포함된 장소입니다.');

      expect(courseRepository.save).not.toHaveBeenCalled();
    });
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

  describe('update', () => {
    beforeEach(() => {
      participantRepository.findOne.mockResolvedValue(
        {} as DateCourseParticipant,
      );
      courseRepository.findOne.mockResolvedValue(createCourse({ items: [] }));
    });

    it('updates date and emits a course updated socket event', async () => {
      await service.update('course-id', 'partner-id', {
        date: '2026-06-05',
      });

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.update).toHaveBeenCalledWith(
        DateCourse,
        { id: 'course-id' },
        { date: '2026-06-05', version: expect.any(Function) },
      );
      expect(dateCoursesGateway.emitCourseUpdated).toHaveBeenCalledWith({
        courseId: 'course-id',
        updatedByUserId: 'partner-id',
        changed: {
          date: true,
          items: false,
        },
      });
    });

    it('adds, deletes, and reorders items without editing existing item details', async () => {
      const firstItem = createCourseItem({
        id: 'first',
        itemOrder: 1,
        name: '기존 식당',
        lat: 37,
        lng: 127,
      });
      const deletedItem = createCourseItem({
        id: 'deleted',
        itemOrder: 2,
        name: '삭제될 카페',
        lat: 37.001,
        lng: 127,
      });

      manager.find.mockResolvedValue([firstItem, deletedItem]);

      await service.update('course-id', 'partner-id', {
        items: [
          {
            id: 'first',
            itemOrder: 2,
            name: '수정 시도',
          },
          {
            itemOrder: 1,
            itemType: 'CAFE',
            name: '새 카페',
            lat: 37.002,
            lng: 127,
          },
        ],
      });

      expect(firstItem).toMatchObject({
        id: 'first',
        itemOrder: 2,
        name: '기존 식당',
      });
      expect(manager.delete).toHaveBeenCalledWith(DateCourseItem, {
        courseId: 'course-id',
        id: expect.anything(),
      });
      expect(manager.save).toHaveBeenCalledWith(
        DateCourseItem,
        expect.arrayContaining([
          firstItem,
          expect.objectContaining({
            courseId: 'course-id',
            itemOrder: 1,
            itemType: 'CAFE',
            name: '새 카페',
          }),
        ]),
      );
      expect(dateCoursesGateway.emitCourseUpdated).toHaveBeenCalledWith({
        courseId: 'course-id',
        updatedByUserId: 'partner-id',
        changed: {
          date: false,
          items: true,
        },
      });
    });

    it('읽은 버전과 현재 버전이 다르면 409를 던지고 아이템을 건드리지 않는다', async () => {
      manager.update.mockResolvedValue({ affected: 0 });
      manager.exists.mockResolvedValue(true);

      await expect(
        service.update('course-id', 'partner-id', {
          version: 3,
          items: [{ itemOrder: 1, itemType: 'CAFE', name: '새 카페' }],
        }),
      ).rejects.toThrow(ConflictException);

      expect(manager.update).toHaveBeenCalledWith(
        DateCourse,
        { id: 'course-id', version: 3 },
        { version: expect.any(Function) },
      );
      expect(manager.find).not.toHaveBeenCalled();
      expect(manager.delete).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(dateCoursesGateway.emitCourseUpdated).not.toHaveBeenCalled();
    });

    it('중복 장소 검증에 실패하면 기존 아이템을 지우기 전에 거절한다', async () => {
      manager.find.mockResolvedValue([
        createCourseItem({
          id: 'first',
          itemOrder: 1,
          name: '성수 팝업',
          lat: 37,
          lng: 127,
        }),
        createCourseItem({
          id: 'second',
          itemOrder: 2,
          name: '카페',
          lat: 37.001,
          lng: 127,
        }),
      ]);

      await expect(
        service.update('course-id', 'partner-id', {
          items: [
            { id: 'first', itemOrder: 1 },
            { itemOrder: 2, itemType: 'ACTIVITY', name: '성수 팝업' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(manager.delete).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(dateCoursesGateway.emitCourseUpdated).not.toHaveBeenCalled();
    });

    it('응답에 현재 버전을 담는다', () => {
      const response = callToCourseResponse(service, { version: 4 });

      expect(response).toMatchObject({ version: 4 });
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

      usersService.findUserWithProfile.mockResolvedValueOnce(joiningUser);
      courseRepository.findOne
        .mockResolvedValueOnce(course)
        .mockResolvedValueOnce({
          ...course,
          station: null,
          items: [],
          participants: [participant],
          createdAt: new Date('2026-06-04T00:00:00.000Z'),
          updatedAt: new Date('2026-06-04T00:00:00.000Z'),
        } as unknown as DateCourse);
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
        version: number;
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
    version: 1,
    ...course,
  } as DateCourse);
}

function createCourse(params: { items: DateCourseItem[] }) {
  return {
    id: 'course-id',
    ownerUserId: 'owner-id',
    date: '2026-06-04',
    title: '데이트 코스',
    memo: null,
    inviteToken: null,
    inviteExpiresAt: null,
    station: null,
    items: params.items,
    participants: [],
    createdAt: new Date('2026-06-04T00:00:00.000Z'),
    updatedAt: new Date('2026-06-04T00:00:00.000Z'),
    version: 1,
  } as unknown as DateCourse;
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

type MockEntityManager = {
  [K in 'update' | 'exists' | 'find' | 'delete' | 'save' | 'create']: jest.Mock;
};

function mockEntityManager(): MockEntityManager {
  return {
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    exists: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    delete: jest.fn(),
    save: jest.fn((_target: unknown, entities: unknown) => entities),
    create: jest.fn((_target: unknown, entity: unknown) => entity),
  };
}
