import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StationsController } from './stations.controller';
import { StationsService } from './stations.service';
import {
  Region,
  SubwayLine,
  StationLine,
  SubwayStation,
  SubwayEdge,
  SubwayTransfer,
  TravelTimeCache,
} from './entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Region,
      SubwayLine,
      StationLine,
      SubwayStation,
      SubwayEdge,
      SubwayTransfer,
      TravelTimeCache,
    ]),
  ],
  controllers: [StationsController],
  providers: [StationsService],
  exports: [StationsService],
})
export class StationsModule {}
