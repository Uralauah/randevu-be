#!/bin/zsh
# ApacheBench(ab)로 한 API를 동시 사용자 수별로 측정한다.
#
#   usage: run-ab.sh <label> <url> [post-body-file]
#
#   환경변수
#     LEVELS    동시 사용자 수 목록 (기본 "1 10 50 100")
#     DURATION  측정 1회 시간(초) (기본 15)
#     REPS      반복 횟수 (기본 3)
#     AB_EXTRA  ab에 더 넘길 옵션 (예: "-H Accept-Encoding:gzip")
#     APP_PID   CPU 사용률을 잴 앱 프로세스 (기본: "node dist/main" 프로세스)
#     OUT       결과를 덧붙일 파일 (기본: 표준 출력만)
#
# 실행마다 RPS, p50/p95/p99(ms), 실패 수, 측정 중 앱 프로세스 평균 CPU를 한 줄로 남긴다.
#
# 앱은 운영과 같은 조건으로 띄운다(로그 레벨 등).
#   npm run build && NODE_ENV=production PORT=3918 node dist/main
#
#   ./run-ab.sh random-worst http://localhost:3918/random/subway random-worst.json
#   ./run-ab.sh stations-seoul "http://localhost:3918/stations?region=SEOUL"
label=$1; url=$2; body=$3
duration=${DURATION:-15}
reps=${REPS:-3}
levels=(${=LEVELS:-1 10 50 100})
extra=(${=AB_EXTRA:-})
pid=${APP_PID:-$(pgrep -f "node dist/main" | head -1)}

post_args=()
[ -n "$body" ] && post_args=(-p "$body" -T application/json)

# 워밍업 (JIT, DB 커넥션 풀, PostgreSQL 버퍼)
ab -k -q $extra -n 2000 -c 10 $post_args "$url" > /dev/null 2>&1

for c in $levels; do
  for r in $(seq 1 $reps); do
    cpu_log=$(mktemp)
    ( while true; do ps -o %cpu= -p $pid >> $cpu_log; sleep 1; done ) &
    sampler=$!
    res=$(ab -k -q $extra -t $duration -n 10000000 -c $c $post_args "$url" 2>&1)
    kill $sampler 2>/dev/null; wait $sampler 2>/dev/null

    rps=$(echo "$res" | awk '/Requests per second/ {print $4}')
    # 응답 길이가 매번 다른 API(랜덤 추천)는 ab가 Length 불일치를 실패로 센다. 연결·수신·예외만 실패로 본다.
    failed=$(echo "$res" | awk -F'[(:,)]' '/Connect:.*Receive:/ {gsub(/ /,""); print $3+$5+$9}'); failed=${failed:-0}
    non2xx=$(echo "$res" | awk '/Non-2xx responses/ {print $3}'); non2xx=${non2xx:-0}
    p50=$(echo "$res" | awk '$1=="50%" {print $2}')
    p95=$(echo "$res" | awk '$1=="95%" {print $2}')
    p99=$(echo "$res" | awk '$1=="99%" {print $2}')
    cpu=$(awk '{s+=$1; n++} END {if(n) printf "%.0f", s/n}' $cpu_log); rm -f $cpu_log

    line="$label c=$c run=$r rps=$rps p50=$p50 p95=$p95 p99=$p99 failed=$failed non2xx=$non2xx app_cpu=$cpu%"
    echo "$line"
    if [ -n "$OUT" ]; then echo "$line" >> "$OUT"; fi
  done
done
