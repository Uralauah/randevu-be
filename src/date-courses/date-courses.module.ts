import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { StationsModule } from '../stations/stations.module';
import { DateCourse, DateCourseItem, DateCourseParticipant } from './entities';
import { DateCoursesController } from './date-courses.controller';
import { DateCoursesGateway } from './date-courses.gateway';
import { DateCoursesService } from './date-courses.service';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    StationsModule,
    TypeOrmModule.forFeature([
      DateCourse,
      DateCourseItem,
      DateCourseParticipant,
    ]),
  ],
  controllers: [DateCoursesController],
  providers: [DateCoursesService, DateCoursesGateway],
})
export class DateCoursesModule {}
