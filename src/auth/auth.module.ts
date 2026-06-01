import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthRefreshToken, SocialAccount, User } from './entities';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthTokenService } from './auth-token.service';
import { AccessTokenGuard } from './access-token.guard';

@Module({
  imports: [TypeOrmModule.forFeature([User, SocialAccount, AuthRefreshToken])],
  controllers: [AuthController],
  providers: [AuthService, AuthTokenService, AccessTokenGuard],
  exports: [AuthService, AuthTokenService, AccessTokenGuard],
})
export class AuthModule {}
