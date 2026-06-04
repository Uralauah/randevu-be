import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/entities';
import { Region, SubwayStation } from '../stations/entities';
import { UpdateMeDto } from './dto/update-me.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    @InjectRepository(Region)
    private readonly regionRepository: Repository<Region>,

    @InjectRepository(SubwayStation)
    private readonly stationRepository: Repository<SubwayStation>,
  ) {}

  async updateMe(userId: string, dto: UpdateMeDto) {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }

    const nextRegionCode =
      dto.defaultRegionCode === undefined
        ? (user.defaultRegionCode ?? null)
        : this.normalizeRegionCode(dto.defaultRegionCode);
    const nextStationId =
      dto.defaultStationId === undefined
        ? (user.defaultStationId ?? null)
        : dto.defaultStationId;

    await this.assertValidProfileDefaults(nextRegionCode, nextStationId);

    if (dto.nickname !== undefined) {
      user.nickname = dto.nickname;
    }

    if (dto.defaultRegionCode !== undefined) {
      user.defaultRegionCode = nextRegionCode;
    }

    if (dto.defaultStationId !== undefined) {
      user.defaultStationId = dto.defaultStationId;
    }

    if (dto.maxMinutes !== undefined) {
      user.maxMinutes = dto.maxMinutes;
    }

    const savedUser = await this.userRepository.save(user);

    return this.toUserProfile(savedUser);
  }

  private normalizeRegionCode(regionCode: string | null) {
    return regionCode?.trim().toLowerCase() ?? null;
  }

  private async assertValidProfileDefaults(
    regionCode: string | null,
    stationId: number | null,
  ) {
    const region = regionCode
      ? await this.regionRepository.findOne({
          where: { code: regionCode.toUpperCase() },
        })
      : null;

    if (regionCode && !region) {
      throw new BadRequestException('유효하지 않은 기본 지역입니다.');
    }

    const station = stationId
      ? await this.stationRepository.findOne({ where: { id: stationId } })
      : null;

    if (stationId && !station) {
      throw new BadRequestException('유효하지 않은 기본 역입니다.');
    }

    if (region && station && station.regionId !== region.id) {
      throw new BadRequestException('기본 역이 기본 지역에 속하지 않습니다.');
    }
  }

  private toUserProfile(user: User) {
    return {
      id: user.id,
      nickname: user.nickname,
      defaultRegionCode: user.defaultRegionCode ?? null,
      defaultStationId: user.defaultStationId ?? null,
      maxMinutes: user.maxMinutes ?? null,
    };
  }
}
