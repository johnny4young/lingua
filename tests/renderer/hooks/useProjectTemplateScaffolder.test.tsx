// SPDX-License-Identifier: MIT
/**
 * implementation — Hook tests for `useProjectTemplateScaffolder`.
 *
 * The hook coordinates IPC, project-store hand-off, editor open,
 * and telemetry in a precise order. The tests lock the order so a
 * future refactor cannot regress the contract silently.
 *
 * Coverage:
 *   - happy path: picker → readdir (empty) → mkdir+write → openProject
 *     → openFile → telemetry, in that order, with telemetry firing
 *     LAST.
 *   - mkdir runs BEFORE write for the same file (the IPC fs:write
 *     handler does not auto-create parents; regression would leave
 *     half-scaffolded directories).
 *   - non-empty directory → revoke holding rootId, return
 *     `non-empty-dir`, never call mkdir/write/openProject.
 *   - empty-dir guard ignores `.DS_Store`, `.localized`, `Thumbs.db`.
 *   - picker canceled → `canceled` with no side effects.
 *   - web build → `web-unavailable` and the picker is never called.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useProjectTemplateScaffolder,
  type ScaffoldResult,
} from '../../../src/renderer/hooks/useProjectTemplateScaffolder';
import { expressApiHelloTemplate } from '../../../src/renderer/data/projectTemplates/expressApiHello';
import { PROJECT_TEMPLATES } from '../../../src/renderer/data/projectTemplates';
import { projectTemplateDirname } from '../../../src/shared/projectTemplate';

const trackTemplateProjectAppliedMock = vi.fn();
vi.mock(
  '../../../src/renderer/hooks/projectTemplateTelemetry',
  () => ({
    trackTemplateProjectApplied: (...args: unknown[]) => {
      trackTemplateProjectAppliedMock(...args);
    },
  })
);

const openProjectMock = vi.fn();
const openFileMock = vi.fn();
const getStateMock = vi.fn();

vi.mock('../../../src/renderer/stores/projectStore', () => ({
  useProjectStore: Object.assign(
    (selector: (state: { openProject: typeof openProjectMock }) => unknown) =>
      selector({ openProject: openProjectMock }),
    {
      getState: () => getStateMock(),
    }
  ),
}));

vi.mock('../../../src/renderer/stores/editorStore', () => ({
  useEditorStore: (
    selector: (state: { openFile: typeof openFileMock }) => unknown
  ) => selector({ openFile: openFileMock }),
}));

interface MockFs {
  selectDirectory: ReturnType<typeof vi.fn>;
  readdir: ReturnType<typeof vi.fn>;
  mkdir: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  revokeRoot: ReturnType<typeof vi.fn>;
  revealInFinder: ReturnType<typeof vi.fn>;
}

function installLingua(fs: MockFs, platform: 'desktop' | 'web' = 'desktop') {
  (window as unknown as { lingua: unknown }).lingua = {
    platform,
    fs,
  };
}

const originalLingua = window.lingua;

afterEach(() => {
  (window as unknown as { lingua: unknown }).lingua = originalLingua;
  vi.clearAllMocks();
});

function makeFsMock(): MockFs {
  return {
    selectDirectory: vi.fn(),
    readdir: vi.fn(),
    mkdir: vi.fn(),
    write: vi.fn(),
    revokeRoot: vi.fn().mockResolvedValue(undefined),
    revealInFinder: vi.fn(),
  };
}

describe('useProjectTemplateScaffolder', () => {
  beforeEach(() => {
    openProjectMock.mockResolvedValue(undefined);
    openFileMock.mockResolvedValue(undefined);
    getStateMock.mockReturnValue({
      currentProject: { rootId: 'cp-root-id', rootPath: '/tmp/dest' },
    });
  });

  it('happy path: picker → readdir → mkdir+write → openProject → openFile → telemetry (in order)', async () => {
    const fs = makeFsMock();
    fs.selectDirectory.mockResolvedValue({
      canceled: false,
      rootId: 'hold-id',
      rootPath: '/tmp/dest',
    });
    fs.readdir.mockResolvedValue([]); // empty dir
    fs.mkdir.mockResolvedValue(undefined);
    fs.write.mockResolvedValue(true);
    installLingua(fs);

    const calls: string[] = [];
    fs.selectDirectory.mockImplementation(async () => {
      calls.push('select');
      return { canceled: false, rootId: 'hold-id', rootPath: '/tmp/dest' };
    });
    fs.readdir.mockImplementation(async () => {
      calls.push('readdir');
      return [];
    });
    fs.mkdir.mockImplementation(async () => {
      calls.push('mkdir');
    });
    fs.write.mockImplementation(async () => {
      calls.push('write');
      return true;
    });
    fs.revokeRoot.mockImplementation(async () => {
      calls.push('revoke');
    });
    openProjectMock.mockImplementation(async () => {
      calls.push('openProject');
    });
    openFileMock.mockImplementation(async () => {
      calls.push('openFile');
    });
    trackTemplateProjectAppliedMock.mockImplementation(() => {
      calls.push('telemetry');
    });

    const { result } = renderHook(() => useProjectTemplateScaffolder());

    let scaffoldResult: ScaffoldResult | null = null;
    await act(async () => {
      scaffoldResult = await result.current.scaffold(expressApiHelloTemplate);
    });

    expect(scaffoldResult?.kind).toBe('success');
    // Telemetry MUST be the last side effect; that's the regression
    // implementation note's once-per-success guarantee depends on.
    expect(calls[calls.length - 1]).toBe('telemetry');
    // openFile MUST happen after openProject so the freshly-minted
    // currentProject rootId is the one in flight.
    const openProjectIdx = calls.indexOf('openProject');
    const openFileIdx = calls.indexOf('openFile');
    expect(openProjectIdx).toBeGreaterThan(-1);
    expect(openFileIdx).toBeGreaterThan(openProjectIdx);
    // mkdir for any nested file MUST happen before its write.
    const firstMkdir = calls.indexOf('mkdir');
    const firstWrite = calls.indexOf('write');
    expect(firstMkdir).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(firstMkdir);
    // The holding capability is revoked before openProject mints a
    // fresh one (otherwise we'd leak tokens).
    const revokeIdx = calls.indexOf('revoke');
    expect(revokeIdx).toBeGreaterThan(-1);
    expect(revokeIdx).toBeLessThan(openProjectIdx);

    expect(trackTemplateProjectAppliedMock).toHaveBeenCalledWith({
      templateId: 'express-api-hello',
      language: 'javascript',
    });
  });

  it('non-empty directory bails with `non-empty-dir` and never writes', async () => {
    const fs = makeFsMock();
    fs.selectDirectory.mockResolvedValue({
      canceled: false,
      rootId: 'hold-id',
      rootPath: '/tmp/dest',
    });
    fs.readdir.mockResolvedValue([
      { name: 'README.md' },
      { name: 'src' },
    ]);
    installLingua(fs);

    const { result } = renderHook(() => useProjectTemplateScaffolder());
    let outcome: ScaffoldResult | null = null;
    await act(async () => {
      outcome = await result.current.scaffold(expressApiHelloTemplate);
    });

    expect(outcome).toEqual({ kind: 'non-empty-dir', meaningfulCount: 2 });
    expect(fs.mkdir).not.toHaveBeenCalled();
    expect(fs.write).not.toHaveBeenCalled();
    expect(openProjectMock).not.toHaveBeenCalled();
    expect(fs.revokeRoot).toHaveBeenCalledWith('hold-id');
    expect(trackTemplateProjectAppliedMock).not.toHaveBeenCalled();
  });

  it('treats OS metadata files as empty (.DS_Store, .localized, Thumbs.db, desktop.ini)', async () => {
    const fs = makeFsMock();
    fs.selectDirectory.mockResolvedValue({
      canceled: false,
      rootId: 'hold-id',
      rootPath: '/tmp/dest',
    });
    fs.readdir.mockResolvedValue([
      { name: '.DS_Store' },
      { name: '.localized' },
      { name: 'Thumbs.db' },
      { name: 'desktop.ini' },
    ]);
    fs.mkdir.mockResolvedValue(undefined);
    fs.write.mockResolvedValue(true);
    installLingua(fs);

    const { result } = renderHook(() => useProjectTemplateScaffolder());
    let outcome: ScaffoldResult | null = null;
    await act(async () => {
      outcome = await result.current.scaffold(expressApiHelloTemplate);
    });

    expect(outcome?.kind).toBe('success');
    expect(fs.write).toHaveBeenCalled();
  });

  it('returns `canceled` when the picker is dismissed', async () => {
    const fs = makeFsMock();
    fs.selectDirectory.mockResolvedValue({ canceled: true });
    installLingua(fs);

    const { result } = renderHook(() => useProjectTemplateScaffolder());
    let outcome: ScaffoldResult | null = null;
    await act(async () => {
      outcome = await result.current.scaffold(expressApiHelloTemplate);
    });

    expect(outcome).toEqual({ kind: 'canceled' });
    expect(fs.readdir).not.toHaveBeenCalled();
    expect(fs.write).not.toHaveBeenCalled();
  });

  it('returns `web-unavailable` on the web build and skips the picker', async () => {
    const fs = makeFsMock();
    installLingua(fs, 'web');

    const { result } = renderHook(() => useProjectTemplateScaffolder());
    let outcome: ScaffoldResult | null = null;
    await act(async () => {
      outcome = await result.current.scaffold(expressApiHelloTemplate);
    });

    expect(outcome).toEqual({ kind: 'web-unavailable' });
    expect(fs.selectDirectory).not.toHaveBeenCalled();
  });
});

// Reviewer-pass addition (lingua-review on implementation) — the
// caller asked for an explicit "walk every template through the
// scaffold flow" assertion so we don't trust the structural
// existence test alone. For each of the 5 templates we install a
// fresh fs mock + reset all spies, fire scaffold(template), and
// assert that:
//
//   - `fs.write` was called for EVERY relPath in the template
//   - `fs.mkdir` was called for EVERY distinct parent directory
//     (parents collected via the same `projectTemplateDirname`
//     helper the production hook uses, so the test guards drift
//     in the helper too)
//   - the entry file was opened with the language pack id from
//     the template (not the runtime-derived value)
//   - telemetry fired with the canonical `{ templateId, language }`
//     payload — exact match per template
//
// This is the closest a vitest can get to the "real" desktop
// scaffold flow without booting Electron.
describe('useProjectTemplateScaffolder — walk every curated template', () => {
  it.each(PROJECT_TEMPLATES.map((tpl) => [tpl.id, tpl] as const))(
    '%s scaffolds every declared file, mkdir every parent, opens the entry file, fires telemetry once',
    async (_id, template) => {
      openProjectMock.mockResolvedValue(undefined);
      openFileMock.mockResolvedValue(undefined);
      getStateMock.mockReturnValue({
        currentProject: { rootId: `cp-${template.id}`, rootPath: '/tmp/dest' },
      });

      const fs = makeFsMock();
      fs.selectDirectory.mockResolvedValue({
        canceled: false,
        rootId: `hold-${template.id}`,
        rootPath: '/tmp/dest',
      });
      fs.readdir.mockResolvedValue([]);
      fs.mkdir.mockResolvedValue(undefined);
      fs.write.mockResolvedValue(true);
      installLingua(fs);

      const { result } = renderHook(() => useProjectTemplateScaffolder());
      let outcome: ScaffoldResult | null = null;
      await act(async () => {
        outcome = await result.current.scaffold(template);
      });

      expect(outcome).toMatchObject({
        kind: 'success',
        rootId: `cp-${template.id}`,
        rootPath: '/tmp/dest',
        entryFile: template.entryFile,
      });

      // Every relPath in the template hit fs.write with its exact
      // content. No more, no less.
      const writeArgs = fs.write.mock.calls.map(
        (call) => [call[1], call[2]] as [string, string]
      );
      expect(writeArgs).toHaveLength(template.files.length);
      for (const file of template.files) {
        expect(writeArgs).toContainEqual([file.relPath, file.content]);
      }

      // Every distinct parent directory got an mkdir call. Templates
      // whose files all live at the root produce zero mkdir calls
      // (correct — `projectTemplateDirname` returns '' for top-level
      // files and the hook skips them).
      const expectedParents = new Set<string>();
      for (const file of template.files) {
        const parent = projectTemplateDirname(file.relPath);
        if (parent) expectedParents.add(parent);
      }
      const mkdirParents = new Set(
        fs.mkdir.mock.calls.map((call) => call[1] as string)
      );
      expect(mkdirParents).toEqual(expectedParents);

      // Entry file opens with the template's language pack id — the
      // closed-enum value the redactor allowlist trusts.
      expect(openFileMock).toHaveBeenCalledWith(
        `cp-${template.id}`,
        template.entryFile,
        expect.any(String),
        template.language,
        expect.stringContaining(template.entryFile)
      );

      // Telemetry fires exactly once with the canonical payload.
      expect(trackTemplateProjectAppliedMock).toHaveBeenCalledTimes(1);
      expect(trackTemplateProjectAppliedMock).toHaveBeenCalledWith({
        templateId: template.id,
        language: template.language,
      });
    }
  );
});
