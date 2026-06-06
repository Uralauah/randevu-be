import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { In, Repository } from 'typeorm';
import { User } from '../auth/entities';
import { SubwayStation } from '../stations/entities';
import { DateCourse, DateCourseItem, DateCourseParticipant } from './entities';
import {
  CalculateDateCourseWalkingSegmentsDto,
  CreateDateCourseDto,
  CreateDateCourseItemDto,
  UpdateDateCourseDto,
  UpdateDateCourseItemDto,
} from './dto/create-date-course.dto';
import { DateCoursesGateway } from './date-courses.gateway';

const EARTH_RADIUS_METERS = 6_371_000;
const WALKING_ROUTE_DISTANCE_FACTOR = 1.25;
const WALKING_SPEED_METERS_PER_MINUTE = 67;

interface WalkingSegmentItem {
  id: string | null;
  itemOrder: number;
  name: string;
  lat: number | null;
  lng: number | null;
}

interface CoursePlaceIdentityItem {
  placeKey?: string | null;
  name?: string | null;
  address?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
}

@Injectable()
export class DateCoursesService {
  constructor(
    @InjectRepository(DateCourse)
    private readonly courseRepository: Repository<DateCourse>,

    @InjectRepository(DateCourseItem)
    private readonly itemRepository: Repository<DateCourseItem>,

    @InjectRepository(DateCourseParticipant)
    private readonly participantRepository: Repository<DateCourseParticipant>,

    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    @InjectRepository(SubwayStation)
    private readonly stationRepository: Repository<SubwayStation>,

    private readonly dateCoursesGateway: DateCoursesGateway,
  ) {}

  async create(userId: string, dto: CreateDateCourseDto) {
    await this.assertUserExists(userId);
    await this.assertStationExists(dto.stationId);
    this.assertUniqueItemOrders(dto.items);
    this.assertUniqueCoursePlaces(dto.items);

    const course = this.courseRepository.create({
      ownerUserId: userId,
      stationId: dto.stationId,
      title: dto.title,
      date: dto.date,
      memo: dto.memo ?? null,
      items: dto.items
        .sort((a, b) => a.itemOrder - b.itemOrder)
        .map((item) => this.createItemEntity(item)),
      participants: [
        this.participantRepository.create({
          userId,
          role: 'OWNER',
        }),
      ],
    });

    const savedCourse = await this.courseRepository.save(course);

    return this.findOne(savedCourse.id, userId);
  }

  async findAll(userId: string) {
    await this.assertUserExists(userId);

    const participants = await this.participantRepository.find({
      where: { userId },
      relations: {
        course: {
          station: { stationLines: { line: true } },
          items: true,
          participants: {
            user: {
              socialAccounts: true,
            },
          },
        },
      },
      order: {
        course: {
          date: 'DESC',
          createdAt: 'DESC',
          items: {
            itemOrder: 'ASC',
          },
        },
      },
    });

    return participants.map((participant) =>
      this.toCourseResponse(participant.course),
    );
  }

  async findOne(courseId: string, userId: string) {
    await this.assertParticipant(courseId, userId);

    const course = await this.findCourseOrThrow(courseId);

    return this.toCourseResponse(course);
  }

  async update(courseId: string, userId: string, dto: UpdateDateCourseDto) {
    await this.assertParticipant(courseId, userId);

    const course = await this.findCourseOrThrow(courseId);
    const changed = {
      date: dto.date !== undefined,
      items: dto.items !== undefined,
    };

    if (dto.date !== undefined) {
      await this.courseRepository.update(courseId, {
        date: dto.date,
      });
    }

    if (dto.items !== undefined) {
      await this.updateCourseItems(course, dto.items);
    }

    if (changed.date || changed.items) {
      this.dateCoursesGateway.emitCourseUpdated({
        courseId,
        updatedByUserId: userId,
        changed,
      });
    }

    return this.findOne(courseId, userId);
  }

  previewWalkingSegments(dto: CalculateDateCourseWalkingSegmentsDto) {
    const items = dto.items.map((item) => ({
      id: item.itemId ?? null,
      itemOrder: item.itemOrder,
      name: item.name,
      lat: item.lat ?? null,
      lng: item.lng ?? null,
    }));

    return {
      walkingSegments: this.buildWalkingSegments(this.sortWalkingItems(items)),
    };
  }

