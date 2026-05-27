import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { RandomResult } from '../../random/entities/random-result.entity';

@Entity('saved_results')
@Unique('uq_saved', ['userId', 'randomResultId'])
@Index('idx_saved_results_user', ['userId', 'createdAt'])
export class SavedResult {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'random_result_id', type: 'uuid' })
  randomResultId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => User, (u) => u.savedResults, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @ManyToOne(() => RandomResult, (r) => r.savedResults, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'random_result_id' })
  randomResult!: RandomResult;
}
