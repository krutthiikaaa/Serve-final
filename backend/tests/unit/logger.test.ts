import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/config/logger.js';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { lines, stream };
}

describe('logger redaction', () => {
  it('redacts authorization headers, tokens and secrets', () => {
    const { lines, stream } = capture();
    const logger = createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'info' }, stream);

    logger.info(
      {
        req: { headers: { authorization: 'Bearer eyJhbGciOi.secret', cookie: 'sid=abc' } },
        body: { password: 'hunter2', idToken: 'tok-123', signature: 'sig-456' },
      },
      'request',
    );

    const output = lines.join('');
    expect(output).not.toContain('eyJhbGciOi');
    expect(output).not.toContain('sid=abc');
    expect(output).not.toContain('hunter2');
    expect(output).not.toContain('tok-123');
    expect(output).not.toContain('sig-456');
    expect(output).toContain('[REDACTED]');
  });
});
