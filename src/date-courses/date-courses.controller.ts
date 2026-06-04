import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { DateCoursesService } from './date-courses.service';
import {
  CalculateDateCourseWalkingSegmentsDto,
  CreateDateCourseDto,
} from './dto/create-date-course.dto';

@Controller('date-courses')
@UseGuards(AccessTokenGuard)
export class DateCoursesController {
  constructor(private readonly dateCoursesService: DateCoursesService) {}

  @Post()
  create(@CurrentUser() user: CurrentUser, @Body() dto: CreateDateCourseDto) {
    return this.dateCoursesService.create(user.id, dto);
  }

  @Get()
  findAll(@CurrentUser() user: CurrentUser) {
    return this.dateCoursesService.findAll(user.id);
  }

  @Get(':id')
  findOne(@CurrentUser() user: CurrentUser, @Param('id') id: string) {
    return this.dateCoursesService.findOne(id, user.id);
  }

  @Post('walking-segments/preview')
  previewWalkingSegments(@Body() dto: CalculateDateCourseWalkingSegmentsDto) {
    return this.dateCoursesService.previewWalkingSegments(dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: CurrentUser, @Param('id') id: string) {
    return this.dateCoursesService.remove(id, user.id);
  }

  @Post(':id/invite')
  createInvite(@CurrentUser() user: CurrentUser, @Param('id') id: string) {
    return this.dateCoursesService.createInvite(id, user.id);
  }

  @Post('invitations/:token/accept')
  acceptInvite(
    @CurrentUser() user: CurrentUser,
    @Param('token') token: string,
  ) {
    return this.dateCoursesService.acceptInvite(token, user.id);
  }
}
