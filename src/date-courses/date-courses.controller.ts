import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { DateCoursesService } from './date-courses.service';
import { CreateDateCourseDto } from './dto/create-date-course.dto';
import { AcceptDateCourseInviteDto } from './dto/accept-date-course-invite.dto';

@Controller('date-courses')
export class DateCoursesController {
  constructor(private readonly dateCoursesService: DateCoursesService) {}

  @Post()
  create(@Body() dto: CreateDateCourseDto) {
    return this.dateCoursesService.create(dto);
  }

  @Get()
  findAll(@Query('userId') userId: string) {
    return this.dateCoursesService.findAll(userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Query('userId') userId: string) {
    return this.dateCoursesService.findOne(id, userId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Query('userId') userId: string) {
    return this.dateCoursesService.remove(id, userId);
  }

  @Post(':id/invite')
  createInvite(@Param('id') id: string, @Body('userId') userId: string) {
    return this.dateCoursesService.createInvite(id, userId);
  }

  @Post('invitations/:token/accept')
  acceptInvite(
    @Param('token') token: string,
    @Body() dto: AcceptDateCourseInviteDto,
  ) {
    return this.dateCoursesService.acceptInvite(token, dto.userId);
  }
}
