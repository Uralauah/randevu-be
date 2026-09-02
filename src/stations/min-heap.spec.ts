import { MinHeap } from './min-heap';

describe('MinHeap', () => {
  it('빈 힙에서 pop하면 undefined를 반환한다', () => {
    const heap = new MinHeap<number>((a, b) => a - b);

    expect(heap.size).toBe(0);
    expect(heap.pop()).toBeUndefined();
  });

  it('push한 순서와 무관하게 항상 최솟값부터 pop된다', () => {
    const heap = new MinHeap<number>((a, b) => a - b);
    const values = [5, 3, 8, 1, 9, 2, 7, 0, 4, 6];

    for (const value of values) {
      heap.push(value);
    }

    const popped: number[] = [];

    while (heap.size > 0) {
      popped.push(heap.pop()!);
    }

    expect(popped).toEqual([...values].sort((a, b) => a - b));
  });

  it('push와 pop이 섞여도 정렬 순서를 유지한다', () => {
    const heap = new MinHeap<number>((a, b) => a - b);
    const reference: number[] = [];
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let i = 0; i < 500; i++) {
      if (reference.length === 0 || rand() < 0.6) {
        const value = Math.floor(rand() * 1000);
        heap.push(value);
        reference.push(value);
        reference.sort((a, b) => a - b);
      } else {
        expect(heap.pop()).toBe(reference.shift());
      }
    }

    while (reference.length > 0) {
      expect(heap.pop()).toBe(reference.shift());
    }

    expect(heap.size).toBe(0);
  });

  it('중복 값을 모두 보존한다', () => {
    const heap = new MinHeap<number>((a, b) => a - b);

    for (const value of [3, 1, 3, 1, 3]) {
      heap.push(value);
    }

    expect([
      heap.pop(),
      heap.pop(),
      heap.pop(),
      heap.pop(),
      heap.pop(),
    ]).toEqual([1, 1, 3, 3, 3]);
  });

  it('clear 후에는 비어 있고 다시 사용할 수 있다', () => {
    const heap = new MinHeap<number>((a, b) => a - b);

    for (const value of [9, 4, 7]) {
      heap.push(value);
    }

    heap.clear();

    expect(heap.size).toBe(0);
    expect(heap.pop()).toBeUndefined();

    heap.push(5);
    heap.push(2);

    expect(heap.pop()).toBe(2);
    expect(heap.pop()).toBe(5);
  });

  it('비교 함수 기준으로 정렬한다', () => {
    const heap = new MinHeap<{ node: string; minutes: number }>(
      (a, b) => a.minutes - b.minutes,
    );

    heap.push({ node: 'a', minutes: 10 });
    heap.push({ node: 'b', minutes: 2 });
    heap.push({ node: 'c', minutes: 7 });

    expect(heap.pop()!.node).toBe('b');
    expect(heap.pop()!.node).toBe('c');
    expect(heap.pop()!.node).toBe('a');
  });
});
