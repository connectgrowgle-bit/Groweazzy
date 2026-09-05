import { spawn, execFile } from 'node:child_process';
import { createConnection } from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { SHARED_TEST_ENV } from './test-env-constants';

const execFileAsync = promisify(execFile);

// The local `next` binary, invoked directly — NOT via `npx next start`.
// `npx` spawns next as its own child process and does not reliably forward
// signals to it, so `server.kill('SIGTERM')` on the npx process left the
// actual `next-server` running as an orphan after every test run (visible
// as a lingering process still answering on TEST_SERVER_PORT well after
// the suite exited). Spawning the binary directly means the process this
// file holds a handle to IS the server, so SIGTERM/SIGKILL actually reach it.
const NEXT_BIN = path.join(process.cwd(), 'node_modules', '.bin', 'next');

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

// SESSION_SECRET/PII_ENCRYPTION_KEY/CRON_SECRET come from SHARED_TEST_ENV
// and MUST match tests/setup.ts's values exactly — see that constant's own
// comment for why (a cookie signed by this server and verified by a direct
// library call in the vitest process needs the same key on both sides).
const TEST_SERVER_ENV = {
  ...process.env,
  APP_ENV: 'development',
  APP_URL: TEST_SERVER_URL,
  DATABASE_SSL: 'false',
  ...SHARED_TEST_ENV,
  PAYMENT_PROVIDER: 'mock',
  PAYMENT_MODE: 'test',
  EMAIL_PROVIDER: 'console',
  STORAGE_DRIVER: 'local',
};

// Just polling /api/health until it responds is not enough to prove THIS
// run's server is what's answering — a previous run's server that failed
// to shut down (its own vitest process killed before the globalSetup
// teardown ran, say) leaves a zombie bound to the same port, and the next
// run's health check would happily pass against ITS stale build/env,
// producing failures that look like a real bug (e.g. a signature
// mismatch from an old SESSION_SECRET) with no indication the server
// being hit was never the one this run just built. Fail fast and loud
// instead: refuse to start if the port is already taken.
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: 'localhost' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

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
  if (await isPortInUse(TEST_SERVER_PORT)) {
    throw new Error(
      `Port ${TEST_SERVER_PORT} is already in use — a previous test run's server likely ` +
        "didn't shut down cleanly. Find and kill it (e.g. `lsof -i :3900` or check for a " +
        'lingering `next start` process) before running the suite again. Reusing whatever is ' +
        "already listening there would silently test against a stale build/env, not this run's."
    );
  }

  await execFileAsync(NEXT_BIN, ['build'], {
    cwd: process.cwd(),
    env: TEST_SERVER_ENV,
    maxBuffer: 1024 * 1024 * 20,
  });

  const server = spawn(NEXT_BIN, ['start', '--port', String(TEST_SERVER_PORT)], {
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
