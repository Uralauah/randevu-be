import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RandomController } from './random.controller';
import { RandomService } from './random.service';
import { TravelTimeCache } from '../stations/entities';
import { StationsModule } from '../stations/stations.module';

@Module({
  imports: [TypeOrmModule.forFeature([TravelTimeCache]), StationsModule],
  controllers: [RandomController],
  providers: [RandomService],
})
export class RandomModule {}
