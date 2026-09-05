-- 이동시간 캐시 재생성 결과 검증
--
-- 재생성 로직(탐색 알고리즘, 적재 방식)을 바꾼 뒤, 새 결과가 이전 결과와
-- 행 수와 모든 (출발역, 도착역, 최단 이동시간)까지 같은지 확인한다.
--
-- 사용법
--   1) 재생성 전에 현재 캐시를 보관한다.
--        CREATE TABLE travel_time_cache_before AS TABLE travel_time_cache;
--   2) 바뀐 코드로 재생성한다.
--        npm run cache:rebuild
--   3) 이 파일을 실행한다.
--        psql "$DATABASE_URL" -f scripts/verify-travel-time-cache.sql
--   4) 확인이 끝나면 보관 테이블을 지운다.
--        DROP TABLE travel_time_cache_before;
--
-- 판정: only_before = 0 이고 only_after = 0 이면 두 결과가 완전히 같다.

\echo '== 요약 =='
SELECT
  (SELECT count(*) FROM travel_time_cache_before) AS before_rows,
  (SELECT count(*) FROM travel_time_cache) AS after_rows,
  (
    SELECT count(*) FROM (
      SELECT departure_station_id, arrival_station_id, min_travel_minutes FROM travel_time_cache_before
      EXCEPT
      SELECT departure_station_id, arrival_station_id, min_travel_minutes FROM travel_time_cache
    ) diff
  ) AS only_before,
  (
    SELECT count(*) FROM (
      SELECT departure_station_id, arrival_station_id, min_travel_minutes FROM travel_time_cache
      EXCEPT
      SELECT departure_station_id, arrival_station_id, min_travel_minutes FROM travel_time_cache_before
    ) diff
  ) AS only_after;

\echo '== 차이 표본 (최대 20행, 없으면 비어 있음) =='
SELECT
  coalesce(b.departure_station_id, a.departure_station_id) AS departure_station_id,
  coalesce(b.arrival_station_id, a.arrival_station_id) AS arrival_station_id,
  b.min_travel_minutes AS before_minutes,
  a.min_travel_minutes AS after_minutes
FROM travel_time_cache_before b
FULL OUTER JOIN travel_time_cache a
  ON a.departure_station_id = b.departure_station_id
 AND a.arrival_station_id = b.arrival_station_id
WHERE a.min_travel_minutes IS DISTINCT FROM b.min_travel_minutes
ORDER BY 1, 2
LIMIT 20;
