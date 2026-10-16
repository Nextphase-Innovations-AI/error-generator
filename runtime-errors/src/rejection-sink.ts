/**
 * Node 22 terminates the process on an unhandled rejection. The sink keeps the service alive while
 * still letting the route demonstrate a rejection that nothing awaited or caught.
 */
export interface RejectionSink {
  take(): unknown;
}

let sink: RejectionSink | undefined;

export function installRejectionSink(): RejectionSink {
  if (sink) return sink;
  const pending: unknown[] = [];
  process.on('unhandledRejection', (reason) => {
    pending.push(reason);
  });
  sink = {
    take: () => pending.shift(),
  };
  return sink;
}
