import { LogLevel } from '@nestjs/common';

/** 낮은 레벨부터 높은 레벨 순 */
const LOG_LEVELS_BY_SEVERITY: LogLevel[] = [
  'verbose',
  'debug',
  'log',
  'warn',
  'error',
  'fatal',
];

/**
 * LOG_LEVEL(남길 최소 레벨)을 Nest 로그 레벨 목록으로 바꾼다.
 *
 * Nest는 운영에서도 기본으로 debug·verbose까지 남긴다. 요청마다 남는 진단 로그가 운영 로그를
 * 크게 늘리므로(부하 테스트에서 역 추천 13만 회에 767MB) 운영 기본값은 log로 둔다.
 * 문제를 조사할 때만 LOG_LEVEL=debug로 잠시 켠다.
 */
export function resolveLogLevels(
  logLevel: string | undefined,
  nodeEnv: string | undefined,
): LogLevel[] {
  const fallback: LogLevel = nodeEnv === 'production' ? 'log' : 'verbose';
  const requested = logLevel?.trim().toLowerCase() as LogLevel | undefined;
  const minimum =
    requested && LOG_LEVELS_BY_SEVERITY.includes(requested)
      ? requested
      : fallback;

  return LOG_LEVELS_BY_SEVERITY.slice(LOG_LEVELS_BY_SEVERITY.indexOf(minimum));
}
