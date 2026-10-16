import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_ROUTES, type ErrorResponse } from '../src/catalogue.js';

/**
 * The service runs in a child process because the unhandled-rejection route relies on the
 * process-level `unhandledRejection` event, which Vitest also listens to in its own worker.
 */
let child: ChildProcess;
let baseUrl = '';

beforeAll(async () => {
  child = spawn(process.execPath, ['--import', 'tsx', 'runtime-errors/src/server.ts'], {
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const stdout = child.stdout;
  if (!stdout) throw new Error('child has no stdout');
  let output = '';
  while (!output.includes('listening on')) {
    const [chunk] = (await once(stdout, 'data')) as [Buffer];
    output += chunk.toString();
  }
  const match = /listening on (http:\/\/[^\s]+)/.exec(output);
  if (!match?.[1]) throw new Error(`could not read listen address from: ${output}`);
  baseUrl = match[1];
}, 30_000);

afterAll(async () => {
  child.kill('SIGTERM');
  await once(child, 'exit');
});

describe('runtime error service', () => {
  it('answers the health route', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, routes: ERROR_ROUTES.length });
  });

  it('lists every catalogued route', async () => {
    const response = await fetch(`${baseUrl}/errors`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ routes: ERROR_ROUTES });
  });

  for (const route of ERROR_ROUTES) {
    it(`${route.path} responds with HTTP ${route.status} and a stack trace`, async () => {
      const response = await fetch(`${baseUrl}${route.path}`);
      expect(response.status).toBe(route.status);
      const body = (await response.json()) as ErrorResponse;
      expect(body.error.status).toBe(route.status);
      expect(body.error.name).not.toBe('');
      expect(body.error.stack).toContain(body.error.name);
    });
  }

  it('names the classic JavaScript errors', async () => {
    const expected: Record<string, string> = {
      'null-reference': 'TypeError',
      'type-error': 'TypeError',
      'index-out-of-range': 'RangeError',
      'unhandled-rejection': 'UnhandledPromiseRejection',
      'out-of-memory': 'OutOfMemorySimulation',
      'request-timeout': 'RequestTimeoutError',
      'http-429': 'TooManyRequestsError',
    };
    for (const [name, errorName] of Object.entries(expected)) {
      const response = await fetch(`${baseUrl}/errors/${name}`);
      const body = (await response.json()) as ErrorResponse;
      expect(body.error.name, name).toBe(errorName);
    }
  });

  it('stays alive after the unhandled rejection', async () => {
    await fetch(`${baseUrl}/errors/unhandled-rejection`);
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
  });
});
