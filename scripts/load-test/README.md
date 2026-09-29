# 부하 테스트

결과와 해석은 [docs/improvements.md](../../docs/improvements.md)의 "성능 테스트" 절에 있다.

## 준비

- 운영과 같은 방식으로 빌드해 띄운다. 운영 모드라야 로그 레벨 등이 실제와 같다.
- DB에는 실제 역·노선 데이터와 이동시간 캐시(447,097행)가 있어야 한다. 사용자 데이터는 필요 없으므로
  지하철 테이블만 복사한 별도 DB를 쓰는 것을 권한다.

```bash
createdb randevu_perf
pg_dump -d "$DATABASE_NAME" --no-owner -t regions -t subway_lines -t subway_stations \
  -t station_lines -t subway_edges -t subway_transfers -t travel_time_cache | psql -d randevu_perf
npm run build
NODE_ENV=production DATABASE_NAME=randevu_perf PORT=3918 node dist/main > /tmp/app.log 2>&1 &
```

## 1. DB를 읽는 API (ApacheBench)

```bash
cd scripts/load-test
# 역 추천: 최악 조건(후보가 가장 많은 1번 역, 60분, 후보 552개) / 보통 조건(수도권 중앙값 283번 역, 40분, 후보 166개)
./run-ab.sh random-worst http://localhost:3918/random/subway random-worst.json
./run-ab.sh random-typical http://localhost:3918/random/subway random-typical.json
# 역 목록 (앱 진입 시 호출)
./run-ab.sh stations-seoul "http://localhost:3918/stations?region=SEOUL"
AB_EXTRA="-H Accept-Encoding:gzip" ./run-ab.sh stations-seoul-gzip "http://localhost:3918/stations?region=SEOUL"
```

- 동시 사용자 1/10/50/100명, 각 15초 x 3회. 앞에서 2,000건으로 워밍업한다.
- 역 추천 응답은 매번 길이가 달라 ab가 Length 불일치를 실패로 세므로, 연결·수신·예외만 실패로 본다.

## 2. 외부 API를 부르는 API (네이버 스텁)

실제 네이버 API를 대량으로 부를 수 없으므로, 네이버 검색 호출만 로컬 스텁(응답 60~150ms)으로 돌린다.
스텁은 호출 수, 최대 동시 호출 수, 1초 창의 최대 호출 수를 기록한다. 네이버의 초당 한도는 공개된 값이 없어
429는 흉내 내지 않고, 우리 코드의 호출 패턴과 응답 시간만 본다.

```bash
node naver-stub.js &   # 3990 포트
NODE_ENV=production DATABASE_NAME=randevu_perf PORT=3919 NAVER_CLIENT_ID=stub NAVER_CLIENT_SECRET=stub \
  node --require ./scripts/load-test/redirect-naver.js dist/main &
node scripts/load-test/places-load.js 3919 current
```

- cold: 동시 1/5/10명이 서로 다른(처음 조회하는) 역의 장소 목록을 요청
- warm: 같은 요청을 다시 보냄(인메모리 캐시)
- stampede: 처음 조회하는 역 하나에 동시 10명

## CPU 프로파일

병목을 볼 때는 정상 종료 시 프로파일이 써지도록 시그널을 받으면 `process.exit`하게 하고 `--cpu-prof`로 띄운다.

```bash
echo "process.on('SIGINT', () => process.exit(0))" > /tmp/exit-on-signal.js
NODE_ENV=production node --require /tmp/exit-on-signal.js --cpu-prof --cpu-prof-dir=/tmp/prof dist/main
```
