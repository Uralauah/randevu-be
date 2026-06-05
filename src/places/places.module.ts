import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubwayStation } from '../stations/entities';
import { PlacesController } from './places.controller';
import { PlacesService } from './places.service';
import { KakaoLocalClient } from './kakao-local.client';
import { NaverLocalClient } from './naver-local.client';
import { NaverBlogClient } from './naver-blog.client';
import { PlaceTagService } from './place-tag.service';
import { PlaceCache } from './entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([SubwayStation, PlaceCache]),
  ],
  controllers: [PlacesController],
  providers: [
    PlacesService,
    KakaoLocalClient,
    NaverLocalClient,
    NaverBlogClient,
    PlaceTagService,
  ],
})
export class PlacesModule {}
