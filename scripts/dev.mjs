// Runs the local API and Vite together: `npm run dev`
import { spawn } from 'node:child_process';
const procs = [
  spawn(process.execPath, ['scripts/dev-api.mjs'], { stdio: 'inherit' }),
  spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite'], { stdio: 'inherit', shell: process.platform === 'win32' }),
];
const stop = () => { procs.forEach((p) => p.kill()); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => { if (code) stop(); }));
