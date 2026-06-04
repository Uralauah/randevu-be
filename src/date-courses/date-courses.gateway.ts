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
import { DefaultEventsMap, Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { AuthTokenService } from '../auth/auth-token.service';
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
    role: 'OWNER' | 'PARTNER';
    joinedAt: Date | string;
  };
}

@WebSocketGateway({
  namespace: 'date-courses',
  cors: {
    origin: true,
    credentials: true,
  },
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

  private extractToken(client: DateCourseSocket) {
    const auth = client.handshake.auth as Record<string, unknown> | undefined;
    const authToken = auth?.token;
    const queryToken = client.handshake.query?.accessToken;
    const authorization = client.handshake.headers.authorization as
      | string
      | string[]
      | undefined;

    if (typeof authToken === 'string' && authToken.trim()) {
      return this.stripBearerPrefix(authToken);
    }

    if (typeof queryToken === 'string' && queryToken.trim()) {
      return this.stripBearerPrefix(queryToken);
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

    return courseId;
  }

  private getCourseRoom(courseId: string) {
    return `date-course:${courseId}`;
  }
}
