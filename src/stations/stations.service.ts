import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  SubwayEdge,
  SubwayStation,
  SubwayTransfer,
  TravelTimeCache,
} from './entities';
import { FindOptionsWhere, Repository } from 'typeorm';

type GraphNodeKey = string;

interface GraphEdge {
  to: GraphNodeKey;
  minutes: number;
}

@Injectable()
export class StationsService {
  private readonly logger = new Logger(StationsService.name);

  constructor(
    @InjectRepository(SubwayStation)
    private readonly stationRepository: Repository<SubwayStation>,

    @InjectRepository(SubwayEdge)
    private readonly edgeRepository: Repository<SubwayEdge>,

    @InjectRepository(SubwayTransfer)
    private readonly transferRepository: Repository<SubwayTransfer>,

    @InjectRepository(TravelTimeCache)
    private readonly travelTimeCacheRepository: Repository<TravelTimeCache>,
  ) {}

  async findAll(regionCode?: string) {
    const where: FindOptionsWhere<SubwayStation> | undefined = regionCode
      ? {
          region: {
            code: regionCode.toUpperCase(),
          },
        }
      : undefined;

    const stations = await this.stationRepository.find({
      where,
      relations: {
        region: true,
        stationLines: {
          line: true,
        },
      },
      order: {
        id: 'ASC',
      },
    });

    return stations.map((station) => ({
      id: station.id,
      name: station.name,
      lat: station.lat,
      lng: station.lng,
      weightGrade: station.weightGrade,
      placeCount: station.placeCount,
      region: station.region
        ? {
            id: station.region.id,
            name: station.region.name,
            code: station.region.code,
          }
        : null,
      lines: station.stationLines.map((stationLine) => ({
        id: stationLine.line.id,
        name: stationLine.line.name,
        color: stationLine.line.color,
        regionId: stationLine.line.regionId,
      })),
    }));
  }

  async rebuildTravelTimeCache() {
    const stations = await this.stationRepository.find();
    const edges = await this.edgeRepository.find();
    const transfers = await this.transferRepository.find();

    this.logger.log(
      `이동시간 캐시 재생성 시작: stations=${stations.length}, edges=${edges.length}, transfers=${transfers.length}`,
    );

    const graph = this.buildGraph(edges, transfers);

    await this.travelTimeCacheRepository.clear();

    const cacheRows: TravelTimeCache[] = [];

    for (const station of stations) {
      const distances = this.calculateShortestTimesFromStation(
        station.id,
        graph,
        edges,
        transfers,
      );

      for (const [arrivalStationId, minTravelMinutes] of distances.entries()) {
        cacheRows.push(
          this.travelTimeCacheRepository.create({
            departureStationId: station.id,
            arrivalStationId,
            minTravelMinutes,
          }),
        );
      }
    }

    await this.travelTimeCacheRepository.save(cacheRows, { chunk: 1000 });

    this.logger.log('이동시간 캐시 재설정 완료: rows=${cacheRows.length}');

    return {
      stationCount: stations.length,
      cacheCount: cacheRows.length,
    };
  }

  private buildGraph(edges: SubwayEdge[], transfers: SubwayTransfer[]) {
    const graph = new Map<GraphNodeKey, GraphEdge[]>();

    const addEdge = (from: GraphNodeKey, to: GraphNodeKey, minutes: number) => {
      if (!graph.has(from)) {
        graph.set(from, []);
      }

      graph.get(from)!.push({ to, minutes });
    };

    for (const edge of edges) {
      const from = this.toNodeKey(edge.fromStationId, edge.lineId);
      const to = this.toNodeKey(edge.toStationId, edge.lineId);

      addEdge(from, to, edge.travelMinutes);
    }

    for (const transfer of transfers) {
      const from = this.toNodeKey(transfer.stationId, transfer.fromLineId);
      const to = this.toNodeKey(transfer.stationId, transfer.toLineId);

      addEdge(from, to, transfer.transferMinutes);
    }

    return graph;
  }

  private calculateShortestTimesFromStation(
    departureStationId: number,
    graph: Map<GraphNodeKey, GraphEdge[]>,
    edges: SubwayEdge[],
    transfers: SubwayTransfer[],
  ) {
    const startNodes = this.findLineNodeKeysByStationId(
      departureStationId,
      edges,
      transfers,
    );

    const nodeDistances = this.dijkstra(startNodes, graph);
    const stationDistances = new Map<number, number>();

    for (const [nodeKey, minutes] of nodeDistances.entries()) {
      const stationId = this.parseStationId(nodeKey);
      const current = stationDistances.get(stationId);

      if (current === undefined || minutes < current) {
        stationDistances.set(stationId, minutes);
      }
    }

    return stationDistances;
  }

  private findLineNodeKeysByStationId(
    stationId: number,
    edges: SubwayEdge[],
    transfers: SubwayTransfer[],
  ) {
    const lineIds = new Set<number>();

    for (const edge of edges) {
      if (edge.fromStationId === stationId) {
        lineIds.add(edge.lineId);
      }

      if (edge.toStationId === stationId) {
        lineIds.add(edge.lineId);
      }
    }

    for (const transfer of transfers) {
      if (transfer.stationId === stationId) {
        lineIds.add(transfer.fromLineId);
        lineIds.add(transfer.toLineId);
      }
    }

    return [...lineIds].map((lineId) => this.toNodeKey(stationId, lineId));
  }

  private dijkstra(
    startNodes: GraphNodeKey[],
    graph: Map<GraphNodeKey, GraphEdge[]>,
  ) {
    const distances = new Map<GraphNodeKey, number>();
    const visited = new Set<GraphNodeKey>();
    const queue: Array<{ node: GraphNodeKey; minutes: number }> = [];

    for (const startNode of startNodes) {
      distances.set(startNode, 0);
      queue.push({ node: startNode, minutes: 0 });
    }

    while (queue.length > 0) {
      queue.sort((a, b) => a.minutes - b.minutes);

      const current = queue.shift()!;

      if (visited.has(current.node)) {
        continue;
      }

      visited.add(current.node);

      const nextEdges = graph.get(current.node) ?? [];

      for (const edge of nextEdges) {
        const nextMinutes = current.minutes + edge.minutes;
        const knownMinutes = distances.get(edge.to);

        if (knownMinutes === undefined || nextMinutes < knownMinutes) {
          distances.set(edge.to, nextMinutes);
          queue.push({
            node: edge.to,
            minutes: nextMinutes,
          });
        }
      }
    }
    return distances;
  }

  private toNodeKey(stationId: number, lineId: number) {
    return `${stationId}:${lineId}`;
  }

  private parseStationId(nodeKey: GraphNodeKey) {
    return Number(nodeKey.split(':')[0]);
  }
}
