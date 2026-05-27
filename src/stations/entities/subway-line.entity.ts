import {
  Entity,
  PrimaryColumn,
  Column,
  OneToMany,
} from 'typeorm';
import { StationLine } from './station-line.entity';
import { SubwayEdge } from './subway-edge.entity';

@Entity('subway_lines')
export class SubwayLine {
  @PrimaryColumn({ type: 'int' })
  id!: number;

  @Column({ type: 'varchar', length: 30 })
  name!: string;

  @Column({ type: 'varchar', length: 7, nullable: true })
  color!: string | null;

  @OneToMany(() => StationLine, (sl) => sl.line)
  stationLines!: StationLine[];

  @OneToMany(() => SubwayEdge, (e) => e.line)
  edges!: SubwayEdge[];
}
