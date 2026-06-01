import { IsIn, IsOptional, IsString } from 'class-validator';

export class SocialLoginDto {
  @IsIn(['KAKAO', 'GOOGLE', 'NAVER'])
  provider!: 'KAKAO' | 'GOOGLE' | 'NAVER';

  @IsOptional()
  @IsString()
  accessToken?: string;

  // 카카오 authorization code flow
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  redirectUri?: string;
}
