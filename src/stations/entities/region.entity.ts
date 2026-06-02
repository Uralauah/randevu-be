import { Column, Entity, OneToMany, PrimaryColumn } from 'typeorm';
import { SubwayLine } from './subway-line.entity';
import { SubwayStation } from './subway-station.entity';

@Entity('regions')
export class Region {
  @PrimaryColumn({ type: 'int' })
  id!: number;

  @Column({ type: 'varchar', length: 30 })
  name!: string;

  @Column({ type: 'varchar', length: 10, unique: true })
  code!: string;

  @OneToMany(() => SubwayLine, (line) => line.region)
  lines!: SubwayLine[];

  @OneToMany(() => SubwayStation, (station) => station.region)
  stations!: SubwayStation[];
}
