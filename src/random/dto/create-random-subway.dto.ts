import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateRandomSubwayDto {
  @Type(() => Number)
  @IsInt()
  departureStationId!: number;

  @Type(() => Number)
  @IsInt()
  @IsIn([20, 40, 60])
  maxMinutes!: number;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  excludeStationIds?: number[];

  @IsString()
  deviceId!: string;
}
