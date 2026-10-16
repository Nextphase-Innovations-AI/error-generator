// INTENTIONAL (Category 2, code-scanning alert). This module is never imported by the runtime
// service, so nothing here can execute. CodeQL analyses every file regardless of reachability
// and reports the `exec` call below as js/command-line-injection (CWE-78).
import { exec } from 'node:child_process';
import express, { type Request, type Response } from 'express';

export const unreachableApp = express();

export function listDirectoryUnsafely(req: Request, res: Response): void {
  const value = req.query['dir'];
  const directory = typeof value === 'string' ? value : '.';
  // User input flows straight into a shell command string.
  exec(`ls -la ${directory}`, (error, stdout, stderr) => {
    if (error) {
      res.status(500).send(stderr);
      return;
    }
    res.type('text/plain').send(stdout);
  });
}

// Registering the handler makes `req` a remote flow source for CodeQL. `unreachableApp` never
// listens on a port and is never mounted.
unreachableApp.get('/codeql/command-injection', listDirectoryUnsafely);
