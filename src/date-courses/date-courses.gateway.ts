import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { isUUID } from 'class-validator';
import { IncomingMessage } from 'http';
import { DefaultEventsMap, Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { AuthTokenService } from '../auth/auth-token.service';
import { isAllowedOrigin } from '../common/cors';
import { DateCourseParticipant } from './entities';

interface DateCourseSocketData {
  userId?: string;
  joinedCourseIds?: Set<string>;
}

type DateCourseSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  DateCourseSocketData
>;

interface JoinDateCoursePayload {
  courseId?: string;
}

export interface DateCourseParticipantJoinedPayload {
  courseId: string;
  participant: {
    userId: string;
    nickname: string | null;
    platform: string | null;
    role: 'OWNER' | 'PARTNER';
    joinedAt: Date | string;
  };
}

export interface DateCourseUpdatedPayload {
  courseId: string;
  updatedByUserId: string;
  changed: {
    date: boolean;
    items: boolean;
  };
}

export interface DateCourseDeletedPayload {
  courseId: string;
  deletedByUserId: string;
}

@WebSocketGateway({
  namespace: 'date-courses',
  // REST와 같은 출처 허용 목록을 쓴다(폴링 전송의 HTTP 요청에 적용).
  cors: {
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => callback(null, isAllowedOrigin(origin)),
    credentials: true,
  },
  // 브라우저는 WebSocket 연결에 CORS를 적용하지 않고, 위 cors 설정도 헤더만 붙일 뿐
  // 거절하지 않는다. 그래서 업그레이드 요청의 Origin은 여기서 직접 확인한다.
  allowRequest: (
    request: IncomingMessage,
    callback: (error: string | null | undefined, success: boolean) => void,
  ) => callback(null, isAllowedOrigin(request.headers.origin)),
})
export class DateCoursesGateway implements OnGatewayConnection {
  @WebSocketServer()
  private server!: Server<
    DefaultEventsMap,
    DefaultEventsMap,
    DefaultEventsMap,
    DateCourseSocketData
  >;

  private readonly logger = new Logger(DateCoursesGateway.name);

  constructor(
    private readonly authTokenService: AuthTokenService,

    @InjectRepository(DateCourseParticipant)
    private readonly participantRepository: Repository<DateCourseParticipant>,
  ) {}

  handleConnection(client: DateCourseSocket) {
    const token = this.extractToken(client);
    const payload = token ? this.authTokenService.verify(token) : null;

    if (!payload) {
      client.emit('date-course:error', {
        code: 'UNAUTHORIZED',
        message: '로그인이 필요합니다.',
      });
      client.disconnect(true);
      return;
    }

    client.data.userId = payload.sub;
    client.data.joinedCourseIds = new Set();
    client.emit('date-course:connected', {
      userId: payload.sub,
    });
  }

  @SubscribeMessage('date-course:join')
  async joinDateCourse(
    @ConnectedSocket() client: DateCourseSocket,
    @MessageBody() body: JoinDateCoursePayload,
  ) {
    const userId = this.getAuthenticatedUserId(client);
    const courseId = this.getCourseId(body);

    const isParticipant = await this.participantRepository.exists({
      where: { courseId, userId },
    });

    if (!isParticipant) {
      throw new WsException('코스 접근 권한이 없습니다.');
    }

    await client.join(this.getCourseRoom(courseId));
    client.data.joinedCourseIds?.add(courseId);

    const participantCount = await this.participantRepository.count({
      where: { courseId },
    });

    return {
      courseId,
      participantCount,
      joinedCourseIds: [...(client.data.joinedCourseIds ?? [])],
    };
  }

  @SubscribeMessage('date-course:leave')
  async leaveDateCourse(
    @ConnectedSocket() client: DateCourseSocket,
    @MessageBody() body: JoinDateCoursePayload,
  ) {
    const courseId = this.getCourseId(body);

    await client.leave(this.getCourseRoom(courseId));
    client.data.joinedCourseIds?.delete(courseId);

    return {
      courseId,
      joinedCourseIds: [...(client.data.joinedCourseIds ?? [])],
    };
  }

  emitParticipantJoined(payload: DateCourseParticipantJoinedPayload) {
    if (!this.server) {
      this.logger.warn(
        `Socket server is not ready. Skipped participant:joined for courseId=${payload.courseId}`,
      );
      return;
    }

    this.server
      .to(this.getCourseRoom(payload.courseId))
      .emit('participant:joined', {
        type: 'PARTICIPANT_JOINED',
        courseId: payload.courseId,
        participant: {
          ...payload.participant,
          joinedAt:
            payload.participant.joinedAt instanceof Date
              ? payload.participant.joinedAt.toISOString()
              : payload.participant.joinedAt,
        },
        emittedAt: new Date().toISOString(),
        refetchRecommended: true,
      });
  }

  /**
   * 코스가 삭제되면 알린 뒤, 그 방에 남아 있는 연결을 모두 내보낸다.
   * 그대로 두면 같은 ID로 오는 이벤트를 계속 받을 수 있는 방이 남는다.
   */
  emitCourseDeleted(payload: DateCourseDeletedPayload) {
    if (!this.server) {
      this.logger.warn(
        `Socket server is not ready. Skipped course:deleted for courseId=${payload.courseId}`,
      );
      return;
    }

    const room = this.getCourseRoom(payload.courseId);

    this.server.to(room).emit('course:deleted', {
      type: 'COURSE_DELETED',
      courseId: payload.courseId,
      deletedByUserId: payload.deletedByUserId,
      emittedAt: new Date().toISOString(),
    });
    this.server.in(room).socketsLeave(room);
  }

  emitCourseUpdated(payload: DateCourseUpdatedPayload) {
    if (!this.server) {
      this.logger.warn(
        `Socket server is not ready. Skipped course:updated for courseId=${payload.courseId}`,
      );
      return;
    }

    this.server
      .to(this.getCourseRoom(payload.courseId))
      .emit('course:updated', {
        type: 'COURSE_UPDATED',
        courseId: payload.courseId,
        updatedByUserId: payload.updatedByUserId,
        changed: payload.changed,
        emittedAt: new Date().toISOString(),
        refetchRecommended: true,
      });
  }

  /**
   * 토큰은 handshake auth(브라우저) 또는 Authorization 헤더(앱·서버)로만 받는다.
   * 쿼리스트링으로 받으면 URL과 함께 프록시·로드밸런서 접근 로그에 남을 수 있다.
   */
  private extractToken(client: DateCourseSocket) {
    const auth = client.handshake.auth as Record<string, unknown> | undefined;
    const authToken = auth?.token;
    const authorization = client.handshake.headers.authorization as
      | string
      | string[]
      | undefined;

    if (typeof authToken === 'string' && authToken.trim()) {
      return this.stripBearerPrefix(authToken);
    }

    if (Array.isArray(authorization)) {
      return this.stripBearerPrefix(authorization[0] ?? '');
    }

    if (typeof authorization === 'string' && authorization.trim()) {
      return this.stripBearerPrefix(authorization);
    }

    return null;
  }

  private stripBearerPrefix(value: string) {
    return value.replace(/^bearer\s+/i, '').trim();
  }

  private getAuthenticatedUserId(client: DateCourseSocket) {
    if (!client.data.userId) {
      throw new WsException('로그인이 필요합니다.');
    }

    return client.data.userId;
  }

  private getCourseId(body: JoinDateCoursePayload) {
    if (!body?.courseId || typeof body.courseId !== 'string') {
      throw new WsException('courseId가 필요합니다.');
    }

    const courseId = body.courseId.trim();

    if (!courseId) {
      throw new WsException('courseId가 필요합니다.');
    }

    // 형식이 틀린 값을 그대로 uuid 컬럼 조회에 넘기면 DB 오류가 난다.
    if (!isUUID(courseId)) {
      throw new WsException('courseId 형식이 올바르지 않습니다.');
    }

    return courseId;
  }

  private getCourseRoom(courseId: string) {
    return `date-course:${courseId}`;
  }
}
