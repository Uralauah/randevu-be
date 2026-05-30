import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubwayStation } from '../stations/entities';
import { PlacesController } from './places.controller';
import { PlacesService } from './places.service';
import { KakaoLocalClient } from './kakao-local.client';
import { NaverLocalClient } from './naver-local.client';

@Module({
  imports: [TypeOrmModule.forFeature([SubwayStation])],
  controllers: [PlacesController],
  providers: [PlacesService, KakaoLocalClient, NaverLocalClient],
})
export class PlacesModule {}
