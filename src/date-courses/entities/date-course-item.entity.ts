import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DateCourse } from './date-course.entity';

@Entity('date_course_items')
@Check(`"item_type" IN ('RESTAURANT','CAFE','ACTIVITY','CUSTOM')`)
@Index('idx_date_course_items_course_order', ['courseId', 'itemOrder'])
export class DateCourseItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'course_id', type: 'uuid' })
  courseId!: string;

  @Column({ name: 'item_type', type: 'varchar', length: 20 })
  itemType!: 'RESTAURANT' | 'CAFE' | 'ACTIVITY' | 'CUSTOM';

  @Column({ name: 'item_order', type: 'int' })
  itemOrder!: number;

  @Column({ name: 'place_key', type: 'varchar', length: 120, nullable: true })
  placeKey!: string | null;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ name: 'category_name', type: 'varchar', length: 200, nullable: true })
  categoryName!: string | null;

  @Column({ type: 'varchar', length: 250, nullable: true })
  address!: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  lat!: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  lng!: number | null;

  @Column({ name: 'external_link', type: 'varchar', length: 500, nullable: true })
  externalLink!: string | null;

  @Column({ name: 'map_link', type: 'varchar', length: 500, nullable: true })
  mapLink!: string | null;

  @Column({ name: 'instagram_link', type: 'varchar', length: 500, nullable: true })
  instagramLink!: string | null;

  @Column({ name: 'reservation_link', type: 'varchar', length: 500, nullable: true })
  reservationLink!: string | null;

  @Column({ type: 'text', nullable: true })
  memo!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => DateCourse, (course) => course.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'course_id' })
  course!: DateCourse;
}
