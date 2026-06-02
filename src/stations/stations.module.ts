import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StationsController } from './stations.controller';
import { StationsService } from './stations.service';
import {
  Region,
  SubwayStation,
  SubwayEdge,
  SubwayTransfer,
  TravelTimeCache,
} from './entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Region,
      SubwayStation,
      SubwayEdge,
      SubwayTransfer,
      TravelTimeCache,
    ]),
  ],
  controllers: [StationsController],
  providers: [StationsService],
})
export class StationsModule {}
