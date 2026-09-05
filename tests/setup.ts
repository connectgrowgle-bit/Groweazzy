import 'dotenv/config';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL must point at a real, migrated Postgres test database to run tests. ' +
      'See README.md — this suite intentionally does not mock the database.'
  );
}

if (!/test/.test(process.env.DATABASE_URL)) {
  // Cheap guard against accidentally pointing the test suite at a real
  // dev/staging/production database — tests insert and delete real rows.
  throw new Error(
    `DATABASE_URL ("${process.env.DATABASE_URL}") does not look like a test database ` +
      '(expected "test" somewhere in the connection string). Refusing to run.'
  );
}
