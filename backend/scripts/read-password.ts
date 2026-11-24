import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

/**
 * Reads a new password for the admin scripts without it ever appearing on
 * the command line, in shell history or in logs.
 *
 * - Interactive terminal: asks twice, without echoing what is typed.
 * - Piped stdin (automation): the first line is the password.
 */
export async function readNewPassword(prompt = 'New password'): Promise<string> {
  if (!process.stdin.isTTY) {
    let input = '';
    for await (const chunk of process.stdin) input += String(chunk);
    return input.split(/\r?\n/)[0] ?? '';
  }
  const first = await askHidden(`${prompt}: `);
  const second = await askHidden(`Repeat ${prompt.toLowerCase()}: `);
  if (first !== second) throw new Error('The passwords do not match.');
  return first;
}

function askHidden(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      if (!muted) process.stderr.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stderr.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}
