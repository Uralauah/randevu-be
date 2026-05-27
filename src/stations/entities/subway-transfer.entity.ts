import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
  Index,
} from 'typeorm';
import { SubwayStation } from './subway-station.entity';
import { SubwayLine } from './subway-line.entity';

@Entity('subway_transfers')
@Unique('uq_transfer', ['stationId', 'fromLineId', 'toLineId'])
@Index('idx_transfers_station', ['stationId'])
export class SubwayTransfer {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'station_id', type: 'int' })
  stationId!: number;

  @Column({ name: 'from_line_id', type: 'int' })
  fromLineId!: number;

  @Column({ name: 'to_line_id', type: 'int' })
  toLineId!: number;

  @Column({ name: 'transfer_minutes', type: 'int' })
  transferMinutes!: number;

  @ManyToOne(() => SubwayStation, (s) => s.transfers)
  @JoinColumn({ name: 'station_id' })
  station!: SubwayStation;

  @ManyToOne(() => SubwayLine)
  @JoinColumn({ name: 'from_line_id' })
  fromLine!: SubwayLine;

  @ManyToOne(() => SubwayLine)
  @JoinColumn({ name: 'to_line_id' })
  toLine!: SubwayLine;
}
