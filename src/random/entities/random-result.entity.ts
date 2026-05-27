import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { SubwayStation } from '../../stations/entities/subway-station.entity';
import { PlaceRecommendation } from './place-recommendation.entity';
import { SavedResult } from '../../saved/entities/saved-result.entity';

@Entity('random_results')
@Index('idx_random_results_device', ['deviceId', 'createdAt'])
@Index('idx_random_results_user', ['userId', 'createdAt'])
export class RandomResult {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ name: 'device_id', type: 'varchar', length: 100 })
  deviceId!: string;

  @Column({ name: 'departure_station_id', type: 'int' })
  departureStationId!: number;

  @Column({ name: 'result_station_id', type: 'int' })
  resultStationId!: number;

  @Column({ name: 'max_travel_minutes', type: 'int' })
  maxTravelMinutes!: number;

  @Column({ name: 'actual_travel_minutes', type: 'int' })
  actualTravelMinutes!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => User, (u) => u.randomResults, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user!: User | null;

  @ManyToOne(() => SubwayStation)
  @JoinColumn({ name: 'departure_station_id' })
  departureStation!: SubwayStation;

  @ManyToOne(() => SubwayStation)
  @JoinColumn({ name: 'result_station_id' })
  resultStation!: SubwayStation;

  @OneToMany(() => PlaceRecommendation, (p) => p.randomResult, {
    cascade: true,
  })
  recommendations!: PlaceRecommendation[];

  @OneToMany(() => SavedResult, (s) => s.randomResult)
  savedResults!: SavedResult[];
}
