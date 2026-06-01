import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { DateCourse } from './date-course.entity';

@Entity('date_course_participants')
@Check(`"role" IN ('OWNER','PARTNER')`)
@Unique('uq_date_course_participant', ['courseId', 'userId'])
@Index('idx_date_course_participants_user', ['userId', 'createdAt'])
export class DateCourseParticipant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'course_id', type: 'uuid' })
  courseId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 20 })
  role!: 'OWNER' | 'PARTNER';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => DateCourse, (course) => course.participants, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'course_id' })
  course!: DateCourse;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;
}
