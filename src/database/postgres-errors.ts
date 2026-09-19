import { QueryFailedError } from 'typeorm';

/** PostgreSQL unique_violation */
const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(error: unknown) {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string } | undefined)?.code ===
      UNIQUE_VIOLATION
  );
}
