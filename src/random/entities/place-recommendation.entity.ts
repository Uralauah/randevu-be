import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  Check,
} from 'typeorm';
import { RandomResult } from './random-result.entity';

@Entity('place_recommendations')
@Check(`"place_type" IN ('RESTAURANT','CAFE','ACTIVITY')`)
@Index('idx_place_rec_kakao', ['kakaoPlaceId'])
export class PlaceRecommendation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'random_result_id', type: 'uuid' })
  randomResultId!: string;

  @Column({ name: 'kakao_place_id', type: 'varchar', length: 30, nullable: true })
  kakaoPlaceId!: string | null;

  @Column({ name: 'place_type', type: 'varchar', length: 20 })
  placeType!: string; // RESTAURANT | CAFE | ACTIVITY

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  address!: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  lat!: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  lng!: number | null;

  @Column({ type: 'decimal', precision: 3, scale: 1, nullable: true })
  rating!: number | null;

  @Column({ name: 'review_count', type: 'int', default: 0 })
  reviewCount!: number;

  @Column({ name: 'distance_meters', type: 'int', nullable: true })
  distanceMeters!: number | null;

  @Column({ name: 'external_link', type: 'varchar', length: 500, nullable: true })
  externalLink!: string | null;

  @ManyToOne(() => RandomResult, (r) => r.recommendations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'random_result_id' })
  randomResult!: RandomResult;
}
