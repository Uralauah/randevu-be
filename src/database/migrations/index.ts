import { AddDateCourseVersion1757763600000 } from './1757763600000-add-date-course-version';

/**
 * 앱 시작 시 적용할 마이그레이션 목록(오래된 순).
 *
 * glob 경로 대신 클래스를 직접 나열한다. 빌드 결과(dist)에는 선언 파일(.d.ts)도 함께
 * 생기는데, `*.{js,ts}` 같은 glob은 이것까지 잡아 실행하려다 실패한다.
 *
 * 새 마이그레이션을 추가할 때
 *   - 파일 이름과 클래스 이름 끝에 생성 시각(ms)을 붙인다.
 *   - 로컬 DB는 synchronize로 이미 바뀌어 있을 수 있으므로 IF NOT EXISTS처럼
 *     여러 번 실행해도 같은 결과가 나오게 작성한다.
 */
export const MIGRATIONS: (new () => unknown)[] = [
  AddDateCourseVersion1757763600000,
];
