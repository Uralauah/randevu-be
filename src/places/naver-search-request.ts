import { InternalServerErrorException, Logger } from '@nestjs/common';
import { scheduleNaverRequest } from './naver-rate-limiter';

/**
 * 네이버 응답이 멈추면 스케줄러 슬롯 하나를 계속 붙잡게 되고, 슬롯 4개가 모두 막히면
 * 모든 사용자의 장소 검색이 멈춘다. 그래서 요청마다 응답 대기 상한을 둔다.
 */
export const NAVER_REQUEST_TIMEOUT_MS = 3_000;

/** 429에 대해서만 재시도한다. 타임아웃·5xx를 재시도하면 느린 상대에게 부하만 더한다. */
const NAVER_RATE_LIMIT_MAX_RETRIES = 2;
const NAVER_RETRY_BASE_DELAY_MS = 400;
/** Retry-After가 이보다 길면 기다리지 않고 실패시킨다(부분 결과로 응답하는 편이 낫다). */
const NAVER_RETRY_MAX_DELAY_MS = 2_000;

export interface NaverSearchRequest {
  url: string;
  clientId: string;
  clientSecret: string;
  /** 로그에 남길 API 이름 (예: 지역 검색) */
  label: string;
  /** 실패했을 때 응답으로 내보낼 메시지 */
  failureMessage: string;
  logger: Logger;
}

/**
 * 네이버 검색 API를 전역 스케줄러 아래에서 호출하고 JSON 본문을 돌려준다.
 */
export async function requestNaverSearch<T>(
  request: NaverSearchRequest,
): Promise<T> {
  const { label, failureMessage, logger } = request;

  for (let attempt = 0; ; attempt += 1) {
    let response: Response;

    try {
      response = await scheduleNaverRequest(() =>
        fetch(request.url, {
          headers: {
            'X-Naver-Client-Id': request.clientId,
            'X-Naver-Client-Secret': request.clientSecret,
          },
          signal: AbortSignal.timeout(NAVER_REQUEST_TIMEOUT_MS),
        }),
      );

      if (response.ok) {
        return (await response.json()) as T;
      }
    } catch (error) {
      logger.error(`네이버 ${label} API 호출 실패: ${describeError(error)}`);

      throw new InternalServerErrorException(failureMessage);
    }

    const retryDelayMs =
      response.status === 429 && attempt < NAVER_RATE_LIMIT_MAX_RETRIES
        ? getRetryDelayMs(response.headers.get('retry-after'), attempt)
        : null;

    if (retryDelayMs !== null) {
      logger.warn(
        `네이버 ${label} 속도 제한으로 재시도: attempt=${attempt + 1}, delayMs=${retryDelayMs}`,
      );
      await sleep(retryDelayMs);
      continue;
    }

    const body = await response.text().catch(() => '');

    logger.error(
      `네이버 ${label} API 호출 실패: status=${response.status}, body=${body}`,
    );

    throw new InternalServerErrorException(failureMessage);
  }
}

/**
 * Retry-After(초 또는 HTTP 날짜)가 있으면 따르고, 없으면 지수 백오프에 지터를 섞는다.
 * 지터가 없으면 같은 순간 429를 받은 요청들이 같은 순간 다시 몰린다.
 * 기다릴 시간이 상한을 넘으면 null(재시도하지 않음)을 돌려준다.
 */
export function getRetryDelayMs(
  retryAfter: string | null,
  attempt: number,
): number | null {
  const retryAfterMs = parseRetryAfterMs(retryAfter);

  if (retryAfterMs !== null) {
    return retryAfterMs <= NAVER_RETRY_MAX_DELAY_MS ? retryAfterMs : null;
  }

  const cap = Math.min(
    NAVER_RETRY_MAX_DELAY_MS,
    NAVER_RETRY_BASE_DELAY_MS * 2 ** attempt,
  );

  // equal jitter: 최소 cap/2는 쉬되 나머지 절반을 무작위로 흩뜨린다.
  return Math.round(cap / 2 + Math.random() * (cap / 2));
}

function parseRetryAfterMs(retryAfter: string | null) {
  if (!retryAfter) {
    return null;
  }

  const seconds = Number(retryAfter);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const date = Date.parse(retryAfter);

  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function describeError(error: unknown) {
  if (error instanceof Error) {
    return error.name === 'TimeoutError'
      ? `${NAVER_REQUEST_TIMEOUT_MS}ms 안에 응답이 없음`
      : `${error.name}: ${error.message}`;
  }

  return String(error);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
