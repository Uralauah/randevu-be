import { createHash } from 'crypto';
import { Request, Response } from 'express';
import { promisify } from 'util';
import { brotliCompress, constants, gzip } from 'zlib';

const gzipAsync = promisify(gzip);
const brotliCompressAsync = promisify(brotliCompress);

/**
 * 내용이 자주 바뀌지 않는 JSON 응답을 직렬화·압축·ETag까지 미리 만들어 둔 것.
 * 요청마다 JSON.stringify, 문자열 인코딩, ETag 해시, 압축을 반복하지 않는다.
 */
export interface PrecompressedJson {
  identity: Buffer;
  gzip: Buffer;
  brotli: Buffer;
  etag: string;
}

export async function precompressJson(
  value: unknown,
): Promise<PrecompressedJson> {
  const identity = Buffer.from(JSON.stringify(value));

  // 압축은 libuv 스레드 풀에서 돌려 이벤트 루프를 막지 않는다.
  const [gzipped, brotli] = await Promise.all([
    gzipAsync(identity, { level: 9 }),
    brotliCompressAsync(identity, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: identity.length,
      },
    }),
  ]);

  return {
    identity,
    gzip: gzipped,
    brotli,
    // 인코딩마다 바이트는 달라도 의미는 같으므로 약한 ETag를 쓴다.
    etag: `W/"${createHash('sha1').update(identity).digest('base64url')}"`,
  };
}

type ContentEncoding = 'br' | 'gzip' | 'identity';

/**
 * Accept-Encoding이 없으면 압축하지 않는다. 브라우저는 보통 "gzip, deflate, br" 순으로 보내는데,
 * 기본 협상은 헤더 순서를 따라 gzip을 고르므로 br을 받을 수 있으면 br을 먼저 고른다(더 작다).
 */
function chooseEncoding(request: Request): ContentEncoding {
  if (!request.headers['accept-encoding']) {
    return 'identity';
  }

  if (request.acceptsEncodings('br') === 'br') {
    return 'br';
  }

  if (request.acceptsEncodings('gzip') === 'gzip') {
    return 'gzip';
  }

  return 'identity';
}

export function sendPrecompressedJson(
  request: Request,
  response: Response,
  payload: PrecompressedJson,
  options: { maxAgeSeconds: number },
) {
  const encoding = chooseEncoding(request);
  const body =
    encoding === 'br'
      ? payload.brotli
      : encoding === 'gzip'
        ? payload.gzip
        : payload.identity;

  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader(
    'Cache-Control',
    `public, max-age=${options.maxAgeSeconds}`,
  );
  // ETag를 미리 넣어 두면 Express가 본문 해시를 다시 계산하지 않고,
  // If-None-Match가 같으면 send()가 304로 응답한다.
  response.setHeader('ETag', payload.etag);
  // CORS가 넣은 Vary: Origin을 덮어쓰지 않도록 덧붙인다.
  response.vary('Accept-Encoding');

  if (encoding !== 'identity') {
    response.setHeader('Content-Encoding', encoding);
  }

  response.send(body);
}
