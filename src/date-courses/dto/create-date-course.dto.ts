import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * 문자열 길이 상한은 엔티티 컬럼 길이와 맞춘다. 검증 없이 긴 값이 들어오면
 * DB가 거절하면서 500이 나가므로, 요청 단계에서 400으로 돌려준다.
 */
const MAX_COURSE_ITEMS = 20;
const MAX_MEMO_LENGTH = 1_000;

export class CreateDateCourseItemDto {
  @IsIn(['RESTAURANT', 'CAFE', 'ACTIVITY', 'CUSTOM'])
  itemType!: 'RESTAURANT' | 'CAFE' | 'ACTIVITY' | 'CUSTOM';

  @Type(() => Number)
  @IsInt()
  itemOrder!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  placeKey?: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  categoryName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  address?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  externalLink?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  mapLink?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  instagramLink?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reservationLink?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_MEMO_LENGTH)
  memo?: string | null;
}

export class CreateDateCourseDto {
  @IsDateString()
  date!: string;

  @Type(() => Number)
  @IsInt()
  stationId!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_MEMO_LENGTH)
  memo?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_COURSE_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => CreateDateCourseItemDto)
  items!: CreateDateCourseItemDto[];
}

export class UpdateDateCourseItemDto {
  @IsOptional()
  @IsUUID()
  id?: string | null;

  @Type(() => Number)
  @IsInt()
  itemOrder!: number;

  @IsOptional()
  @IsIn(['RESTAURANT', 'CAFE', 'ACTIVITY', 'CUSTOM'])
  itemType?: 'RESTAURANT' | 'CAFE' | 'ACTIVITY' | 'CUSTOM';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  placeKey?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  categoryName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  address?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  externalLink?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  mapLink?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  instagramLink?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reservationLink?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_MEMO_LENGTH)
  memo?: string | null;
}

export class UpdateDateCourseDto {
  /**
   * 클라이언트가 마지막으로 읽은 코스 버전. 보내면 그 사이 다른 사람이 먼저 수정한 경우
   * 409로 거절한다. 기존 클라이언트와의 호환을 위해 아직은 선택 값이다.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_COURSE_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => UpdateDateCourseItemDto)
  items?: UpdateDateCourseItemDto[];
}

export class DateCourseWalkingSegmentItemDto {
  @IsOptional()
  @IsString()
  itemId?: string | null;

  @Type(() => Number)
  @IsInt()
  itemOrder!: number;

  @IsOptional()
  @IsString()
  placeKey?: string | null;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number | null;
}

export class CalculateDateCourseWalkingSegmentsDto {
  @IsArray()
  @ArrayMinSize(1)
  // 로그인 없이 부를 수 있는 API라 한 번에 계산할 수 있는 개수를 제한한다.
  @ArrayMaxSize(MAX_COURSE_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => DateCourseWalkingSegmentItemDto)
  items!: DateCourseWalkingSegmentItemDto[];
}
