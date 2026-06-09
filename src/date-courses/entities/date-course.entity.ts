import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { SubwayStation } from '../../stations/entities';
import { DateCourseItem } from './date-course-item.entity';
import { DateCourseParticipant } from './date-course-participant.entity';

@Entity('date_courses')
@Index('idx_date_courses_owner', ['ownerUserId', 'date'])
@Index('idx_date_courses_invite_token', ['inviteToken'], { unique: true })
export class DateCourse {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId!: string;

  @Column({ name: 'station_id', type: 'int' })
  stationId!: number;

  @Column({ type: 'varchar', length: 100 })
  title!: string;

  @Column({ type: 'date' })
  date!: string;

  @Column({ type: 'text', nullable: true })
  memo!: string | null;

  @Column({
    name: 'invite_token',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  inviteToken!: string | null;

  @Column({ name: 'invite_expires_at', type: 'timestamptz', nullable: true })
  inviteExpiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_user_id' })
  owner!: User;

  @ManyToOne(() => SubwayStation)
  @JoinColumn({ name: 'station_id' })
  station!: SubwayStation;

  @OneToMany(() => DateCourseItem, (item) => item.course, {
    cascade: true,
  })
  items!: DateCourseItem[];

  @OneToMany(() => DateCourseParticipant, (participant) => participant.course, {
    cascade: true,
  })
  participants!: DateCourseParticipant[];
}
