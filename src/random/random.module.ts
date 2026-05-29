import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RandomController } from './random.controller';
import { RandomService } from './random.service';
import { RandomResult } from './entities';
import {
  StationLine,
  SubwayStation,
  TravelTimeCache,
} from '../stations/entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RandomResult,
      SubwayStation,
      TravelTimeCache,
      StationLine,
    ]),
  ],
  controllers: [RandomController],
  providers: [RandomService],
})
export class RandomModule {}
