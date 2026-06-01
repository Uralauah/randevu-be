import { IsUUID } from 'class-validator';

export class AcceptDateCourseInviteDto {
  @IsUUID()
  userId!: string;
}
