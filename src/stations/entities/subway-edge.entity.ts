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

@Entity('subway_edges')
@Unique('uq_edge', ['fromStationId', 'toStationId', 'lineId'])
@Index('idx_edges_from', ['fromStationId'])
export class SubwayEdge {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'from_station_id', type: 'int' })
  fromStationId!: number;

  @Column({ name: 'to_station_id', type: 'int' })
  toStationId!: number;

  @Column({ name: 'line_id', type: 'int' })
  lineId!: number;

  @Column({ name: 'travel_minutes', type: 'int' })
  travelMinutes!: number;

  @ManyToOne(() => SubwayStation, (s) => s.edgesFrom)
  @JoinColumn({ name: 'from_station_id' })
  fromStation!: SubwayStation;

  @ManyToOne(() => SubwayStation, (s) => s.edgesTo)
  @JoinColumn({ name: 'to_station_id' })
  toStation!: SubwayStation;

  @ManyToOne(() => SubwayLine, (l) => l.edges)
  @JoinColumn({ name: 'line_id' })
  line!: SubwayLine;
}
