import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateDateCourseItemDto {
  @IsIn(['RESTAURANT', 'CAFE', 'ACTIVITY', 'CUSTOM'])
  itemType!: 'RESTAURANT' | 'CAFE' | 'ACTIVITY' | 'CUSTOM';

  @Type(() => Number)
  @IsInt()
  itemOrder!: number;

  @IsOptional()
  @IsString()
  placeKey?: string | null;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  categoryName?: string | null;

  @IsOptional()
  @IsString()
  address?: string | null;

  @IsOptional()
  @Type(() => Number)
  lat?: number | null;

  @IsOptional()
  @Type(() => Number)
  lng?: number | null;

  @IsOptional()
  @IsString()
  externalLink?: string | null;

  @IsOptional()
  @IsString()
  mapLink?: string | null;

  @IsOptional()
  @IsString()
  instagramLink?: string | null;

  @IsOptional()
  @IsString()
  reservationLink?: string | null;

  @IsOptional()
  @IsString()
  memo?: string | null;
}

export class CreateDateCourseDto {
  @IsDateString()
  date!: string;

  @Type(() => Number)
  @IsInt()
  stationId!: number;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  memo?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateDateCourseItemDto)
  items!: CreateDateCourseItemDto[];
}

export class UpdateDateCourseItemDto {
  @IsOptional()
  @IsString()
  id?: string | null;

  @Type(() => Number)
  @IsInt()
  itemOrder!: number;

  @IsOptional()
  @IsIn(['RESTAURANT', 'CAFE', 'ACTIVITY', 'CUSTOM'])
  itemType?: 'RESTAURANT' | 'CAFE' | 'ACTIVITY' | 'CUSTOM';

  @IsOptional()
  @IsString()
  placeKey?: string | null;

  @IsOptional()
  @IsString()
  name?: string | null;

  @IsOptional()
  @IsString()
  categoryName?: string | null;

  @IsOptional()
  @IsString()
  address?: string | null;

  @IsOptional()
  @Type(() => Number)
  lat?: number | null;

  @IsOptional()
  @Type(() => Number)
  lng?: number | null;

  @IsOptional()
  @IsString()
  externalLink?: string | null;

  @IsOptional()
  @IsString()
  mapLink?: string | null;

  @IsOptional()
  @IsString()
  instagramLink?: string | null;

  @IsOptional()
  @IsString()
  reservationLink?: string | null;

  @IsOptional()
  @IsString()
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
  name!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lat?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lng?: number | null;
}

export class CalculateDateCourseWalkingSegmentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DateCourseWalkingSegmentItemDto)
  items!: DateCourseWalkingSegmentItemDto[];
}
