import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  HttpException,
  Logger,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { QueryFailedError } from 'typeorm';

/**
 * 요청 값 때문에 DB가 거절한 경우의 SQLSTATE → 응답.
 * 서버 버그일 수 있는 오류(외래키 위반 등)는 일부러 넣지 않고 500으로 둔다.
 */
const CLIENT_ERROR_BY_SQLSTATE: Record<string, () => HttpException> = {
  // invalid_text_representation (예: uuid 컬럼에 'abc')
  '22P02': () => new BadRequestException('요청 값의 형식이 올바르지 않습니다.'),
  // numeric_value_out_of_range (예: integer 범위를 넘는 ID)
  '22003': () => new BadRequestException('요청 값이 허용 범위를 벗어났습니다.'),
  // string_data_right_truncation (컬럼 길이 초과)
  '22001': () => new BadRequestException('요청 값이 너무 깁니다.'),
  // invalid_datetime_format, datetime_field_overflow
  '22007': () => new BadRequestException('날짜 형식이 올바르지 않습니다.'),
  '22008': () => new BadRequestException('날짜 값이 올바르지 않습니다.'),
  // unique_violation
  '23505': () => new ConflictException('이미 존재하는 데이터입니다.'),
};

/**
 * 입력 검증을 빠져나간 잘못된 값이 DB에서 거절되면 500 대신 400·409로 응답한다.
 *
 * 요청 검증(파이프·DTO)이 1차 방어선이고, 이 필터는 검증이 빠진 곳을 위한 안전망이다.
 * 예: ParseIntPipe는 정수인지만 보므로 integer 범위를 넘는 ID는 DB까지 가서 실패한다.
 */
@Catch(QueryFailedError)
export class DatabaseExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(DatabaseExceptionFilter.name);

  catch(exception: QueryFailedError, host: ArgumentsHost) {
    const code = (exception.driverError as { code?: string } | undefined)?.code;
    const toClientError = code ? CLIENT_ERROR_BY_SQLSTATE[code] : undefined;

    if (!toClientError || host.getType() !== 'http') {
      super.catch(exception, host);
      return;
    }

    this.logger.warn(
      `DB가 요청 값을 거절했습니다: code=${code}, message=${exception.message}`,
    );

    super.catch(toClientError(), host);
  }
}
