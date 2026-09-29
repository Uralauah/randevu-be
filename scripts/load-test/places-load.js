// 장소 목록 API 동시 사용자 시나리오.
//  - cold: 동시 K명이 서로 다른(처음 조회하는) 역을 조회
//  - warm: 같은 요청을 다시 보냄(인메모리 캐시)
//  - stampede: 처음 조회하는 역 하나에 동시 10명
// usage: node places-load.js <app-port> <label>
//
// 실제 네이버 API를 대량으로 부를 수 없으므로 네이버 검색 호출만 스텁으로 돌린다.
//   node scripts/load-test/naver-stub.js &
//   NODE_ENV=production PORT=3919 NAVER_CLIENT_ID=stub NAVER_CLIENT_SECRET=stub \
//     node --require ./scripts/load-test/redirect-naver.js dist/main &
//   node scripts/load-test/places-load.js 3919 current
const [port, label] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`;
const stub = `http://127.0.0.1:${process.env.STUB_PORT ?? 3990}`;

// 수도권 역 ID를 순서대로 꺼내 쓴다(매번 처음 조회하는 역이 되도록).
let stationIds = [];
const takeStations = (n) => stationIds.splice(0, n);

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

async function timed(stationId) {
  const t0 = performance.now();
  const res = await fetch(`${base}/stations/${stationId}/places?type=RESTAURANT`);
  await res.arrayBuffer();
  if (!res.ok) throw new Error(`status ${res.status}`);
  return performance.now() - t0;
}

async function stats() {
  return (await fetch(`${stub}/__stats`)).json();
}

async function run(name, stationIds) {
  await fetch(`${stub}/__reset`);
  const latencies = (await Promise.all(stationIds.map(timed))).sort((a, b) => a - b);
  const s = await stats();
  console.log(
    `${label} ${name.padEnd(14)} users=${String(stationIds.length).padStart(2)} ` +
      `p50=${pct(latencies, 50).toFixed(0)}ms p95=${pct(latencies, 95).toFixed(0)}ms max=${latencies.at(-1).toFixed(0)}ms ` +
      `upstream_calls=${s.total} max_concurrent=${s.maxInFlight} max_calls_per_sec=${s.maxPerSecond}`,
  );
}

(async () => {
  stationIds = (await (await fetch(`${base}/stations?region=SEOUL`)).json()).map((s) => s.id);
  // 앱 워밍업(첫 요청의 JIT·DB 커넥션 비용 제외)
  await timed(stationIds.shift());
  for (const users of [1, 5, 10]) {
    const stations = takeStations(users);
    await run('cold', stations);
    await run('warm', stations);
  }
  const [one] = takeStations(1);
  await run('stampede(same)', Array(10).fill(one));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
