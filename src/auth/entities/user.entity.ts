import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { SocialAccount } from './social-account.entity';
import { RandomResult } from '../../random/entities/random-result.entity';
import { SavedResult } from '../../saved/entities/saved-result.entity';
import { ExcludedStationPreset } from '../../saved/entities/excluded-station-preset.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50 })
  nickname!: string;

  @Column({
    name: 'default_region_code',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  defaultRegionCode!: string | null;

  @Column({ name: 'default_station_id', type: 'int', nullable: true })
  defaultStationId!: number | null;

  @Column({ name: 'max_minutes', type: 'int', nullable: true })
  maxMinutes!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => SocialAccount, (sa) => sa.user, { cascade: true })
  socialAccounts!: SocialAccount[];

  @OneToMany(() => RandomResult, (r) => r.user)
  randomResults!: RandomResult[];

  @OneToMany(() => SavedResult, (s) => s.user)
  savedResults!: SavedResult[];

  @OneToMany(() => ExcludedStationPreset, (p) => p.user)
  excludedStationPresets!: ExcludedStationPreset[];
}
