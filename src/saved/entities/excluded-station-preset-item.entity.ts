import {
  Entity,
  ManyToOne,
  JoinColumn,
  PrimaryColumn,
} from 'typeorm';
import { ExcludedStationPreset } from './excluded-station-preset.entity';
import { SubwayStation } from '../../stations/entities/subway-station.entity';

@Entity('excluded_station_preset_items')
export class ExcludedStationPresetItem {
  @PrimaryColumn({ name: 'preset_id', type: 'uuid' })
  presetId!: string;

  @PrimaryColumn({ name: 'station_id', type: 'int' })
  stationId!: number;

  @ManyToOne(() => ExcludedStationPreset, (p) => p.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'preset_id' })
  preset!: ExcludedStationPreset;

  @ManyToOne(() => SubwayStation)
  @JoinColumn({ name: 'station_id' })
  station!: SubwayStation;
}
