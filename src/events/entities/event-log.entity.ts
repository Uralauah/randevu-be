import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('event_logs')
@Index('idx_event_logs_type_date', ['eventType', 'createdAt'])
@Index('idx_event_logs_device', ['deviceId', 'createdAt'])
export class EventLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 50 })
  eventType!: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ name: 'device_id', type: 'varchar', length: 100 })
  deviceId!: string;

  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, any>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
