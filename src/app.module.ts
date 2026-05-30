import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
import { PlacesModule } from './places/places.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DATABASE_HOST'),
        port: configService.get<number>('DATABASE_PORT'),
        username: configService.get<string>('DATABASE_USERNAME'),
        password: configService.get<string>('DATABASE_PASSWORD'),
        database: configService.get<string>('DATABASE_NAME'),
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
        synchronize: true,
      }),
    }),

    StationsModule,
    RandomModule,
    PlacesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
