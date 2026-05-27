import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { SubwayStation } from './subway-station.entity';

@Entity('travel_time_cache')
@Index('idx_travel_cache_departure', ['departureStationId', 'minTravelMinutes'])
export class TravelTimeCache {
  @PrimaryColumn({ name: 'departure_station_id', type: 'int' })
  departureStationId!: number;

  @PrimaryColumn({ name: 'arrival_station_id', type: 'int' })
  arrivalStationId!: number;

  @Column({ name: 'min_travel_minutes', type: 'int' })
  minTravelMinutes!: number;

  @ManyToOne(() => SubwayStation)
  @JoinColumn({ name: 'departure_station_id' })
  departureStation!: SubwayStation;

  @ManyToOne(() => SubwayStation)
  @JoinColumn({ name: 'arrival_station_id' })
  arrivalStation!: SubwayStation;
}
