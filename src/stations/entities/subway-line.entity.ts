import {
  Entity,
  PrimaryColumn,
  Column,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Region } from './region.entity';
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

  @Column({ name: 'region_id', type: 'int' })
  regionId!: number;

  @ManyToOne(() => Region, (region) => region.lines)
  @JoinColumn({ name: 'region_id' })
  region!: Region;

  @OneToMany(() => StationLine, (sl) => sl.line)
  stationLines!: StationLine[];

  @OneToMany(() => SubwayEdge, (e) => e.line)
  edges!: SubwayEdge[];
}
