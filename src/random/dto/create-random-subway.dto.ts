import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
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
  // 전체 역이 879개이므로 이보다 많이 제외할 일은 없다.
  @ArrayMaxSize(1_000)
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  excludeStationIds?: number[];

  @IsString()
  @MaxLength(100)
  deviceId!: string;
}
