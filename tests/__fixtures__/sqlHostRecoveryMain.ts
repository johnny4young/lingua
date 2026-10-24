/** Synthetic Electron utility-process fixture; never imports the normal app bootstrap. */
import { app, utilityProcess } from 'electron';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSqlHostSupervisor } from '../../src/main/sqlHostSupervisor';
const root = process.env.LINGUA_SQL_FIXTURE_ROOT!;
const reportFile = path.join(root, 'report.json');
const file = path.join(root, 'synthetic.sqlite');
const digest = () => createHash('sha256').update(readFileSync(file)).digest('hex');
const report: Record<string, unknown> = { versions: process.versions, cases: [], events: [], beforeSha: digest() };
for (const [key, folder] of [['userData', 'user-data'], ['sessionData', 'session-data'], ['appData', 'app-data'], ['logs', 'logs'], ['crashDumps', 'crashes']] as const) app.setPath(key, path.join(root, folder));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  app.dock?.hide();
  const events = report.events as Array<Record<string, unknown>>;
  const cases = report.cases as Array<Record<string, unknown>>;
  const host = createSqlHostSupervisor(() => {
    const child = utilityProcess.fork(process.env.LINGUA_SQL_FIXTURE_HOST!, [], { stdio: 'ignore', env: process.env as Record<string, string> });
    const generation = events.length;
    child.on('spawn', () => events.push({ kind: 'spawn', generation, pid: child.pid }));
    child.on('exit', code => events.push({ kind: 'exit', generation, code }));
    return child;
  });
  const config = { connectionId: 'synthetic', engine: 'sqlite' as const, path: file, readOnly: true };
  const execute = (runId: string, sql: string) => host.request<{ rows: Array<Record<string, unknown>> }>({ type: 'execute', config, runId, sql, readWrite: false, window: { maxRows: 10, maxBytes: 1024 } }, 5000);
  try {
    if (process.versions.electron !== process.env.LINGUA_SQL_FIXTURE_ELECTRON) throw new Error('Electron differs from the project pin');
    await execute('warm', 'SELECT 1 AS answer');
    for (let i = 0; i < 3; i++) {
      const previous = execute(`previous-${i}`, 'WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<100000000) SELECT sum(x) FROM n')
        .then(value => ({ value }), error => ({ error: String(error) }));
      await new Promise(resolve => setTimeout(resolve, 50));
      host.restart();
      // Queue before the retired child's asynchronous exit event is delivered.
      const replacement = execute(`replacement-${i}`, 'SELECT 42 AS answer');
      const previousResult = await previous;
      const result = await replacement;
      if (String(result.rows[0]?.answer) !== '42') throw new Error('Replacement result was lost');
      cases.push({ iteration: i + 1, previous: previousResult, replacement: result.rows });
    }
    report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.error = String(error); }
  finally {
    host.dispose(); report.afterSha = digest(); report.unchanged = report.beforeSha === report.afterSha;
    writeFileSync(reportFile, JSON.stringify(report, null, 2)); app.exit(report.status === 'passed' && report.unchanged ? 0 : 1);
  }
}).catch(error => { report.status = 'startup-error'; report.error = String(error); writeFileSync(reportFile, JSON.stringify(report, null, 2)); app.exit(1); });
