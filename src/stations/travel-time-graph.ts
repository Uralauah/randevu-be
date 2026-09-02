import { SubwayEdge, SubwayTransfer } from './entities';
import { MinHeap } from './min-heap';

/** 도달할 수 없는 역의 소요시간 */
export const UNREACHABLE = 0x7fffffff;

/**
 * Dial 버킷 큐를 쓸 수 있는 최대 간선 가중치(분).
 * 버킷 수가 가중치에 비례하므로, 데이터가 비정상적으로 큰 값을 담고 있으면
 * 이진 힙으로 물러난다.
 */
const MAX_DIAL_WEIGHT = 240;

/**
 * `(역, 노선)`을 노드로 삼는 노선 확장 그래프를 CSR(compressed sparse row)로 담는다.
 *
 * 문자열 키 `역ID:노선ID` 대신 조밀한 정수 인덱스를 쓰기 때문에
 * 탐색 중에는 Map 조회도, 문자열 생성·파싱도 발생하지 않는다.
 */
export interface TravelTimeGraph {
  /** (역, 노선) 노드 수 */
  nodeCount: number;
  /** 노드 i의 간선은 targets/weights의 [offsets[i], offsets[i + 1]) 구간 */
  offsets: Int32Array;
  targets: Int32Array;
  weights: Int32Array;
  /** 노드 인덱스 -> 역 인덱스 */
  nodeStationIndex: Int32Array;
  /** 역 인덱스 -> 실제 역 ID */
  stationIds: number[];
  stationIndexById: Map<number, number>;
  /** 역 i의 시작 노드는 startNodes의 [startOffsets[i], startOffsets[i + 1]) 구간 */
  startOffsets: Int32Array;
  startNodes: Int32Array;
  maxWeight: number;
}

export function buildTravelTimeGraph(
  edges: SubwayEdge[],
  transfers: SubwayTransfer[],
): TravelTimeGraph {
  const stationIds: number[] = [];
  const stationIndexById = new Map<number, number>();
  const nodeIndexByStation = new Map<number, Map<number, number>>();
  const nodeStationIndexList: number[] = [];

  const stationIndexOf = (stationId: number) => {
    let stationIndex = stationIndexById.get(stationId);

    if (stationIndex === undefined) {
      stationIndex = stationIds.length;
      stationIndexById.set(stationId, stationIndex);
      stationIds.push(stationId);
    }

    return stationIndex;
  };

  const nodeIndexOf = (stationId: number, lineId: number) => {
    let byLineId = nodeIndexByStation.get(stationId);

    if (!byLineId) {
      byLineId = new Map();
      nodeIndexByStation.set(stationId, byLineId);
    }

    let nodeIndex = byLineId.get(lineId);

    if (nodeIndex === undefined) {
      nodeIndex = nodeStationIndexList.length;
      byLineId.set(lineId, nodeIndex);
      nodeStationIndexList.push(stationIndexOf(stationId));
    }

    return nodeIndex;
  };

  const fromNodes: number[] = [];
  const toNodes: number[] = [];
  const edgeWeights: number[] = [];
  let maxWeight = 0;

  const addEdge = (fromNode: number, toNode: number, minutes: number) => {
    fromNodes.push(fromNode);
    toNodes.push(toNode);
    edgeWeights.push(minutes);

    if (minutes > maxWeight) {
      maxWeight = minutes;
    }
  };

  for (const edge of edges) {
    addEdge(
      nodeIndexOf(edge.fromStationId, edge.lineId),
      nodeIndexOf(edge.toStationId, edge.lineId),
      edge.travelMinutes,
    );
  }

  for (const transfer of transfers) {
    addEdge(
      nodeIndexOf(transfer.stationId, transfer.fromLineId),
      nodeIndexOf(transfer.stationId, transfer.toLineId),
      transfer.transferMinutes,
    );
  }

  const nodeCount = nodeStationIndexList.length;
  const edgeCount = fromNodes.length;
  const nodeStationIndex = Int32Array.from(nodeStationIndexList);

  // 출발 노드별로 간선을 모아 CSR로 압축한다.
  const offsets = new Int32Array(nodeCount + 1);

  for (let i = 0; i < edgeCount; i++) {
    offsets[fromNodes[i] + 1]++;
  }

  for (let i = 0; i < nodeCount; i++) {
    offsets[i + 1] += offsets[i];
  }

  const edgeCursor = offsets.slice(0, nodeCount);
  const targets = new Int32Array(edgeCount);
  const weights = new Int32Array(edgeCount);

  for (let i = 0; i < edgeCount; i++) {
    const position = edgeCursor[fromNodes[i]]++;

    targets[position] = toNodes[i];
    weights[position] = edgeWeights[i];
  }

  // 역별 시작 노드 목록도 같은 방식으로 압축한다.
  const startOffsets = new Int32Array(stationIds.length + 1);

  for (let i = 0; i < nodeCount; i++) {
    startOffsets[nodeStationIndex[i] + 1]++;
  }

  for (let i = 0; i < stationIds.length; i++) {
    startOffsets[i + 1] += startOffsets[i];
  }

  const startCursor = startOffsets.slice(0, stationIds.length);
  const startNodes = new Int32Array(nodeCount);

  for (let i = 0; i < nodeCount; i++) {
    startNodes[startCursor[nodeStationIndex[i]]++] = i;
  }

  return {
    nodeCount,
    offsets,
    targets,
    weights,
    nodeStationIndex,
    stationIds,
    stationIndexById,
    startOffsets,
    startNodes,
    maxWeight,
  };
}

