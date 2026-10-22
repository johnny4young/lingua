import { describe, expect, it } from 'vitest';
import { checkedCandidates, importCandidates, siblingFile } from '../../../src/main/sqlImport';
import { isClientFile } from '../../../src/main/sqlImport/clientFiles';
import { dataGripCandidates } from '../../../src/main/sqlImport/dataGrip';
import { dbeaverCandidates } from '../../../src/main/sqlImport/dbeaver';
import { draftFromJdbcUrl } from '../../../src/main/sqlImport/jdbcUrl';
import { parsePlist } from '../../../src/main/sqlImport/plist';
import { tablePlusCandidates } from '../../../src/main/sqlImport/tablePlus';

const HOME = '/home/me';

const entry = (fields: string) => `<dict><key>ID</key><string>A1</string>${fields}</dict>`;
const plist = (...dicts: string[]) =>
  Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "x">\n<plist version="1.0"><array>${dicts.join('')}</array></plist>`);

// The same connection as below, converted with plutil -convert binary1.
const BINARY = Buffer.from('YnBsaXN0MDChAd8QEQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0fICEiIyRfEBRTZXJ2ZXJQcml2YXRlS2V5TmFtZV1TZXJ2ZXJBZGRyZXNzXERhdGFiYXNlSG9zdFJJRFd0TFNNb2RlXERhdGFiYXNlUG9ydF5Db25uZWN0aW9uTmFtZVdHcm91cElEXERhdGFiYXNlVXNlclpTZXJ2ZXJQb3J0WUZhdm9yaXRlc18QD2lzVXNlUHJpdmF0ZUtleVZEcml2ZXJZaXNPdmVyU1NIXERhdGFiYXNlTmFtZVpTZXJ2ZXJVc2VyWkVudmlyb21lbnRaaWRfZWQyNTUxOV8QE2Jhc3Rpb24uZXhhbXBsZS5jb21eZGIuZXhhbXBsZS5jb21SQTEQBVBZU2hvcCAmIGNvUkcxU2FwcFQyMjIyoR5dU0VMRUNUIHNlY3JldAlaUG9zdGdyZVNRTBABVHNob3BWdWJ1bnR1WnByb2R1Y3Rpb24ACAAKAC8ARgBUAGEAZABsAHkAiACQAJ0AqACyAMQAywDVAOIA7QD4AQMBGQEoASsBLQEuATgBOwE/AUQBRgFUAVUBYAFiAWcBbgAAAAAAAAIBAAAAAAAAACUAAAAAAAAAAAAAAAAAAAF5', 'base64');

describe('TablePlus import', () => {
  const shop = entry(
    [
      '<key>ConnectionName</key><string>Shop &amp; co</string>',
      '<key>Driver</key><string>PostgreSQL</string>',
      '<key>DatabaseHost</key><string>db.example.com</string>',
      '<key>DatabasePort</key><string></string>',
      '<key>DatabaseName</key><string>shop</string>',
      '<key>DatabaseUser</key><string>app</string>',
      '<key>Enviroment</key><string>production</string>',
      '<key>GroupID</key><string>G1</string>',
      '<key>tLSMode</key><integer>5</integer>',
      '<key>isOverSSH</key><integer>1</integer>',
      '<key>ServerAddress</key><string>bastion.example.com</string>',
      '<key>ServerPort</key><string>2222</string>',
      '<key>ServerUser</key><string>ubuntu</string>',
      '<key>isUsePrivateKey</key><true/>',
      '<key>ServerPrivateKeyName</key><string>id_ed25519</string>',
      '<key>Favorites</key><array><string>SELECT secret</string></array>',
    ].join('')
  );
  const groups = Buffer.from('<?xml version="1.0"?><plist version="1.0"><array><dict><key>ID</key><string>G1</string><key>Name</key><string>Ratfel</string></dict></array></plist>');
  const expected = {
    name: 'Shop & co',
    engine: 'postgres',
    host: 'db.example.com',
    port: 5432,
    database: 'shop',
    user: 'app',
    env: 'prod',
    readOnly: true,
    ssl: { mode: 'verify-full' },
    passwordMode: 'keychain',
    ssh: { host: 'bastion.example.com', port: 2222, user: 'ubuntu', auth: 'key', keyPath: '/home/me/.ssh/id_ed25519', secretMode: 'none' },
  };

  it('maps host, SSL index, environment, the tunnel and the group, and never the history keys', () => {
    const result = tablePlusCandidates(plist(shop), groups, HOME);
    expect(result).toEqual({ found: [{ draft: { ...expected, group: 'Ratfel' } }], skipped: 0 });
    expect(JSON.stringify(result)).not.toContain('SELECT secret');
  });

  it('reads the binary form the same way', () => {
    expect(tablePlusCandidates(BINARY, null, HOME)).toEqual({ found: [{ draft: expected }], skipped: 0 });
  });

  it('takes a SQLite file from DatabasePath, ignores its stale host, and leaves out other drivers', () => {
    const sqlite = entry('<key>ConnectionName</key><string>local</string><key>Driver</key><string>SQLite</string><key>DatabaseHost</key><string>127.0.0.1</string><key>DatabasePath</key><string>/data/app.db</string><key>isOverSSH</key><false/>');
    const redis = entry('<key>ConnectionName</key><string>cache</string><key>Driver</key><string>Redis</string><key>DatabaseHost</key><string>c</string>');
    const mysql = entry('<key>ConnectionName</key><string>billing</string><key>Driver</key><string>MySQL</string><key>DatabaseHost</key><string>b</string><key>DatabasePort</key><string>3307</string><key>DatabasePasswordMode</key><integer>2</integer><key>tLSMode</key><integer>1</integer>');
    expect(tablePlusCandidates(plist(sqlite, redis, mysql), null, HOME)).toEqual({
      found: [
        { draft: { name: 'local', engine: 'sqlite', path: '/data/app.db', readOnly: false, passwordMode: 'none' } },
        { draft: { name: 'billing', engine: 'mysql', host: 'b', port: 3307, readOnly: false, ssl: { mode: 'disable' }, passwordMode: 'none' } },
      ],
      skipped: 1,
    });
  });

  it('takes SQL Server and ClickHouse connections with their default ports', () => {
    const mssql = entry('<key>ConnectionName</key><string>erp</string><key>Driver</key><string>SQLServer</string><key>DatabaseHost</key><string>sql.internal</string><key>DatabaseName</key><string>erp</string>');
    const ch = entry('<key>ConnectionName</key><string>events</string><key>Driver</key><string>ClickHouse</string><key>DatabaseHost</key><string>ch.internal</string>');
    expect(tablePlusCandidates(plist(mssql, ch), null, HOME)?.found.map((candidate) => candidate.draft)).toEqual([
      { name: 'erp', engine: 'sqlserver', host: 'sql.internal', port: 1433, database: 'erp', readOnly: false, ssl: { mode: 'prefer' }, passwordMode: 'keychain' },
      { name: 'events', engine: 'clickhouse', host: 'ch.internal', port: 8123, readOnly: false, ssl: { mode: 'prefer' }, passwordMode: 'keychain' },
    ]);
  });

  it('refuses a plist that is not a connection list', () => {
    expect(tablePlusCandidates(Buffer.from('<plist version="1.0"><dict><key>a</key><string>b</string></dict></plist>'), null, HOME)).toBeNull();
    expect(tablePlusCandidates(Buffer.from('not a plist'), null, HOME)).toBeNull();
  });
});

/** A bplist00 whose arrays each hold two references to the one before: 2^depth leaves if shared objects were copied. */
function sharedRefsPlist(depth: number): Buffer {
  const objects: Buffer[] = [Buffer.from([0x51, 0x78])]; // "x"
  for (let i = 1; i <= depth; i++) objects.push(Buffer.from([0xa2, i - 1, i - 1]));
  const offsets: number[] = [];
  let body = Buffer.from('bplist00', 'latin1');
  for (const object of objects) {
    offsets.push(body.length);
    body = Buffer.concat([body, object]);
  }
  const tableAt = body.length;
  const table = Buffer.alloc(offsets.length * 2);
  offsets.forEach((offset, index) => table.writeUInt16BE(offset, index * 2));
  const trailer = Buffer.alloc(32);
  trailer[6] = 2;
  trailer[7] = 1;
  trailer.writeBigUInt64BE(BigInt(objects.length), 8);
  trailer.writeBigUInt64BE(BigInt(depth), 16);
  trailer.writeBigUInt64BE(BigInt(tableAt), 24);
  return Buffer.concat([body, table, trailer]);
}

describe('plist reader', () => {
  it('builds a shared object once instead of copying it at every reference', () => {
    const started = performance.now();
    const parsed = parsePlist(sharedRefsPlist(40)) as unknown[];
    expect(Array.isArray(parsed) && parsed.length).toBe(2);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('stays linear on comment floods and long tags', () => {
    const started = performance.now();
    expect(parsePlist(Buffer.from(`<plist>${'<!--'.repeat(400_000)}`))).toBeUndefined();
    expect(parsePlist(Buffer.from(`<plist><a${' '.repeat(4_000_000)}`))).toBeUndefined();
    const parsed = parsePlist(Buffer.from(`<plist><dict><key>__proto__</key><dict><key>polluted</key><true/></dict></dict></plist>`));
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('refuses a length past the end of the data and stays linear on unclosed tags', () => {
    // The top object becomes a string whose two-byte length (0xff00) runs past the end.
    const bogus = sharedRefsPlist(2);
    bogus.set([0x5f, 0x11, 0xff], 13);
    expect(parsePlist(bogus)).toBeUndefined();
    const started = performance.now();
    expect(parsePlist(Buffer.from(`<plist>${'<a '.repeat(200_000)}`))).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('reads CDATA text as written', () => {
    expect(parsePlist(Buffer.from('<plist><dict><key>a</key><string>x <![CDATA[db>1 &amp;]]> y</string></dict></plist>'))).toEqual({ a: 'x db>1 &amp; y' });
  });

  it('reads entities, numbers and empty elements, and refuses a broken document', () => {
    expect(parsePlist(Buffer.from('<plist><dict><key>a&lt;b</key><integer>-3</integer><key>c</key><array/><key>d</key><string/></dict></plist>'))).toEqual({ 'a<b': -3, c: [], d: '' });
    expect(parsePlist(Buffer.from('<plist><dict><key>a</key></dict></plist>'))).toBeUndefined();
  });
});

describe('DBeaver import', () => {
  const file = JSON.stringify({
    folders: { Prod: {}, 'Prod/EU': {} },
    connections: {
      'postgres-jdbc-1': {
        provider: 'postgresql',
        driver: 'postgres-jdbc',
        name: 'Shop',
        folder: 'Prod/EU',
        'read-only': false,
        configuration: {
          host: 'db.example.com',
          port: '5433',
          database: 'shop',
          type: 'prod',
          user: 'app',
          password: 'never-read',
          handlers: {
            ssh_tunnel: { enabled: true, user: 'ubuntu', properties: { host: 'bastion', port: 22.0, authType: 'PUBLIC_KEY', keyPath: '/home/me/.ssh/id_ed25519' } },
            postgre_ssl: { enabled: true, properties: { sslMode: 'verify-ca', 'ssl.ca.cert': '/certs/ca.pem' } },
          },
        },
      },
      'mysql8-1': { provider: 'mysql', driver: 'mariaDB', name: 'Billing', configuration: { host: 'b', port: '3306', credentials: { user: 'billing', password: 'never-read' } } },
      'sqlite-1': { provider: 'sqlite', driver: 'sqlite_jdbc', name: 'Local', configuration: { database: '/data/app.db', url: 'jdbc:sqlite:/data/app.db' } },
      'pg-2': { provider: 'postgresql', name: 'Tunnel without user', configuration: { host: 'x', handlers: { ssh_tunnel: { enabled: true, properties: { host: 'bastion' } } } } },
      'pg-3': { provider: 'postgresql', name: 'Variable', configuration: { host: '${DB_HOST}' } },
      'oracle-1': { provider: 'oracle', name: 'Ora', configuration: { host: 'o' } },
    },
  });

  it('maps folders, types, users, SSL and the tunnel, and drops every password', () => {
    const result = dbeaverCandidates(file)!;
    expect(JSON.stringify(result)).not.toContain('never-read');
    expect(result.skipped).toBe(3);
    expect(result.found.map((candidate) => candidate.draft)).toEqual([
      {
        name: 'Shop',
        engine: 'postgres',
        host: 'db.example.com',
        port: 5433,
        database: 'shop',
        user: 'app',
        group: 'Prod/EU',
        env: 'prod',
        readOnly: true,
        ssl: { mode: 'verify-ca', caPath: '/certs/ca.pem' },
        passwordMode: 'keychain',
        ssh: { host: 'bastion', port: 22, user: 'ubuntu', auth: 'key', keyPath: '/home/me/.ssh/id_ed25519', secretMode: 'none' },
      },
      { name: 'Billing', engine: 'mysql', host: 'b', port: 3306, user: 'billing', readOnly: false, ssl: { mode: 'prefer' }, passwordMode: 'keychain' },
      { name: 'Local', engine: 'sqlite', path: '/data/app.db', readOnly: false, passwordMode: 'none' },
    ]);
  });

  it('takes SQL Server and ClickHouse providers, with the driver default for SSL', () => {
    const json = JSON.stringify({
      connections: {
        'sqlserver-1': { provider: 'sqlserver', driver: 'microsoft', name: 'ERP', configuration: { host: 'sql.internal', database: 'erp', user: 'erp_app', password: 'never-read' } },
        'clickhouse-1': { provider: 'clickhouse', driver: 'com_clickhouse', name: 'Events', configuration: { url: 'jdbc:clickhouse://ch.internal:8123/events' } },
        'clickhouse-2': { provider: 'clickhouse', name: 'Logs', configuration: { host: 'logs.internal' } },
      },
    });
    const result = dbeaverCandidates(json)!;
    expect(JSON.stringify(result)).not.toContain('never-read');
    expect(result.found.map((candidate) => candidate.draft)).toEqual([
      { name: 'ERP', engine: 'sqlserver', host: 'sql.internal', port: 1433, database: 'erp', user: 'erp_app', readOnly: false, ssl: { mode: 'prefer' }, passwordMode: 'keychain' },
      { name: 'Events', engine: 'clickhouse', host: 'ch.internal', port: 8123, database: 'events', readOnly: false, ssl: { mode: 'prefer' }, passwordMode: 'keychain' },
      // Without a stored port the clients mean ClickHouse's plain HTTP port.
      { name: 'Logs', engine: 'clickhouse', host: 'logs.internal', port: 8123, readOnly: false, ssl: { mode: 'prefer' }, passwordMode: 'keychain' },
    ]);
  });

  it('refuses other JSON', () => {
    expect(dbeaverCandidates('{"a":1}')).toBeNull();
    expect(dbeaverCandidates('nope')).toBeNull();
  });
});

describe('DataGrip import', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="DataSourceManagerImpl" format="xml" multifile-model="true">
    <data-source source="LOCAL" name="shop" group="​dev" uuid="u1">
      <driver-ref>postgresql</driver-ref>
      <jdbc-url>jdbc:postgresql://db.example.com:5432/shop</jdbc-url>
    </data-source>
    <data-source source="LOCAL" name="cov" uuid="u2">
      <driver-ref>sqlite.xerial</driver-ref>
      <jdbc-url>jdbc:sqlite:$PROJECT_DIR$/tests/.coverage</jdbc-url>
    </data-source>
    <data-source source="LOCAL" name="maria" uuid="u3">
      <jdbc-url>jdbc:mariadb://m.example.com:3307/origami?password=never-read</jdbc-url>
    </data-source>
    <data-source source="LOCAL" name="behind bastion" uuid="u4">
      <jdbc-url>jdbc:postgresql://private:5432/x</jdbc-url>
    </data-source>
    <data-source source="LOCAL" name="oracle" uuid="u5">
      <jdbc-url>jdbc:oracle:thin:@o:1521:x</jdbc-url>
    </data-source>
  </component>
</project>`;
  const local = `<project version="4"><component name="dataSourceStorageLocal">
    <data-source name="shop" uuid="u1"><user-name>app</user-name>
      <ssl-config><ca-cert>$USER_HOME$/ca.pem</ca-cert><enabled>true</enabled><mode>VERIFY_FULL</mode></ssl-config></data-source>
    <data-source name="behind bastion" uuid="u4"><ssh-properties><enabled>true</enabled><ssh-config-id>s1</ssh-config-id></ssh-properties></data-source>
  </component></project>`;

  it('merges the local settings, expands project and home paths, and leaves out tunnels and other engines', () => {
    const result = dataGripCandidates(xml, local, { projectDir: '/work/app', home: HOME })!;
    expect(JSON.stringify(result)).not.toContain('never-read');
    expect(result.skipped).toBe(2);
    expect(result.found.map((candidate) => candidate.draft)).toEqual([
      { name: 'shop', engine: 'postgres', host: 'db.example.com', port: 5432, database: 'shop', user: 'app', group: 'dev', ssl: { mode: 'verify-full', caPath: '/home/me/ca.pem' }, readOnly: false, passwordMode: 'keychain' },
      { name: 'cov', engine: 'sqlite', path: '/work/app/tests/.coverage', readOnly: false, passwordMode: 'none' },
      { name: 'maria', engine: 'mysql', host: 'm.example.com', port: 3307, database: 'origami', ssl: { mode: 'prefer' }, readOnly: false, passwordMode: 'keychain' },
    ]);
  });

  it('leaves out a project-relative SQLite file when the project is unknown, and refuses other XML', () => {
    expect(dataGripCandidates(xml, null, { home: HOME })!.found.map((candidate) => candidate.draft.name)).toEqual(['shop', 'maria', 'behind bastion']);
    expect(dataGripCandidates('<project/>', null, { home: HOME })).toBeNull();
  });

  it('stays linear on elements that never close', () => {
    const started = performance.now();
    const valid = '<data-source name="a" uuid="u1"><jdbc-url>jdbc:postgresql://db/a</jdbc-url></data-source>';
    const xml = `<component name="DataSourceManagerImpl">${valid}${'<data-source name="b">'.repeat(100_000)}`;
    const local = `<data-source uuid="u1">${'<user-name>'.repeat(100_000)}</data-source>`;
    expect(dataGripCandidates(xml, local, { home: HOME })?.found.map((candidate) => candidate.draft.name)).toEqual(['a']);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('keeps the first host of a failover URL and refuses other engines', () => {
    expect(draftFromJdbcUrl('jdbc:postgresql://a:5432,b:5432/db')).toMatchObject({ host: 'a', database: 'db' });
    expect(draftFromJdbcUrl('jdbc:oracle:thin:@o:1521:x')).toBeNull();
  });

  it('reads a SQL Server database name from its properties, and nothing else there', () => {
    const draft = draftFromJdbcUrl('jdbc:sqlserver://sql.internal:1433;databaseName=erp;user=app;password=S3cret;encrypt=true');
    expect(draft).toMatchObject({ engine: 'sqlserver', host: 'sql.internal', port: 1433, database: 'erp', name: 'erp', passwordMode: 'keychain' });
    expect(JSON.stringify(draft)).not.toContain('S3cret');
    expect(draft).not.toHaveProperty('user');
  });

  it('never lets a password in a JDBC address form or property reach a draft', () => {
    expect(draftFromJdbcUrl('jdbc:mysql://address=(host=db.example.com)(port=3306)(user=app)(password=S3cret)/shop')).toBeNull();
    expect(draftFromJdbcUrl('jdbc:mysql://h/db;password=S3cret')).toMatchObject({ host: 'h', database: 'db' });
    expect(JSON.stringify(draftFromJdbcUrl('jdbc:mysql://h/db;password=S3cret'))).not.toContain('S3cret');
  });

  it('does not search one long head again for each opener inside it', () => {
    const started = performance.now();
    const xml = `<component name="DataSourceManagerImpl">${'<data-source a'.repeat(300_000)}>`;
    expect(dataGripCandidates(xml, null, { home: HOME })).toEqual({ found: [], skipped: 0 });
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('skips a huge element head without scanning it for attributes', () => {
    const started = performance.now();
    const xml = `<component name="DataSourceManagerImpl"><data-source ${'a'.repeat(4_000_000)}></data-source></component>`;
    expect(dataGripCandidates(xml, null, { home: HOME })).toEqual({ found: [], skipped: 0 });
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe('import dispatch', () => {
  it('names the sibling files and finds the project of an .idea folder', () => {
    expect(siblingFile('tableplus', '/x/Data/Connections.plist')).toBe('/x/Data/ConnectionGroups.plist');
    expect(siblingFile('datagrip', '/work/app/.idea/dataSources.xml')).toBe('/work/app/.idea/dataSources.local.xml');
    expect(siblingFile('dbeaver', '/x/data-sources.json')).toBeNull();
    const xml = Buffer.from('<project><component name="DataSourceManagerImpl"><data-source name="c" uuid="u"><jdbc-url>jdbc:sqlite:$PROJECT_DIR$/a.db</jdbc-url></data-source></component></project>');
    expect(importCandidates('datagrip', xml, { sibling: null, home: HOME, picked: '/work/app/.idea/dataSources.xml' })).toMatchObject({ found: [{ draft: { path: '/work/app/a.db' } }] });
  });

  it('passes only drafts main would accept, at most 500, and counts the rest', () => {
    const many = { connections: Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`c${i}`, { provider: 'postgresql', name: `c${i}`, configuration: { host: `h${i}` } }])) };
    expect(importCandidates('dbeaver', Buffer.from(JSON.stringify(many)), { sibling: null, home: HOME, picked: '/x' })).toMatchObject({ skipped: 100, found: expect.any(Array) });
    const bad = { connections: { a: { provider: 'postgresql', name: 'a', configuration: { host: 'bad host' } } } };
    expect(importCandidates('dbeaver', Buffer.from(JSON.stringify(bad)), { sibling: null, home: HOME, picked: '/x' })).toEqual({ canceled: false, found: [], skipped: 1 });
    expect(checkedCandidates(Array.from({ length: 501 }, (_, i) => ({ draft: { name: `n${i}`, engine: 'sqlite' as const, path: `/d/${i}.db`, readOnly: false, passwordMode: 'none' as const } })), 0).skipped).toBe(1);
  });

  it('says unreadable and unrecognized apart', () => {
    expect(importCandidates('dbeaver', null, { sibling: null, home: HOME, picked: '/x' })).toMatchObject({ error: 'unreadable' });
    expect(importCandidates('dbeaver', Buffer.from('{}'), { sibling: null, home: HOME, picked: '/x' })).toMatchObject({ error: 'unrecognized' });
  });
});

describe('client files in app-data folders', () => {
  it('allows exactly the connection files of each client and nothing beside them', () => {
    const lib = `${HOME}/Library/Application Support`;
    expect(isClientFile('tableplus', `${lib}/com.tinyapp.TablePlus/Data/Connections.plist`, HOME)).toBe(true);
    expect(isClientFile('tableplus', `${lib}/com.tinyapp.TablePlus-setapp/Data/ConnectionGroups.plist`, HOME)).toBe(true);
    expect(isClientFile('tableplus', `${lib}/com.tinyapp.TablePlus/Data/Other.plist`, HOME)).toBe(false);
    expect(isClientFile('tableplus', `${lib}/Lingua/sql-connections.json`, HOME)).toBe(false);
    expect(isClientFile('datagrip', `${lib}/JetBrains/DataGrip2025.2/options/dataSources.xml`, HOME)).toBe(true);
    expect(isClientFile('datagrip', `${lib}/JetBrains/DataGrip2025.2/options/../../x/dataSources.xml`, HOME)).toBe(false);
    expect(isClientFile('dbeaver', `${lib}/com.tinyapp.TablePlus/Data/Connections.plist`, HOME)).toBe(false);
  });
});
