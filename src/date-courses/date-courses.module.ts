import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/entities';
import { AuthModule } from '../auth/auth.module';
import { SubwayStation } from '../stations/entities';
import { DateCourse, DateCourseItem, DateCourseParticipant } from './entities';
import { DateCoursesController } from './date-courses.controller';
import { DateCoursesGateway } from './date-courses.gateway';
import { DateCoursesService } from './date-courses.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      DateCourse,
      DateCourseItem,
      DateCourseParticipant,
      User,
      SubwayStation,
    ]),
  ],
  controllers: [DateCoursesController],
  providers: [DateCoursesService, DateCoursesGateway],
})
export class DateCoursesModule {}
