/**
 * npm run dev:student — runs the Flutter student app against the local stack.
 *
 *   npm run dev:student                     Chrome on http://localhost:5555
 *   npm run dev:student -- -d emulator-5554 any other device (flutter devices)
 *
 * The app's development defaults point at the backend (:5001) and the Firebase
 * Auth Emulator (:9099); extra arguments are passed to `flutter run`.
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

const flutter = process.env.FLUTTER_BIN ?? 'flutter';
const shell = process.platform === 'win32';
const app = path.resolve(import.meta.dirname, '../apps/student');

if (spawnSync(flutter, ['--version'], { shell, stdio: 'ignore' }).status !== 0) {
  console.error(
    'Flutter was not found. Install Flutter 3.47 or newer (https://docs.flutter.dev/get-started/install)\n' +
      'and make sure `flutter` is on your PATH, or set FLUTTER_BIN to its full path.',
  );
  process.exit(1);
}

const extra = process.argv.slice(2);
const picksDevice = extra.some((arg) => arg === '-d' || arg.startsWith('--device-id'));
const args = ['run', ...(picksDevice ? [] : ['-d', 'chrome', '--web-port', '5555']), ...extra];

console.log(`> cd apps/student && flutter ${args.join(' ')}`);
const child = spawn(flutter, args, { cwd: app, shell, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
