import {
  Entity,
  PrimaryColumn,
  Column,
  OneToMany,
  Check,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Region } from './region.entity';
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

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  lat!: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  lng!: number | null;

  @Column({
    name: 'weight_grade',
    type: 'char',
    length: 1,
    default: 'C',
  })
  weightGrade!: string;

  @Column({ name: 'place_count', type: 'int', default: 0 })
  placeCount!: number;

  @Column({ name: 'region_id', type: 'int' })
  regionId!: number;

  @ManyToOne(() => Region, (region) => region.stations)
  @JoinColumn({ name: 'region_id' })
  region!: Region;

  @OneToMany(() => StationLine, (sl) => sl.station)
  stationLines!: StationLine[];

  @OneToMany(() => SubwayEdge, (e) => e.fromStation)
  edgesFrom!: SubwayEdge[];

  @OneToMany(() => SubwayEdge, (e) => e.toStation)
  edgesTo!: SubwayEdge[];

  @OneToMany(() => SubwayTransfer, (t) => t.station)
  transfers!: SubwayTransfer[];

  @Column({ name: 'vibe_text', type: 'varchar', length: 100, nullable: true })
  vibeText!: string | null;
}
