import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SocialAccount } from './auth/entities/social-account.entity';
import { User } from './auth/entities/user.entity';
import { EventLog } from './events/entities/event-log.entity';
import { PlaceRecommendation } from './random/entities/place-recommendation.entity';
import { RandomResult } from './random/entities/random-result.entity';
import { ExcludedStationPresetItem } from './saved/entities/excluded-station-preset-item.entity';
import { ExcludedStationPreset } from './saved/entities/excluded-station-preset.entity';
import { SavedResult } from './saved/entities/saved-result.entity';
import { StationLine } from './stations/entities/station-line.entity';
import { SubwayEdge } from './stations/entities/subway-edge.entity';
import { SubwayLine } from './stations/entities/subway-line.entity';
import { SubwayStation } from './stations/entities/subway-station.entity';
import { SubwayTransfer } from './stations/entities/subway-transfer.entity';
import { TravelTimeCache } from './stations/entities/travel-time-cache.entity';
import { StationsModule } from './stations/stations.module';
import { RandomModule } from './random/random.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'lsh',
      password: 'asdf',
      database: 'randevu',
      entities: [
        SocialAccount,
        User,
        EventLog,
        PlaceRecommendation,
        RandomResult,
        ExcludedStationPresetItem,
        ExcludedStationPreset,
        SavedResult,
        StationLine,
        SubwayEdge,
        SubwayLine,
        SubwayStation,
        SubwayTransfer,
        TravelTimeCache,
      ],
      synchronize: true, // 개발 환경에서만 true로 설정하세요.
    }),
    StationsModule,
    RandomModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