/**
 * 한 그래프 위에서 여러 출발역의 최단 소요시간을 반복 계산한다.
 * 작업 버퍼를 인스턴스가 들고 재사용하므로 출발역마다 새로 할당하지 않는다.
 */
export class ShortestTravelTimeSolver {
  private readonly nodeDistances: Int32Array;
  private readonly stationDistances: Int32Array;
  /** Dial 버킷 큐. 이진 힙으로 물러난 경우 비어 있다. */
  private readonly buckets: number[][];
  private readonly bucketModulus: number;
  /** 가중치가 너무 클 때만 쓰는 대체 경로 */
  private readonly heap: MinHeap<number> | null;
  /** 힙 항목을 `분 * packShift + 노드`로 묶기 위한 자릿수 */
  private readonly packShift: number;

  constructor(private readonly graph: TravelTimeGraph) {
    this.nodeDistances = new Int32Array(graph.nodeCount);
    this.stationDistances = new Int32Array(graph.stationIds.length);

    const useDial = graph.maxWeight <= MAX_DIAL_WEIGHT;

    this.bucketModulus = useDial ? graph.maxWeight + 1 : 0;
    this.buckets = useDial
      ? Array.from({ length: this.bucketModulus }, () => [] as number[])
      : [];
    this.heap = useDial ? null : new MinHeap<number>((a, b) => a - b);
    this.packShift = 2 ** Math.ceil(Math.log2(Math.max(graph.nodeCount, 2)));
  }

  get stationIds() {
    return this.graph.stationIds;
  }

  /**
   * 출발역에서 각 역까지의 최단 소요시간(분)을 구한다.
   *
   * 반환 배열의 인덱스는 `stationIds`와 같은 순서이며, 도달할 수 없는 역은
   * `UNREACHABLE`이다. **내부 버퍼를 그대로 돌려주므로 다음 호출 전까지만 유효하다.**
   */
  solveFrom(departureStationId: number): Int32Array {
    this.nodeDistances.fill(UNREACHABLE);
    this.stationDistances.fill(UNREACHABLE);

    const stationIndex = this.graph.stationIndexById.get(departureStationId);

    if (stationIndex === undefined) {
      return this.stationDistances;
    }

    return this.heap
      ? this.solveWithHeap(stationIndex)
      : this.solveWithBuckets(stationIndex);
  }

  /**
   * Dial's algorithm. 가중치가 작은 정수(분)라는 점을 이용해 우선순위 큐를
   * `maxWeight + 1`개의 버킷으로 대신한다. 비교 정렬이 없어 `log` 인수가 사라진다.
   */
  private solveWithBuckets(stationIndex: number) {
    const { offsets, targets, weights, nodeStationIndex } = this.graph;
    const { startOffsets, startNodes } = this.graph;
    const distances = this.nodeDistances;
    const stationDistances = this.stationDistances;
    const buckets = this.buckets;
    const modulus = this.bucketModulus;

    for (const bucket of buckets) {
      bucket.length = 0;
    }

    let queued = 0;

    for (
      let i = startOffsets[stationIndex];
      i < startOffsets[stationIndex + 1];
      i++
    ) {
      const node = startNodes[i];

      distances[node] = 0;
      buckets[0].push(node);
      queued++;
    }

    let minutes = 0;

    while (queued > 0) {
      const bucket = buckets[minutes % modulus];

      while (bucket.length > 0) {
        const node = bucket.pop()!;

        queued--;

        // 더 짧은 경로가 나중에 발견돼 밀려난 항목
        if (distances[node] !== minutes) {
          continue;
        }

        const stationIndexOfNode = nodeStationIndex[node];

        if (minutes < stationDistances[stationIndexOfNode]) {
          stationDistances[stationIndexOfNode] = minutes;
        }

        for (let e = offsets[node]; e < offsets[node + 1]; e++) {
          const target = targets[e];
          const nextMinutes = minutes + weights[e];

          if (nextMinutes < distances[target]) {
            distances[target] = nextMinutes;
            buckets[nextMinutes % modulus].push(target);
            queued++;
          }
        }
      }

      minutes++;
    }

    return stationDistances;
  }

  private solveWithHeap(stationIndex: number) {
    const { offsets, targets, weights, nodeStationIndex } = this.graph;
    const { startOffsets, startNodes } = this.graph;
    const distances = this.nodeDistances;
    const stationDistances = this.stationDistances;
    const heap = this.heap!;
    const shift = this.packShift;

    heap.clear();

    for (
      let i = startOffsets[stationIndex];
      i < startOffsets[stationIndex + 1];
      i++
    ) {
      const node = startNodes[i];

      distances[node] = 0;
      heap.push(node);
    }

    while (heap.size > 0) {
      const packed = heap.pop()!;
      const node = packed % shift;
      const minutes = (packed - node) / shift;

      if (minutes > distances[node]) {
        continue;
      }

      const stationIndexOfNode = nodeStationIndex[node];

      if (minutes < stationDistances[stationIndexOfNode]) {
        stationDistances[stationIndexOfNode] = minutes;
      }

      for (let e = offsets[node]; e < offsets[node + 1]; e++) {
        const target = targets[e];
        const nextMinutes = minutes + weights[e];

        if (nextMinutes < distances[target]) {
          distances[target] = nextMinutes;
          heap.push(nextMinutes * shift + target);
        }
      }
    }

    return stationDistances;
  }
}
