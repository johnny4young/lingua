/**
 * DataGrip's (and other JetBrains IDEs') dataSources.xml, with the user name
 * and SSL settings from dataSources.local.xml beside it. Passwords live in the
 * keychain or KeePass, never in these files; one embedded in a URL is dropped.
 */

import type { SqlConnectionDraft, SqlSslMode } from '../../shared/sqlConnections';
import type { SqlDbImportCandidate } from '../../shared/sqlDb';
import { MAX_IMPORT_CONNECTIONS } from './limits';
import { draftFromJdbcUrl } from './jdbcUrl';

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const unescape = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, code: string) =>
    code.startsWith('#x') || code.startsWith('#X') ? String.fromCodePoint(parseInt(code.slice(2), 16)) : code.startsWith('#') ? String.fromCodePoint(Number(code.slice(1))) : ENTITIES[code.toLowerCase()]!
  );

/** Trims whitespace and the zero-width marks some group names start with. */
const clean = (text: string | undefined) => (text === undefined ? undefined : unescape(text).replace(/[​-‍﻿]/g, '').trim() || undefined);

interface Source {
  attrs: Record<string, string>;
  body: string;
}

/** The text between `<tag>` and `</tag>`, found with indexOf so a file without the closing tag stays linear. */
function between(text: string, tag: string): string | undefined {
  const start = text.indexOf(`<${tag}>`);
  if (start < 0) return undefined;
  const end = text.indexOf(`</${tag}>`, start);
  return end < 0 ? undefined : text.slice(start + tag.length + 2, end);
}

const OPEN = '<data-source';
const MAX_HEAD = 8 * 1024;

function dataSources(xml: string): Source[] {
  const sources: Source[] = [];
  for (let from = 0; ; ) {
    const start = xml.indexOf(OPEN, from);
    const headEnd = start < 0 ? -1 : xml.indexOf('>', start);
    if (headEnd < 0) return sources;
    const head = xml.slice(start + OPEN.length, headEnd);
    // <data-sources> and the like are other elements; a real head is a few attributes long.
    if ((head && !/^[\s/]/.test(head)) || head.length > MAX_HEAD) {
      from = start + OPEN.length;
      continue;
    }
    const close = head.endsWith('/') ? headEnd : xml.indexOf('</data-source>', headEnd);
    if (close < 0) return sources;
    sources.push({
      attrs: Object.fromEntries([...head.matchAll(/([\w-]+)="([^"]*)"/g)].map((attr) => [attr[1]!, attr[2]!])),
      body: close === headEnd ? '' : xml.slice(headEnd + 1, close),
    });
    from = close + 1;
  }
}

const child = (body: string, tag: string) => clean(between(body, tag));

const SSL: Readonly<Record<string, SqlSslMode>> = { REQUIRE: 'require', VERIFY_CA: 'verify-ca', VERIFY_FULL: 'verify-full', PREFER: 'prefer', DISABLE: 'disable' };

/** The connections in dataSources.xml; null when the text is not one. */
export function dataGripCandidates(xml: string, local: string | null, vars: { projectDir?: string; home: string }): { found: SqlDbImportCandidate[]; skipped: number } | null {
  if (!/<component\s+name="DataSourceManagerImpl"/.test(xml)) return null;
  const locals = new Map(dataSources(local ?? '').map((source) => [source.attrs.uuid ?? '', source.body]));
  const expand = (value: string) =>
    value
      .replace(/\$(?:PROJECT_DIR|ProjectFileDir)\$/g, vars.projectDir ?? '$PROJECT_DIR$')
      .replace(/\$USER_HOME\$/g, vars.home);
  const found: SqlDbImportCandidate[] = [];
  let skipped = 0;
  for (const source of dataSources(xml)) {
    const extra = locals.get(source.attrs.uuid ?? '') ?? '';
    const url = child(source.body, 'jdbc-url');
    const fromUrl = url ? draftFromJdbcUrl(expand(url)) : null;
    // A tunnel's settings live in the IDE's own sshConfigs.xml; without them the connection would skip its bastion.
    const tunnelled = between(extra, 'ssh-properties')?.includes('<enabled>true</enabled>') === true;
    const name = clean(source.attrs.name)?.slice(0, 80);
    if (!fromUrl || tunnelled || !name || found.length >= MAX_IMPORT_CONNECTIONS) {
      skipped += 1;
      continue;
    }
    const group = clean(source.attrs.group)?.slice(0, 60);
    let draft: SqlConnectionDraft = { ...fromUrl, name, ...(group ? { group } : {}) };
    if (draft.engine !== 'sqlite') {
      const user = child(extra, 'user-name');
      const ssl = between(extra, 'ssl-config');
      const enabled = ssl ? child(ssl, 'enabled') === 'true' : false;
      const mode = enabled ? (SSL[child(ssl!, 'mode') ?? ''] ?? 'require') : 'prefer';
      const file = (tag: string) => {
        const value = ssl && enabled ? child(ssl, tag) : undefined;
        return value ? expand(value) : undefined;
      };
      draft = {
        ...draft,
        ...(user ? { user } : {}),
        ssl: { mode, ...(file('ca-cert') ? { caPath: file('ca-cert') } : {}), ...(file('client-cert') ? { certPath: file('client-cert') } : {}), ...(file('client-key') ? { keyPath: file('client-key') } : {}) },
      };
    }
    found.push({ draft });
  }
  return { found, skipped };
}
