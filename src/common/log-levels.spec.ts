import { resolveLogLevels } from './log-levels';

describe('resolveLogLevels', () => {
  it('운영에서는 기본으로 debug·verbose를 남기지 않는다', () => {
    expect(resolveLogLevels(undefined, 'production')).toEqual([
      'log',
      'warn',
      'error',
      'fatal',
    ]);
  });

  it('운영이 아니면 기본으로 모든 레벨을 남긴다', () => {
    expect(resolveLogLevels(undefined, undefined)).toEqual([
      'verbose',
      'debug',
      'log',
      'warn',
      'error',
      'fatal',
    ]);
  });

  it('LOG_LEVEL로 최소 레벨을 정할 수 있다', () => {
    expect(resolveLogLevels(' DEBUG ', 'production')).toEqual([
      'debug',
      'log',
      'warn',
      'error',
      'fatal',
    ]);
    expect(resolveLogLevels('warn', undefined)).toEqual([
      'warn',
      'error',
      'fatal',
    ]);
  });

  it('알 수 없는 값이면 기본값을 쓴다', () => {
    expect(resolveLogLevels('loud', 'production')).toEqual([
      'log',
      'warn',
      'error',
      'fatal',
    ]);
  });
});
