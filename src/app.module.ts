import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StationsModule } from './stations/stations.module';
import { RandomModule } from './random/random.module';
import { PlacesModule } from './places/places.module';
import { DateCoursesModule } from './date-courses/date-courses.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { createTypeOrmOptions } from './database/typeorm-options';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: createTypeOrmOptions,
    }),

    StationsModule,
    RandomModule,
    PlacesModule,
    DateCoursesModule,
    AuthModule,
    UsersModule,
  ],
})
export class AppModule {}
