import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SocialAccount, AuthRefreshToken } from './entities';
import { User } from '../users/entities';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthTokenService } from './auth-token.service';
import { SocialAuthService } from './social-auth.service';
import { AccessTokenGuard } from './access-token.guard';
import { createJwtOptions } from './jwt-options';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, SocialAccount, AuthRefreshToken]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: createJwtOptions,
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthTokenService,
    SocialAuthService,
    AccessTokenGuard,
  ],
  exports: [AuthService, AuthTokenService, AccessTokenGuard],
})
export class AuthModule {}
