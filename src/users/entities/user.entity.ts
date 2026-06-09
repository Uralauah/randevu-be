import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { SocialAccount } from '../../auth/entities/social-account.entity';

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
}
