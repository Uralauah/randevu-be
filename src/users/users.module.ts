import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { User } from '../auth/entities';
import { Region, SubwayStation } from '../stations/entities';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([User, Region, SubwayStation]),
  ],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
