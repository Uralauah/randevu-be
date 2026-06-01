import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
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
