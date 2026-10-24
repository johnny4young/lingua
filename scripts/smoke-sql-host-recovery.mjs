#!/usr/bin/env node
/** Bounded synthetic Electron fixture. No normal app/profile, services, clipboard or keyring APIs. */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
let executable;
if (args.length) {
  if (args.length !== 2 || args[0] !== '--electron-executable') throw new Error('Usage: node scripts/smoke-sql-host-recovery.mjs [--electron-executable /official/project/Electron]');
  executable = path.resolve(args[1]);
} else executable = require('electron');
if (!['Electron', 'electron', 'electron.exe'].includes(path.basename(executable)) || !existsSync(executable)) throw new Error('Use the project\'s official Electron test binary, never an installed Lingua app');
executable = realpathSync(executable);
const host = path.join(repo, '.vite/build/sqlHost.js');
if (!existsSync(host)) throw new Error('Build the desktop bundles in this disposable checkout first: node scripts/build-desktop-bundles.mjs');
const root = mkdtempSync(path.join(os.tmpdir(), 'lingua-sql-host-'));
for (const folder of ['home', 'cache', 'config', 'data', 'tmp', 'user-data', 'session-data', 'app-data', 'logs', 'crashes']) mkdirSync(path.join(root, folder));
const db = new DatabaseSync(path.join(root, 'synthetic.sqlite'));
db.exec('CREATE TABLE fixture(id INTEGER PRIMARY KEY); INSERT INTO fixture VALUES(1)'); db.close();
writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'lingua-sql-host-fixture', version: '0.0.0', private: true, main: 'main.cjs' }));
await build({ entryPoints: [path.join(repo, 'tests/__fixtures__/sqlHostRecoveryMain.ts')], outfile: path.join(root, 'main.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'warning' });
const pin = JSON.parse(readFileSync(path.join(repo, 'node_modules/electron/package.json'), 'utf8')).version;
const env = { PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter), HOME: path.join(root, 'home'), TMPDIR: path.join(root, 'tmp'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'data'), LANG: 'en_US.UTF-8', TZ: 'UTC', LINGUA_SQL_FIXTURE_ROOT: root, LINGUA_SQL_FIXTURE_HOST: host, LINGUA_SQL_FIXTURE_ELECTRON: pin };
console.log(`Synthetic fixture: ${root}`);
const child = spawn(executable, [root, '--use-mock-keychain', '--password-store=basic', '--disable-background-networking'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '', timedOut = false;
child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
let forceTimer;
const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); forceTimer = setTimeout(() => child.kill('SIGKILL'), 2000); }, 30000);
let code;
try { code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); }
finally { clearTimeout(timer); clearTimeout(forceTimer); }
writeFileSync(path.join(root, 'stdout.log'), stdout); writeFileSync(path.join(root, 'stderr.log'), stderr);
const report = existsSync(path.join(root, 'report.json')) ? JSON.parse(readFileSync(path.join(root, 'report.json'), 'utf8')) : { status: 'no-report' };
console.log(JSON.stringify({ ...report, artifactDirectory: root, timedOut, exitCode: code }, null, 2));
// Preserve the owned fixture/profile/report for inspection; never delete a caller directory.
if (timedOut || code !== 0 || report.status !== 'passed' || report.unchanged !== true) process.exitCode = 1;
