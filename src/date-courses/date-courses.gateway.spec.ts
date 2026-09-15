import { WsException } from '@nestjs/websockets';
import { IncomingMessage } from 'http';
import { Repository } from 'typeorm';
import { AuthTokenService } from '../auth/auth-token.service';
import { DateCoursesGateway } from './date-courses.gateway';
import { DateCourseParticipant } from './entities';

const COURSE_ID = '6f1c1d0e-4b7a-4a51-9a59-2c1f3f0b9e11';
const GATEWAY_OPTIONS_METADATA = 'websockets:gateway_options';

interface GatewayOptions {
  allowRequest: (
    request: IncomingMessage,
    callback: (error: string | null | undefined, success: boolean) => void,
  ) => void;
}

const createClient = (handshake: {
  auth?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
}) => ({
  handshake: { auth: {}, query: {}, headers: {}, ...handshake },
  data: {} as { userId?: string; joinedCourseIds?: Set<string> },
  emit: jest.fn(),
  disconnect: jest.fn(),
  join: jest.fn(),
  leave: jest.fn(),
});

describe('DateCoursesGateway', () => {
  let gateway: DateCoursesGateway;
  const verify = jest.fn();
  const participantRepository = { exists: jest.fn(), count: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    verify.mockImplementation((token: string) =>
      token === 'valid-token' ? { sub: 'user-id' } : null,
    );
    gateway = new DateCoursesGateway(
      { verify } as unknown as AuthTokenService,
      participantRepository as unknown as Repository<DateCourseParticipant>,
    );
  });

  describe('연결 인증', () => {
    it('handshake auth의 토큰으로 인증한다', () => {
      const client = createClient({ auth: { token: 'valid-token' } });

      gateway.handleConnection(client as never);

      expect(client.data.userId).toBe('user-id');
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('쿼리스트링 토큰은 받지 않는다', () => {
      const client = createClient({ query: { accessToken: 'valid-token' } });

      gateway.handleConnection(client as never);

      expect(verify).not.toHaveBeenCalled();
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });
  });

  it('형식이 틀린 courseId는 DB를 조회하기 전에 거절한다', async () => {
    const client = createClient({});
    client.data.userId = 'user-id';

    await expect(
      gateway.joinDateCourse(client as never, { courseId: 'not-a-uuid' }),
    ).rejects.toThrow(WsException);
    expect(participantRepository.exists).not.toHaveBeenCalled();
  });

  it('허용 목록에 없는 출처의 WebSocket 연결은 거절한다', () => {
    const { allowRequest } = Reflect.getMetadata(
      GATEWAY_OPTIONS_METADATA,
      DateCoursesGateway,
    ) as GatewayOptions;
    const decide = (origin?: string) => {
      let allowed: boolean | undefined;

      allowRequest(
        { headers: origin ? { origin } : {} } as IncomingMessage,
        (_error, success) => (allowed = success),
      );

      return allowed;
    };

    expect(decide('https://randevu-fe.vercel.app')).toBe(true);
    expect(decide('https://evil.example.com')).toBe(false);
    expect(decide(undefined)).toBe(true);
  });

  it('코스가 삭제되면 알린 뒤 방에 남은 연결을 모두 내보낸다', () => {
    const emit = jest.fn();
    const socketsLeave = jest.fn();
    const server = {
      to: jest.fn(() => ({ emit })),
      in: jest.fn(() => ({ socketsLeave })),
    };
    (gateway as unknown as { server: typeof server }).server = server;

    gateway.emitCourseDeleted({
      courseId: COURSE_ID,
      deletedByUserId: 'owner-id',
    });

    const room = `date-course:${COURSE_ID}`;

    expect(server.to).toHaveBeenCalledWith(room);
    expect(emit).toHaveBeenCalledWith(
      'course:deleted',
      expect.objectContaining({ type: 'COURSE_DELETED', courseId: COURSE_ID }),
    );
    expect(server.in).toHaveBeenCalledWith(room);
    expect(socketsLeave).toHaveBeenCalledWith(room);
  });
});
