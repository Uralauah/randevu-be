import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { PlaceTagResponse, PlaceType } from '../places.type';

@Entity('place_cache')
export class PlaceCache {
  @PrimaryColumn({ name: 'place_key', type: 'varchar', length: 120 })
  placeKey!: string;

  @Column({ type: 'varchar', length: 20 })
  provider!: 'NAVER' | 'KAKAO';

  @Column({ name: 'external_id', type: 'varchar', length: 80, nullable: true })
  externalId!: string | null;

  @Column({ name: 'place_type', type: 'varchar', length: 20 })
  placeType!: PlaceType;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ name: 'summary', type: 'varchar', length: 160, nullable: true })
  summary!: string | null;

  @Column({ name: 'description', type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @Column({ name: 'category_name', type: 'varchar', length: 200, nullable: true })
  categoryName!: string | null;

  @Column({ type: 'varchar', length: 250, nullable: true })
  address!: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  lat!: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  lng!: number | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phone!: string | null;

  @Column({ name: 'opening_hours', type: 'varchar', length: 100, default: '알 수 없음' })
  openingHours!: string;

  @Column({ name: 'external_link', type: 'varchar', length: 500, nullable: true })
  externalLink!: string | null;

  @Column({ name: 'map_link', type: 'varchar', length: 500, nullable: true })
  mapLink!: string | null;

  @Column({ name: 'instagram_link', type: 'varchar', length: 500, nullable: true })
  instagramLink!: string | null;

  @Column({ name: 'reservation_link', type: 'varchar', length: 500, nullable: true })
  reservationLink!: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  tags!: string[];

  @Column({ name: 'tag_details', type: 'jsonb', default: () => "'[]'::jsonb" })
  tagDetails!: PlaceTagResponse[];

  @Column({ name: 'raw_local', type: 'jsonb', nullable: true })
  rawLocal!: any | null;

  @Column({ name: 'raw_blog', type: 'jsonb', nullable: true })
  rawBlog!: any | null;

  @Column({ name: 'tag_cached_at', type: 'timestamptz', nullable: true })
  tagCachedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
