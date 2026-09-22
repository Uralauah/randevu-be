# randevu

![preview](docs/preview.png)

> **"어디로 갈지 모를 때도 괜찮아"** — 출발역 하나로 시작하는 커플 데이트 코스 추천 서비스

출발역과 이동 가능 시간을 입력하면 목적지 역을 추천하고, 그 주변 맛집·카페·놀거리를 찾아줍니다.
커플이 함께 코스를 짜고 실시간으로 공유할 수 있습니다.

**🔗 [서비스 이용해보기](https://randevu-fe.vercel.app)**

---

## 기술 스택

| 구분         | 기술                                                         |
| ------------ | ------------------------------------------------------------ |
| Framework    | NestJS 11                                                    |
| Database     | PostgreSQL · TypeORM                                         |
| Auth         | 직접 구현한 HS256 JWT · 소셜 로그인 (카카오 · 구글 · 네이버) |
| Realtime     | Socket.io WebSocket                                          |
| External API | 네이버 지역검색 · 네이버 블로그 · 카카오 로컬                |

---

## 주요 기능

**랜덤 역 추천**
출발역과 최대 이동 시간(20·40·60분)을 입력하면 Dijkstra로 사전 계산된 이동시간 캐시 위에서 역 등급 가중치를 적용해 목적지를 추천합니다.

**장소 검색 · 추천**
네이버 지역검색 API와 블로그 검색 API를 조합해 역 주변 장소를 찾습니다. 날짜를 입력하면 해당 날짜에 열리는 팝업·기간한정 이벤트를 우선 추천합니다.

**데이트 코스 공유**
코스를 만들고 초대 링크를 공유하면 상대방이 합류할 수 있습니다. 코스 수정 사항은 Socket.io를 통해 실시간으로 양쪽에 반영됩니다.

**소셜 로그인**
카카오(Authorization Code + Access Token), 구글, 네이버 로그인을 지원합니다. Refresh Token은 해시 저장 후 rotation 방식으로 관리합니다.

---

## 구조

```
src/
├── auth/           JWT 발급·검증, 소셜 OAuth, 관리 API 키 가드
├── users/          사용자 프로필
├── stations/       역·노선 데이터, 이동시간 Dijkstra 캐시
├── places/         장소 검색·추천 (외부 API 연동, 호출 스케줄러)
├── random/         가중치 기반 랜덤 역 추천
├── date-courses/   코스 CRUD + WebSocket 실시간 협업
├── common/         CORS 허용 목록, TTL·LRU 캐시
├── database/       TypeORM 설정, 마이그레이션
└── scripts/        관리용 스크립트 (이동시간 캐시 재생성)
```

---

## 실행

```bash
cp .env.example .env   # 값 채우기
npm ci
npm run start:dev
npm test
```

- 빈 DB로 처음 시작할 때만 `DATABASE_SYNCHRONIZE=true`로 테이블을 만듭니다. 운영에서는 항상 꺼집니다.
- 스키마 변경은 `src/database/migrations`에 추가하며, 앱이 시작할 때 적용됩니다.

## 운영

**이동시간 캐시 재생성** — 역·노선 데이터를 바꾼 뒤 실행합니다. 재생성 중에도 역 추천은 이전 캐시를 그대로 읽습니다.

```bash
npm run build
npm run cache:rebuild            # 전체
npm run cache:rebuild -- seoul   # 지역 하나
```

HTTP로도 실행할 수 있습니다(`ADMIN_API_KEY` 설정 필요, 동시에 두 번 실행하면 409).

```bash
curl -X POST -H "x-admin-key: $ADMIN_API_KEY" "$API_URL/stations/travel-time-cache/rebuild"
```

재생성 로직을 바꿨다면 `scripts/verify-travel-time-cache.sql`로 이전 결과와 전수 대조합니다.

개선 이력과 판단 근거는 [docs/improvements.md](docs/improvements.md)에 정리했습니다.
