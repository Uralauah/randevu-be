import {
  Entity,
  PrimaryColumn,
  Column,
  OneToMany,
  Check,
} from 'typeorm';
import { StationLine } from './station-line.entity';
import { SubwayEdge } from './subway-edge.entity';
import { SubwayTransfer } from './subway-transfer.entity';

@Entity('subway_stations')
@Check(`"weight_grade" IN ('A','B','C','D')`)
export class SubwayStation {
  @PrimaryColumn({ type: 'int' })
  id!: number;

  @Column({ type: 'varchar', length: 50 })
  name!: string;

  @Column({ type: 'decimal', precision: 10, scale: 7 })
  lat!: number;

  @Column({ type: 'decimal', precision: 10, scale: 7 })
  lng!: number;

  @Column({
    name: 'weight_grade',
    type: 'char',
    length: 1,
    default: "'C'",
  })
  weightGrade!: string;

  @Column({ name: 'place_count', type: 'int', default: 0 })
  placeCount!: number;

  @OneToMany(() => StationLine, (sl) => sl.station)
  stationLines!: StationLine[];

  @OneToMany(() => SubwayEdge, (e) => e.fromStation)
  edgesFrom!: SubwayEdge[];

  @OneToMany(() => SubwayEdge, (e) => e.toStation)
  edgesTo!: SubwayEdge[];

  @OneToMany(() => SubwayTransfer, (t) => t.station)
  transfers!: SubwayTransfer[];
}
