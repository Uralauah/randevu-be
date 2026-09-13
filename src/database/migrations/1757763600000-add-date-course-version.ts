import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 데이트 코스 동시 편집 충돌 감지(낙관적 락)에 쓰는 버전 컬럼을 추가한다.
 *
 * - 기존 코스는 모두 1부터 시작한다(DEFAULT 1로 채워진다).
 * - 로컬 DB는 synchronize로 이미 컬럼이 생겼을 수 있어 IF NOT EXISTS를 쓴다.
 * - 아직 테이블이 없는 빈 DB(최초 synchronize 전)에서는 건너뛰고 synchronize가 만들게 둔다.
 */
export class AddDateCourseVersion1757763600000 implements MigrationInterface {
  name = 'AddDateCourseVersion1757763600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('date_courses'))) {
      return;
    }

    await queryRunner.query(
      'ALTER TABLE "date_courses" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "date_courses" DROP COLUMN IF EXISTS "version"',
    );
  }
}
