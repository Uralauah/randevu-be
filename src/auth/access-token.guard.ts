import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthTokenService } from './auth-token.service';
import { CurrentUser } from './current-user.decorator';

interface AuthenticatedRequest extends Request {
  user?: CurrentUser;
}

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly authTokenService: AuthTokenService) {}

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException('인증 토큰이 없습니다.');
    }

    const payload = this.authTokenService.verify(token);

    if (!payload) {
      throw new UnauthorizedException('유효하지 않은 인증 토큰입니다.');
    }

    request.user = {
      id: payload.sub,
    };

    return true;
  }

  private extractBearerToken(authorization?: string) {
    if (!authorization) {
      return null;
    }

    const [type, token, ...rest] = authorization.trim().split(/\s+/);

    if (type?.toLowerCase() !== 'bearer' || !token || rest.length > 0) {
      return null;
    }

    return token;
  }
}
