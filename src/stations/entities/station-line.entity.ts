import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { SubwayStation } from './subway-station.entity';
import { SubwayLine } from './subway-line.entity';

@Entity('station_lines')
@Index('idx_station_lines_line', ['lineId', 'stationOrder'])
export class StationLine {
  @PrimaryColumn({ name: 'station_id', type: 'int' })
  stationId!: number;

  @PrimaryColumn({ name: 'line_id', type: 'int' })
  lineId!: number;

  @Column({ name: 'station_order', type: 'int' })
  stationOrder!: number;

  @ManyToOne(() => SubwayStation, (s) => s.stationLines)
  @JoinColumn({ name: 'station_id' })
  station!: SubwayStation;

  @ManyToOne(() => SubwayLine, (l) => l.stationLines)
  @JoinColumn({ name: 'line_id' })
  line!: SubwayLine;
}
