import { Writable } from 'node:stream';
import { createLogger } from '../../src/config/logger.js';

/** Pino logger that records parsed JSON lines for audit assertions. */
export function capturingLogger() {
  const records: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      const text = chunk.toString().trim();
      if (text) {
        for (const line of text.split('\n')) {
          if (line) records.push(JSON.parse(line) as Record<string, unknown>);
        }
      }
      cb();
    },
  });
  return {
    logger: createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'info' }, stream),
    records,
  };
}

export function auditRecords(records: Record<string, unknown>[]) {
  return records.filter((row) => row.audit === true);
}
