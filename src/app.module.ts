import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'your_username',
      password: 'your_password',
      database: 'your_database',
      entities: [],
      synchronize: true, // 개발 환경에서만 true로 설정하세요.
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
