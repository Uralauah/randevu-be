const DEFAULT_ALLOWED_ORIGINS = [
  'https://randevu-fe.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
];

/**
 * REST와 WebSocket이 같은 출처 허용 목록을 쓰도록 한곳에서 관리한다.
 * CORS_ORIGINS(쉼표 구분)로 배포 환경별 출처를 더할 수 있다.
 *
 * 환경변수는 요청 시점에 읽는다. 게이트웨이 데코레이터처럼 모듈을 불러오는 시점에
 * 평가되는 곳에서는 아직 .env가 로드되지 않았을 수 있기 때문이다.
 */
export function getAllowedOrigins() {
  const extraOrigins =
    process.env.CORS_ORIGINS?.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean) ?? [];

  return [...DEFAULT_ALLOWED_ORIGINS, ...extraOrigins];
}

/**
 * Origin 헤더가 없는 요청(서버 간 호출, 앱, curl)은 브라우저 요청이 아니므로 허용한다.
 * 인증은 출처가 아니라 토큰으로 한다.
 */
export function isAllowedOrigin(origin: string | undefined) {
  return !origin || getAllowedOrigins().includes(origin);
}
