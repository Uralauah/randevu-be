import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { Request } from 'express';

export const ADMIN_API_KEY_HEADER = 'x-admin-key';

const MIN_ADMIN_API_KEY_LENGTH = 32;

/**
 * 운영자만 호출해야 하는 관리 API를 보호한다.
 *
 * 사용자 인증(AccessTokenGuard)과 별개로, 서버 환경변수 ADMIN_API_KEY와 같은 값을
 * `x-admin-key` 헤더로 보낸 요청만 통과시킨다. 키가 설정되어 있지 않으면 관리 API를
 * 아예 열지 않는다(fail-closed).
 */
@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(AdminApiKeyGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expectedKey = this.configService.get<string>('ADMIN_API_KEY');

    if (!expectedKey || expectedKey.length < MIN_ADMIN_API_KEY_LENGTH) {
      this.logger.error(
        `ADMIN_API_KEY가 없거나 ${MIN_ADMIN_API_KEY_LENGTH}자 미만이라 관리 API 요청을 거부했습니다.`,
      );
      throw new ForbiddenException('관리 API가 비활성화되어 있습니다.');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const givenKey = request.header(ADMIN_API_KEY_HEADER);

    if (!givenKey || !this.safeEqual(givenKey, expectedKey)) {
      throw new UnauthorizedException('관리자 인증에 실패했습니다.');
    }

    return true;
  }

  /**
   * 길이가 다르면 timingSafeEqual이 바로 예외를 던져 길이가 새어 나가므로,
   * 양쪽을 같은 길이의 해시로 바꾼 뒤 비교한다.
   */
  private safeEqual(given: string, expected: string) {
    const givenDigest = createHash('sha256').update(given).digest();
    const expectedDigest = createHash('sha256').update(expected).digest();

    return timingSafeEqual(givenDigest, expectedDigest);
  }
}
