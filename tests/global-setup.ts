import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Next.js 16 refuses to run a second `next dev` against the same project
// directory at all — it detects an existing one via .next/dev/lock and
// either hands back the existing instance or hangs waiting for the lock,
// regardless of --port. Discovered the hard way: two test files each
// spawning their own `next dev` (tests/auth-routes.test.ts and
// tests/affiliate-routes.test.ts) deadlocked the whole suite instead of
// failing fast (docs/ARCHITECTURE.md §20 has the full story).
//
// Fix: ONE server, built and started once here for the entire test run,
// shared by every HTTP-level test file. `next start` (not `next dev`) is
// also just a better fit for tests — no lazy per-route compilation, no
// dev-mode file watching, and no single-instance-per-directory lock.
export const TEST_SERVER_PORT = 3900;
export const TEST_SERVER_URL = `http://localhost:${TEST_SERVER_PORT}`;

const TEST_SERVER_ENV = {
  ...process.env,
  APP_ENV: 'development',
  APP_URL: TEST_SERVER_URL,
  DATABASE_SSL: 'false',
  SESSION_SECRET: 'test-only-session-secret-at-least-32-characters',
  PII_ENCRYPTION_KEY: '2'.repeat(64),
  PAYMENT_PROVIDER: 'mock',
  PAYMENT_MODE: 'test',
  CRON_SECRET: 'test-only-cron-secret',
  EMAIL_PROVIDER: 'console',
  STORAGE_DRIVER: 'local',
};

function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const res = await fetch(url);
        if (res.ok) return resolve();
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) return reject(new Error(`Server at ${url} did not become ready in time`));
      setTimeout(attempt, 300);
    };
    attempt();
  });
}

export default async function setup() {
  await execFileAsync('npx', ['next', 'build'], {
    cwd: process.cwd(),
    env: TEST_SERVER_ENV,
    maxBuffer: 1024 * 1024 * 20,
  });

  const server = spawn('npx', ['next', 'start', '--port', String(TEST_SERVER_PORT)], {
    cwd: process.cwd(),
    env: TEST_SERVER_ENV,
    stdio: 'pipe',
  });

  let stderr = '';
  server.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });

  try {
    await waitForServer(`${TEST_SERVER_URL}/api/health`, 30000);
  } catch (err) {
    server.kill('SIGTERM');
    throw new Error(`${(err as Error).message}\nServer stderr:\n${stderr}`);
  }

  return async () => {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        server.kill('SIGKILL');
        resolve();
      }, 5000);
      server.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      server.kill('SIGTERM');
    });
  };
}
