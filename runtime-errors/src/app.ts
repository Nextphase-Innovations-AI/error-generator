import { setTimeout as sleep } from 'node:timers/promises';
import { STATUS_CODES } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ERROR_ROUTES, HTTP_STATUS_ROUTES, HttpError, ROUTE_PREFIX } from './catalogue.js';
import { installRejectionSink } from './rejection-sink.js';

/** Bounded so the simulation can never exhaust real memory. */
export const OUT_OF_MEMORY_CAP_BYTES = 64 * 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 1_000;

interface Account {
  owner: { name: string };
}

const statusName = (status: number): string =>
  `${(STATUS_CODES[status] ?? 'Http').replace(/[^A-Za-z]/g, '')}Error`;

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (_req, res) => {
    res.json({ ok: true, routes: ERROR_ROUTES.length });
  });

  app.get(ROUTE_PREFIX, (_req, res) => {
    res.json({ routes: ERROR_ROUTES });
  });

  // INTENTIONAL ERROR: a plain exception escaping a synchronous handler.
  app.get(`${ROUTE_PREFIX}/unhandled-exception`, () => {
    throw new Error('Unhandled exception raised on purpose by /errors/unhandled-exception');
  });

  // INTENTIONAL ERROR: property read on null.
  app.get(`${ROUTE_PREFIX}/null-reference`, (_req, res) => {
    const account = null as unknown as Account;
    res.send(account.owner.name);
  });

  // INTENTIONAL ERROR: a number invoked as a function.
  app.get(`${ROUTE_PREFIX}/type-error`, (_req, res) => {
    const notAFunction = 42 as unknown as () => string;
    res.send(notAFunction());
  });

  // INTENTIONAL ERROR: offset 8 is outside a 4-byte buffer (ERR_OUT_OF_RANGE).
  app.get(`${ROUTE_PREFIX}/index-out-of-range`, (_req, res) => {
    const bytes = Buffer.alloc(4);
    res.send(String(bytes.readUInt32BE(8)));
  });

  // INTENTIONAL ERROR: the simulated dependency never answers inside the deadline.
  app.get(`${ROUTE_PREFIX}/request-timeout`, async () => {
    await sleep(REQUEST_TIMEOUT_MS);
    throw new HttpError(
      408,
      'RequestTimeoutError',
      `Upstream dependency did not answer within ${REQUEST_TIMEOUT_MS} ms`,
    );
  });

  // INTENTIONAL ERROR: one route per HTTP status code.
  for (const status of HTTP_STATUS_ROUTES) {
    app.get(`${ROUTE_PREFIX}/http-${status}`, () => {
      throw new HttpError(
        status,
        statusName(status),
        `HTTP ${status} ${STATUS_CODES[status] ?? ''} produced on purpose by /errors/http-${status}`,
      );
    });
  }

  // INTENTIONAL ERROR: a rejection that nothing awaits. The sink observes it on the next tick.
  app.get(`${ROUTE_PREFIX}/unhandled-rejection`, async (_req, _res, next) => {
    const sink = installRejectionSink();
    void Promise.reject(
      new Error('Unhandled promise rejection raised on purpose by /errors/unhandled-rejection'),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    const reason = sink.take();
    const error = reason instanceof Error ? reason : new Error(String(reason));
    error.name = 'UnhandledPromiseRejection';
    next(error);
  });

  // INTENTIONAL ERROR: a capped allocation followed by a failure shaped like heap exhaustion.
  app.get(`${ROUTE_PREFIX}/out-of-memory`, () => {
    const buffer = Buffer.alloc(OUT_OF_MEMORY_CAP_BYTES);
    throw new HttpError(
      500,
      'OutOfMemorySimulation',
      `Simulated heap exhaustion after allocating ${buffer.byteLength} bytes (cap ${OUT_OF_MEMORY_CAP_BYTES})`,
    );
  });

  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const error = err instanceof Error ? err : new Error(String(err));
    const status = error instanceof HttpError ? error.status : 500;
    res.status(status).json({
      error: {
        name: error.name,
        message: error.message,
        status,
        stack: error.stack ?? `${error.name}: ${error.message}`,
      },
    });
  });

  return app;
}
