import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { ExcludedStationPresetItem } from './excluded-station-preset-item.entity';

@Entity('excluded_station_presets')
export class ExcludedStationPreset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 50 })
  name!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => User, (u) => u.excludedStationPresets, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @OneToMany(() => ExcludedStationPresetItem, (item) => item.preset, {
    cascade: true,
  })
  items!: ExcludedStationPresetItem[];
}
