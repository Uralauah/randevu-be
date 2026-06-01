import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { User } from '../auth/entities';
import { SubwayStation } from '../stations/entities';
import {
  DateCourse,
  DateCourseItem,
  DateCourseParticipant,
} from './entities';
import {
  CreateDateCourseDto,
  CreateDateCourseItemDto,
} from './dto/create-date-course.dto';

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
  ) {}

  async create(dto: CreateDateCourseDto) {
    await this.assertUserExists(dto.userId);
    await this.assertStationExists(dto.stationId);

    const course = this.courseRepository.create({
      ownerUserId: dto.userId,
      stationId: dto.stationId,
      title: dto.title,
      date: dto.date,
      memo: dto.memo ?? null,
      items: dto.items
        .sort((a, b) => a.itemOrder - b.itemOrder)
        .map((item) => this.createItemEntity(item)),
      participants: [
        this.participantRepository.create({
          userId: dto.userId,
          role: 'OWNER',
        }),
      ],
    });

    const savedCourse = await this.courseRepository.save(course);

    return this.findOne(savedCourse.id, dto.userId);
  }

  async findAll(userId: string) {
    await this.assertUserExists(userId);

    const participants = await this.participantRepository.find({
      where: { userId },
      relations: {
        course: {
          station: true,
          items: true,
          participants: true,
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
    await this.assertUserExists(userId);

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
      await this.participantRepository.save({
        courseId: course.id,
        userId,
        role: course.ownerUserId === userId ? 'OWNER' : 'PARTNER',
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
        station: true,
        items: true,
        participants: true,
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
          }
        : null,
      items: (course.items ?? [])
        .sort((a, b) => a.itemOrder - b.itemOrder)
        .map((item) => ({
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
      participants: (course.participants ?? []).map((participant) => ({
        userId: participant.userId,
        role: participant.role,
        joinedAt: participant.createdAt,
      })),
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
    };
  }
}