  async remove(courseId: string, userId: string) {
    const course = await this.findCourseOrThrow(courseId);

    if (course.ownerUserId !== userId) {
      throw new ForbiddenException('코스 삭제 권한이 없습니다.');
    }

    await this.courseRepository.delete(courseId);

    return { deleted: true };
  }

  async createInvite(courseId: string, userId: string) {
    const course = await this.findCourseOrThrow(courseId);

    if (course.ownerUserId !== userId) {
      throw new ForbiddenException('초대 링크 생성 권한이 없습니다.');
    }

    const inviteToken = randomBytes(24).toString('hex');
    const inviteExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14);

    await this.courseRepository.update(courseId, {
      inviteToken,
      inviteExpiresAt,
    });

    return {
      inviteToken,
      inviteExpiresAt,
      inviteUrl: `/date-courses/invitations/${inviteToken}`,
    };
  }

  async acceptInvite(inviteToken: string, userId: string) {
    const joiningUser = await this.findUserProfileOrThrow(userId);

    const course = await this.courseRepository.findOne({
      where: { inviteToken },
    });

    if (!course) {
      throw new NotFoundException('초대 링크를 찾을 수 없습니다.');
    }

    if (course.inviteExpiresAt && course.inviteExpiresAt < new Date()) {
      throw new ForbiddenException('만료된 초대 링크입니다.');
    }

    const existingParticipant = await this.participantRepository.findOne({
      where: {
        courseId: course.id,
        userId,
      },
    });

    if (!existingParticipant) {
      const participant = await this.participantRepository.save({
        courseId: course.id,
        userId,
        role: course.ownerUserId === userId ? 'OWNER' : 'PARTNER',
      });

      this.dateCoursesGateway.emitParticipantJoined({
        courseId: course.id,
        participant: {
          userId: participant.userId,
          nickname: joiningUser.nickname,
          platform: this.getUserPlatform(joiningUser),
          role: participant.role,
          joinedAt: participant.createdAt,
        },
      });
    }

    return this.findOne(course.id, userId);
  }

  private createItemEntity(dto: CreateDateCourseItemDto) {
    return this.itemRepository.create({
      itemType: dto.itemType,
      itemOrder: dto.itemOrder,
      placeKey: dto.placeKey ?? null,
      name: dto.name,
      categoryName: dto.categoryName ?? null,
      address: dto.address ?? null,
      lat: dto.lat ?? null,
      lng: dto.lng ?? null,
      externalLink: dto.externalLink ?? null,
      mapLink: dto.mapLink ?? null,
      instagramLink: dto.instagramLink ?? null,
      reservationLink: dto.reservationLink ?? null,
      memo: dto.memo ?? null,
    });
  }

  private async updateCourseItems(
    course: DateCourse,
    itemDtos: UpdateDateCourseItemDto[],
  ) {
    this.assertUniqueItemOrders(itemDtos);

    const existingItems = course.items ?? [];
    const existingItemsById = new Map(
      existingItems.map((item) => [item.id, item]),
    );
    const keptItemIds = new Set<string>();
    const itemsToSave: DateCourseItem[] = [];

    for (const itemDto of itemDtos) {
      if (itemDto.id) {
        const existingItem = existingItemsById.get(itemDto.id);

        if (!existingItem) {
          throw new BadRequestException('코스에 포함되지 않은 아이템입니다.');
        }

        if (keptItemIds.has(existingItem.id)) {
          throw new BadRequestException('중복된 코스 아이템입니다.');
        }

        existingItem.itemOrder = itemDto.itemOrder;
        keptItemIds.add(existingItem.id);
        itemsToSave.push(existingItem);
        continue;
      }

      itemsToSave.push(
        this.itemRepository.create({
          ...this.toCreateDateCourseItemDto(itemDto),
          courseId: course.id,
        }),
      );
    }

    const deletedItemIds = existingItems
      .filter((item) => !keptItemIds.has(item.id))
      .map((item) => item.id);

    if (deletedItemIds.length > 0) {
      await this.itemRepository.delete({
        courseId: course.id,
        id: In(deletedItemIds),
      });
    }

    if (itemsToSave.length > 0) {
      this.assertUniqueCoursePlaces(itemsToSave);
      await this.itemRepository.save(itemsToSave);
    }
  }

  private assertUniqueItemOrders(items: UpdateDateCourseItemDto[]) {
    const itemOrders = new Set<number>();

    for (const item of items) {
      if (itemOrders.has(item.itemOrder)) {
        throw new BadRequestException('코스 순서가 중복되었습니다.');
      }

      itemOrders.add(item.itemOrder);
    }
  }

  private assertUniqueCoursePlaces(items: CoursePlaceIdentityItem[]) {
    const seenKeys = new Set<string>();

    for (const item of items) {
      const identityKeys = this.getCoursePlaceIdentityKeys(item);

      for (const key of identityKeys) {
        if (seenKeys.has(key)) {
          throw new BadRequestException('이미 코스에 포함된 장소입니다.');
        }
      }

      for (const key of identityKeys) {
        seenKeys.add(key);
      }
    }
  }

  private getCoursePlaceIdentityKeys(item: CoursePlaceIdentityItem) {
    const keys: string[] = [];
    const nameKey = this.normalizeCoursePlaceIdentity(item.name ?? '');

    if (item.placeKey) {
      keys.push(`placeKey:${item.placeKey}`);
    }

    if (!nameKey) {
      return keys;
    }

    if (item.address) {
      keys.push(
        `nameAddress:${nameKey}:${this.normalizeCoursePlaceIdentity(
          item.address,
        )}`,
      );
    }

    const coordinates = this.getCoordinate({
      lat: item.lat === undefined ? null : item.lat,
      lng: item.lng === undefined ? null : item.lng,
    });

    if (coordinates) {
      keys.push(
        `nameCoordinate:${nameKey}:${coordinates.lat.toFixed(
          5,
        )}:${coordinates.lng.toFixed(5)}`,
      );
    }

    keys.push(`name:${nameKey}`);

    return keys;
  }

  private normalizeCoursePlaceIdentity(value: string) {
    return value.toLowerCase().replace(/\s+/g, '');
  }

  private toCreateDateCourseItemDto(
    item: UpdateDateCourseItemDto,
  ): CreateDateCourseItemDto {
    if (!item.itemType || !item.name) {
      throw new BadRequestException(
        '새 코스 아이템에는 itemType과 name이 필요합니다.',
      );
    }

    return {
      itemType: item.itemType,
      itemOrder: item.itemOrder,
      placeKey: item.placeKey ?? null,
      name: item.name,
      categoryName: item.categoryName ?? null,
      address: item.address ?? null,
      lat: item.lat ?? null,
      lng: item.lng ?? null,
      externalLink: item.externalLink ?? null,
      mapLink: item.mapLink ?? null,
      instagramLink: item.instagramLink ?? null,
      reservationLink: item.reservationLink ?? null,
      memo: item.memo ?? null,
    };
  }

  private async assertUserExists(userId: string) {
    const exists = await this.userRepository.exists({
      where: { id: userId },
    });

    if (!exists) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }
  }

  private async assertStationExists(stationId: number) {
    const exists = await this.stationRepository.exists({
      where: { id: stationId },
    });

    if (!exists) {
      throw new NotFoundException('역을 찾을 수 없습니다.');
    }
  }

  private async assertParticipant(courseId: string, userId: string) {
    const participant = await this.participantRepository.findOne({
      where: { courseId, userId },
    });

    if (!participant) {
      throw new ForbiddenException('코스 접근 권한이 없습니다.');
    }
  }

  private async findCourseOrThrow(courseId: string) {
    const course = await this.courseRepository.findOne({
      where: { id: courseId },
      relations: {
        station: { stationLines: { line: true } },
        items: true,
        participants: {
          user: {
            socialAccounts: true,
          },
        },
      },
      order: {
        items: {
          itemOrder: 'ASC',
        },
      },
    });

    if (!course) {
      throw new NotFoundException('데이트 코스를 찾을 수 없습니다.');
    }

    return course;
  }

  private toCourseResponse(course: DateCourse) {
    const sortedItems = this.sortWalkingItems(course.items ?? []);

    return {
      id: course.id,
      ownerUserId: course.ownerUserId,
      date: course.date,
      title: course.title,
      memo: course.memo,
      inviteToken: course.inviteToken,
      inviteExpiresAt: course.inviteExpiresAt,
      station: course.station
        ? {
            id: course.station.id,
            name: course.station.name,
            lat: course.station.lat,
            lng: course.station.lng,
            vibeText: course.station.vibeText,
            lines: (course.station.stationLines ?? [])
              .sort((a, b) => a.line.id - b.line.id)
              .map((sl) => ({
                id: sl.line.id,
                name: sl.line.name,
                color: sl.line.color ?? '#888888',
              })),
          }
        : null,
      items: sortedItems.map((item) => ({
        id: item.id,
        itemType: item.itemType,
        itemOrder: item.itemOrder,
        placeKey: item.placeKey,
        name: item.name,
        categoryName: item.categoryName,
        address: item.address,
        lat: item.lat === null ? null : Number(item.lat),
        lng: item.lng === null ? null : Number(item.lng),
        externalLink: item.externalLink,
        mapLink: item.mapLink,
        instagramLink: item.instagramLink,
        reservationLink: item.reservationLink,
        memo: item.memo,
      })),
      walkingSegments: this.buildWalkingSegments(sortedItems),
      participants: (course.participants ?? []).map((participant) => ({
        userId: participant.userId,
        nickname: participant.user?.nickname ?? null,
        platform: this.getUserPlatform(participant.user),
        role: participant.role,
        joinedAt: participant.createdAt,
      })),
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
    };
  }

  private sortWalkingItems<T extends WalkingSegmentItem>(items: T[]) {
    return [...items].sort((a, b) => a.itemOrder - b.itemOrder);
  }

  private buildWalkingSegments(items: WalkingSegmentItem[]) {
    return items.slice(1).map((item, index) => {
      const fromItem = items[index];
      const distanceMeters = this.calculateWalkingDistanceMeters(
        fromItem,
        item,
      );

      return {
        fromItemId: fromItem.id,
        fromItemOrder: fromItem.itemOrder,
        fromItemName: fromItem.name,
        toItemId: item.id,
        toItemOrder: item.itemOrder,
        toItemName: item.name,
        distanceMeters,
        estimatedWalkingMinutes:
          distanceMeters === null
            ? null
            : Math.max(
                1,
                Math.round(distanceMeters / WALKING_SPEED_METERS_PER_MINUTE),
              ),
        calculationMethod:
          distanceMeters === null ? 'UNAVAILABLE' : 'COORDINATE_ESTIMATE',
      };
    });
  }

  private calculateWalkingDistanceMeters(
    fromItem: WalkingSegmentItem,
    toItem: WalkingSegmentItem,
  ) {
    const fromCoordinate = this.getCoordinate(fromItem);
    const toCoordinate = this.getCoordinate(toItem);

    if (!fromCoordinate || !toCoordinate) {
      return null;
    }

    const straightLineMeters = this.calculateStraightLineDistanceMeters(
      fromCoordinate,
      toCoordinate,
    );

    return Math.round(straightLineMeters * WALKING_ROUTE_DISTANCE_FACTOR);
  }

  private getCoordinate(item: {
    lat: number | string | null;
    lng: number | string | null;
  }) {
    const lat = item.lat === null ? null : Number(item.lat);
    const lng = item.lng === null ? null : Number(item.lng);

    if (
      lat === null ||
      lng === null ||
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

  private calculateStraightLineDistanceMeters(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
  ) {
    const fromLat = this.toRadians(from.lat);
    const toLat = this.toRadians(to.lat);
    const deltaLat = this.toRadians(to.lat - from.lat);
    const deltaLng = this.toRadians(to.lng - from.lng);

    const a =
      Math.sin(deltaLat / 2) ** 2 +
      Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) ** 2;

    return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private toRadians(value: number) {
    return (value * Math.PI) / 180;
  }

  private async findUserProfileOrThrow(userId: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: {
        socialAccounts: true,
      },
    });

    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }

    return user;
  }

  private getUserPlatform(user?: User | null) {
    if (!user?.socialAccounts?.length) {
      return null;
    }

    const [primaryAccount] = [...user.socialAccounts].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );

    return primaryAccount?.provider ?? null;
  }
}
