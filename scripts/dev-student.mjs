/**
 * npm run dev:student — runs the Flutter student app against the local stack.
 *
 *   npm run dev:student                          Chrome on http://localhost:5555
 *   npm run dev:student -- -d emulator-5554      Android emulator (flutter devices)
 *   npm run dev:student -- -d <phone-id> --lan   a real phone on the same Wi-Fi
 *
 * The app's development defaults point at the backend (:5001). `--lan` points a
 * real phone at this computer's network address instead. Sign-in is Google via
 * the backend (Better Auth); Google only redirects to the URL registered on the
 * OAuth client (BETTER_AUTH_URL), so a phone needs a backend URL it can reach
 * that is registered there (e.g. an https tunnel). Other arguments are passed
 * to `flutter run`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
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

function lanAddress() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const a of addresses ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return null;
}

let extra = process.argv.slice(2);
if (extra.includes('--lan')) {
  const ip = lanAddress();
  if (!ip) {
    console.error("Could not find this computer's network address. Is it connected to Wi-Fi?");
    process.exit(1);
  }
  console.log(`Using ${ip} for the backend (phone and computer must share a network).`);
  extra = [...extra.filter((arg) => arg !== '--lan'), `--dart-define=API_URL=http://${ip}:5001`];
}
const picksDevice = extra.some((arg) => arg === '-d' || arg.startsWith('--device-id'));
const args = ['run', ...(picksDevice ? [] : ['-d', 'chrome', '--web-port', '5555']), ...extra];

console.log(`> cd apps/student && flutter ${args.join(' ')}`);
const child = spawn(flutter, args, { cwd: app, shell, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
