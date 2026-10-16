import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { isAllowedOrigin } from './common/cors';
import { DatabaseExceptionFilter } from './common/filters/database-exception.filter';
import { resolveLogLevels } from './common/log-levels';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: resolveLogLevels(process.env.LOG_LEVEL, process.env.NODE_ENV),
  });

  // 배포·재시작 때 받는 종료 신호(SIGTERM)에 바로 죽지 않고, 새 요청을 받지 않은 채
  // 진행 중인 요청을 마친 뒤 소켓·DB 연결을 닫고 종료한다. 없으면 그 순간의 요청이 끊긴다.
  app.enableShutdownHooks();

  app.enableCors({
    origin(
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) {
      callback(null, isAllowedOrigin(origin));
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.useGlobalFilters(
    new DatabaseExceptionFilter(app.get(HttpAdapterHost).httpAdapter),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
