/**
 * RL-065 privacy guarantees locked as tests:
 *   - redactor drops any property not on the per-event allowlist
 *   - redactor defensively strips keys/values that look like user data
 *   - timestamps are rounded to the minute
 *   - bucketers never emit raw values
 */

import { describe, expect, it } from 'vitest';
import {
  TELEMETRY_EVENTS,
  bucketDurationMs,
  bucketOs,
  createSessionId,
  redactForTelemetry,
  type TelemetryEvent,
} from '../../src/shared/telemetry';

function buildEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    event: 'overlay.opened',
    appVersion: '0.1.0',
    osBucket: 'darwin/23',
    licenseStatus: 'free',
    sessionId: 'abc',
    properties: {},
    timestamp: Date.parse('2026-04-17T10:23:41.999Z'),
    ...overrides,
  };
}

describe('TELEMETRY_EVENTS', () => {
  it('matches the allowed event names and does not grow without review', () => {
    expect([...TELEMETRY_EVENTS].sort()).toEqual([
      'app.launched',
      // RL-094 Slice 1 fold A — Run Capsule export adoption signal.
      // Closed-enum `{ trigger, sizeBucket }`. Sorts at the top of the
      // alphabetical list.
      'capsule.exported',
      // RL-027 Slice 1.5 — debugger session lifecycle. Closed-enum payload
      // per DEBUGGER_ADR §4; the redactor drops anything off the contract.
      'debugger.attached',
      'debugger.detached',
      'debugger.paused',
      'feature.blocked',
      'overlay.opened',
      'runner.executed',
      // RL-020 Slice 5 — bare-expression auto-log toggle.
      'runtime.auto_log_emitted',
      'runtime.auto_log_enabled',
      // RL-019 Slice 1 — per-tab JS/TS runtime mode change.
      // Closed-enum payload `{ mode, language }`; see RUNTIME_MODES_ADR.
      'runtime.auto_run_gated',
      // RL-020 Slice 8 — Compare-with-last-stable adoption signal.
      'runtime.compare_view_toggled',
      // RL-044 Slice 1B — rich console output rendered. Closed-enum
      // payload `{ kind }` from `CONSOLE_RICH_KIND_BUCKETS`.
      'runtime.console_rich_rendered',
      // RL-044 Slice 1B fold F — `console.table()` adoption signal.
      // Closed-enum payload `{ language }`.
      'runtime.console_table_called',
      // RL-044 Slice 2a — Sub-slice F adoption signal. Closed-enum
      // payload `{ language }`. Sorts between `console_table_called`
      // and `history_replay` alphabetically.
      'runtime.error_stack_frame_clicked',
      // RL-024 Slice 1 — File System Access API "Open folder"
      // unsupported signal. Closed-enum payload `{ userAgentBucket }`.
      // Sorts between `error_stack_frame_clicked` and
      // `history_replay` alphabetically.
      'runtime.fs_directory_picker_unsupported',
      // RL-020 Slice 4 — execution-history replay dispatched.
      // Closed-enum payload `{ language, status, surface }`.
      'runtime.history_replay',
      // RL-020 Slice 3 — magic-comment results emitted on a clean
      // run. Closed-enum payload `{ language, hasArrow, hasWatch }`.
      'runtime.magic_comment_emitted',
      'runtime.mode_changed',
      // RL-019 Slice 2 — desktop Node child-spawn adoption. Closed-
      // enum payload `{ language, status }`. Sorts between
      // `mode_changed` and `stdin_used` alphabetically.
      'runtime.node_runner_used',
      // RL-044 Slice 1C fold B — Python (Pyodide) console payload
      // adoption. Closed-enum payload `{ kind }` from
      // `CONSOLE_RICH_KIND_BUCKETS`. Sorts between `node_runner_used`
      // and `stdin_used` alphabetically.
      'runtime.python_console_payload_emitted',
      // RL-044 Slice 2b-β-β-α fold E — Python rich-media adoption.
      // Closed-enum payload `{ kind }` from `RICH_MEDIA_REJECTED_KINDS`.
      // Sorts between `python_console_payload_emitted` and
      // `rich_media_payload_rejected` alphabetically.
      'runtime.python_rich_media_used',
      // RL-044 Slice 2a — rich-media payload rejection signal. Closed
      // enum `{ kind, reason }`. Sorts between `python_rich_media_used`
      // and `ruby_runner_dispatched`.
      'runtime.rich_media_payload_rejected',
      // RL-042 Slice 6 — Ruby runtime dispatch + Settings preference.
      // Both closed-enum; sorts after `rich_media_payload_rejected`.
      'runtime.ruby_runner_dispatched',
      'runtime.ruby_runtime_preference_changed',
      // RL-020 Slice 6 — bare-stdin adoption signal. Closed-enum
      // payload `{ language }`. Sorts between `mode_changed` and
      // `workflow_mode_changed` alphabetically.
      'runtime.stdin_used',
      // RL-020 Slice 7 — per-language timeout preset change.
      // Closed-enum payload `{ language, preset }`.
      'runtime.timeout_preset_changed',
      // RL-020 Slice 9 — variable inspector adoption. Closed-enum
      // payload `{ language, variableCount }`.
      'runtime.variable_inspector_opened',
      // RL-093 Slice 3 fold F — floating ↔ bottom surface adoption.
      // Closed-enum payload `{ surface }`.
      'runtime.variable_inspector_surface_changed',
      // RL-020 Slice 2 — per-tab workflow mode change. Closed-enum
      // payload `{ language, from, to, trigger }`.
      'runtime.workflow_mode_changed',
      'update.checked',
      // RL-069 Slice 3 — Developer Utilities productivity layer.
      'utility.clipboard.applied',
      'utility.favorite.pinned',
      'utility.history.cleared',
    ]);
  });
});

describe('redactForTelemetry', () => {
  it('keeps only allow-listed properties and reports what was dropped', () => {
    const { event, droppedKeys } = redactForTelemetry(
      buildEvent({
        event: 'runner.executed',
        properties: {
          language: 'python',
          status: 'ok',
          durationBucketMs: 250,
          source: 'print("secret")',
          filePath: '/Users/me/Documents/secret.py',
        },
      })
    );

    expect(event.properties).toEqual({
      language: 'python',
      status: 'ok',
      durationBucketMs: 250,
    });
    expect(droppedKeys).toContain('source');
    expect(droppedKeys).toContain('filePath');
  });

  it('strips non-primitive values even if the key happens to be allow-listed', () => {
    const { event, droppedKeys } = redactForTelemetry(
      buildEvent({
        event: 'overlay.opened',
        properties: {
          overlayId: { nested: 'oops' } as unknown as string,
        },
      })
    );

    expect(event.properties).toEqual({});
    expect(droppedKeys).toContain('overlayId');
  });

  it('strips suspicious free-form values even when the property key is allow-listed', () => {
    const { event, droppedKeys } = redactForTelemetry(
      buildEvent({
        event: 'runner.executed',
        properties: {
          language: 'console.log(secret)',
          status: 'ok',
          durationBucketMs: 250,
        },
      })
    );

    expect(event.properties).toEqual({
      status: 'ok',
      durationBucketMs: 250,
    });
    expect(droppedKeys).toContain('language');
  });

  it('strips invalid enum and bucket values from allow-listed keys', () => {
    const { event, droppedKeys } = redactForTelemetry(
      buildEvent({
        event: 'update.checked',
        properties: {
          status: 'https://updates.linguacode.dev/releases/private',
        },
      })
    );

    expect(event.properties).toEqual({});
    expect(droppedKeys).toContain('status');
  });

  it('rounds timestamps to the minute to reduce fingerprintability', () => {
    const { event } = redactForTelemetry(buildEvent());
    expect(event.timestamp).toBe(Date.parse('2026-04-17T10:23:00.000Z'));
  });

  it('never accepts code-bearing keys even if someone adds them to the allow list by accident', () => {
    // Simulate a careless expansion: a property named `sourceCode` snuck
    // onto an event. The key-substring check in the redactor (DENY_SUBSTRINGS)
    // must still strip it so we don't rely on allow-list discipline alone.
    const event = {
      ...buildEvent({
        event: 'runner.executed',
        properties: { sourceCode: 'console.log(1)' } as unknown as Record<
          string,
          string | number | boolean
        >,
      }),
    };
    const { event: redacted, droppedKeys } = redactForTelemetry(event);
    expect(redacted.properties).toEqual({});
    expect(droppedKeys).toContain('sourceCode');
  });
});

describe('bucketOs + bucketDurationMs', () => {
  it('buckets OS versions into platform/major', () => {
    expect(bucketOs('darwin', '23.4.0')).toBe('darwin/23');
    expect(bucketOs('linux', '6.7-arch')).toBe('linux/6');
    expect(bucketOs('win32', '10.0.22631')).toBe('win32/10');
    expect(bucketOs('darwin', 'weird')).toBe('darwin/unknown');
    expect(bucketOs('', '1')).toBe('unknown');
  });

  it('buckets durations into coarse ranges so raw run times never leak', () => {
    expect(bucketDurationMs(1)).toBe(50);
    expect(bucketDurationMs(120)).toBe(250);
    expect(bucketDurationMs(900)).toBe(1000);
    expect(bucketDurationMs(4_500)).toBe(5000);
    expect(bucketDurationMs(29_000)).toBe(30_000);
    expect(bucketDurationMs(120_000)).toBe(60_000);
    expect(bucketDurationMs(Number.NaN)).toBe(0);
  });
});

describe('runtime.mode_changed value validator (RL-019 Slice 1 + Slice 3)', () => {
  it('accepts the closed RuntimeMode enum verbatim — worker / node / browser-preview', () => {
    for (const mode of ['worker', 'node', 'browser-preview']) {
      const { event } = redactForTelemetry(
        buildEvent({
          event: 'runtime.mode_changed',
          properties: { mode, language: 'javascript' },
        })
      );
      expect(event.properties.mode, `mode ${mode} should survive the redactor`).toBe(mode);
      expect(event.properties.language).toBe('javascript');
    }
  });

  it('drops unknown modes (defensive — Slice 4 would have to land the validator branch too)', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.mode_changed',
        properties: { mode: 'unknown-future-mode', language: 'typescript' },
      })
    );
    expect(event.properties).not.toHaveProperty('mode');
    // language survives because typescript is a safe token.
    expect(event.properties.language).toBe('typescript');
  });

  it('drops a non-safe-token language value (defense in depth)', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.mode_changed',
        properties: { mode: 'browser-preview', language: '../../etc/passwd' },
      })
    );
    expect(event.properties.mode).toBe('browser-preview');
    expect(event.properties).not.toHaveProperty('language');
  });
});

describe('runtime.auto_run_gated value validator (RL-020 Slice 1)', () => {
  it('accepts the closed `incomplete` reason + a safe-token language', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.auto_run_gated',
        properties: { language: 'javascript', reason: 'incomplete' },
      })
    );
    expect(event.properties).toEqual({
      language: 'javascript',
      reason: 'incomplete',
    });
  });

  it('also accepts typescript as the language', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.auto_run_gated',
        properties: { language: 'typescript', reason: 'incomplete' },
      })
    );
    expect(event.properties.language).toBe('typescript');
    expect(event.properties.reason).toBe('incomplete');
  });

  it('drops an unknown gate reason (defensive — future heuristic expansions amend the allowlist)', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.auto_run_gated',
        properties: { language: 'javascript', reason: 'mysterious' },
      })
    );
    expect(event.properties.language).toBe('javascript');
    expect(event.properties).not.toHaveProperty('reason');
  });

  it('drops a non-safe-token language (defense in depth)', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.auto_run_gated',
        properties: { language: '../etc/passwd', reason: 'incomplete' },
      })
    );
    expect(event.properties.reason).toBe('incomplete');
    expect(event.properties).not.toHaveProperty('language');
  });
});

describe('runtime.workflow_mode_changed value validator (RL-020 Slice 2)', () => {
  it('accepts the closed enum payload for an explicit toolbar gesture', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.workflow_mode_changed',
        properties: {
          language: 'javascript',
          from: 'scratchpad',
          to: 'debug',
          trigger: 'toolbar',
        },
      })
    );
    expect(event.properties).toEqual({
      language: 'javascript',
      from: 'scratchpad',
      to: 'debug',
      trigger: 'toolbar',
    });
  });

  it('accepts the language-change auto-correction trigger', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.workflow_mode_changed',
        properties: {
          language: 'rust',
          from: 'debug',
          to: 'run',
          trigger: 'language_change',
        },
      })
    );
    expect(event.properties.trigger).toBe('language_change');
  });

  it('drops an unknown trigger value', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.workflow_mode_changed',
        properties: {
          language: 'javascript',
          from: 'scratchpad',
          to: 'run',
          trigger: 'spyware',
        },
      })
    );
    expect(event.properties.from).toBe('scratchpad');
    expect(event.properties.to).toBe('run');
    expect(event.properties).not.toHaveProperty('trigger');
  });

  it('drops an unknown workflow mode', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.workflow_mode_changed',
        properties: {
          language: 'javascript',
          from: 'scratchpad',
          to: 'cyberspace',
          trigger: 'toolbar',
        },
      })
    );
    expect(event.properties.from).toBe('scratchpad');
    expect(event.properties).not.toHaveProperty('to');
  });

  it('drops a non-safe-token language', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.workflow_mode_changed',
        properties: {
          language: '../etc/passwd',
          from: 'scratchpad',
          to: 'run',
          trigger: 'toolbar',
        },
      })
    );
    expect(event.properties).not.toHaveProperty('language');
    expect(event.properties.from).toBe('scratchpad');
    expect(event.properties.to).toBe('run');
  });
});

describe('runtime.magic_comment_emitted value validator (RL-020 Slice 3)', () => {
  it('accepts the closed enum payload (language + boolean flags)', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.magic_comment_emitted',
        properties: { language: 'javascript', hasArrow: true, hasWatch: true },
      })
    );
    expect(event.properties).toEqual({
      language: 'javascript',
      hasArrow: true,
      hasWatch: true,
    });
  });

  it('accepts python with arrow-only / watch-only / neither shapes', () => {
    for (const flags of [
      { hasArrow: true, hasWatch: false },
      { hasArrow: false, hasWatch: true },
      { hasArrow: false, hasWatch: false },
    ]) {
      const { event } = redactForTelemetry(
        buildEvent({
          event: 'runtime.magic_comment_emitted',
          properties: { language: 'python', ...flags },
        })
      );
      expect(event.properties).toEqual({ language: 'python', ...flags });
    }
  });

  it('drops non-boolean values for hasArrow / hasWatch', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.magic_comment_emitted',
        properties: {
          language: 'typescript',
          hasArrow: 1 as unknown as boolean,
          hasWatch: 'yes' as unknown as boolean,
        },
      })
    );
    expect(event.properties.language).toBe('typescript');
    expect(event.properties).not.toHaveProperty('hasArrow');
    expect(event.properties).not.toHaveProperty('hasWatch');
  });

  it('drops a non-safe-token language', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.magic_comment_emitted',
        properties: { language: '../etc/passwd', hasArrow: true, hasWatch: false },
      })
    );
    expect(event.properties).not.toHaveProperty('language');
    expect(event.properties.hasArrow).toBe(true);
    expect(event.properties.hasWatch).toBe(false);
  });
});

describe('runtime.history_replay value validator (RL-020 Slice 4)', () => {
  it('accepts the closed enum payload from the tab pill', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.history_replay',
        properties: { language: 'javascript', status: 'ok', surface: 'tab_pill' },
      })
    );
    expect(event.properties).toEqual({
      language: 'javascript',
      status: 'ok',
      surface: 'tab_pill',
    });
  });

  it('accepts the palette and popover surfaces', () => {
    for (const surface of ['palette', 'popover'] as const) {
      const { event } = redactForTelemetry(
        buildEvent({
          event: 'runtime.history_replay',
          properties: { language: 'python', status: 'error', surface },
        })
      );
      expect(event.properties.surface).toBe(surface);
    }
  });

  it('drops an unknown surface value', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.history_replay',
        properties: { language: 'javascript', status: 'ok', surface: 'sneaky_widget' },
      })
    );
    expect(event.properties.language).toBe('javascript');
    expect(event.properties.status).toBe('ok');
    expect(event.properties).not.toHaveProperty('surface');
  });

  it('drops an unknown status value', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.history_replay',
        properties: { language: 'javascript', status: 'half', surface: 'tab_pill' },
      })
    );
    expect(event.properties).not.toHaveProperty('status');
    expect(event.properties.surface).toBe('tab_pill');
  });

  it('drops a non-safe-token language', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.history_replay',
        properties: { language: '../etc/passwd', status: 'ok', surface: 'tab_pill' },
      })
    );
    expect(event.properties).not.toHaveProperty('language');
    expect(event.properties.status).toBe('ok');
    expect(event.properties.surface).toBe('tab_pill');
  });
});

describe('runtime.auto_log_enabled value validator (RL-020 Slice 5)', () => {
  it('accepts the closed enum payload', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.auto_log_enabled',
        properties: { language: 'javascript', enabled: true },
      })
    );
    expect(event.properties).toEqual({ language: 'javascript', enabled: true });
  });
  it('drops a non-boolean enabled value', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.auto_log_enabled',
        properties: { language: 'typescript', enabled: 'yes' as unknown as boolean },
      })
    );
    expect(event.properties.language).toBe('typescript');
    expect(event.properties).not.toHaveProperty('enabled');
  });
  it('drops a non-safe-token language', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.auto_log_enabled',
        properties: { language: '../etc', enabled: true },
      })
    );
    expect(event.properties).not.toHaveProperty('language');
    expect(event.properties.enabled).toBe(true);
  });
});

describe('runtime.auto_log_emitted value validator (RL-020 Slice 5 fold A)', () => {
  it('accepts each closed-enum count bucket', () => {
    for (const countBucket of ['1', '2-5', '6-20', '20-plus'] as const) {
      const { event } = redactForTelemetry(
        buildEvent({
          event: 'runtime.auto_log_emitted',
          properties: { language: 'javascript', countBucket },
        })
      );
      expect(event.properties.countBucket).toBe(countBucket);
    }
  });
  it('drops an unknown count bucket', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.auto_log_emitted',
        properties: { language: 'javascript', countBucket: '0' },
      })
    );
    expect(event.properties.language).toBe('javascript');
    expect(event.properties).not.toHaveProperty('countBucket');
  });
  it('drops a non-safe-token language while keeping the bucket', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.auto_log_emitted',
        properties: { language: '../etc', countBucket: '2-5' },
      })
    );
    expect(event.properties).not.toHaveProperty('language');
    expect(event.properties.countBucket).toBe('2-5');
  });
});

describe('runtime.stdin_used value validator (RL-020 Slice 6)', () => {
  it('accepts the closed enum payload', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.stdin_used',
        properties: { language: 'python' },
      })
    );
    expect(event.properties).toEqual({ language: 'python' });
  });
  it('drops unknown property keys', () => {
    const { event, droppedKeys } = redactForTelemetry(
      buildEvent({
        event: 'runtime.stdin_used',
        properties: { language: 'javascript', linesRead: 7 },
      })
    );
    expect(event.properties).toEqual({ language: 'javascript' });
    expect(droppedKeys).toContain('linesRead');
  });
  it('drops a non-safe-token language', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.stdin_used',
        properties: { language: '../etc/passwd' },
      })
    );
    expect(event.properties).not.toHaveProperty('language');
  });
});

describe('runtime.compare_view_toggled value validator (RL-020 Slice 8)', () => {
  it('accepts the closed enum payload', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.compare_view_toggled',
        properties: { language: 'javascript', enabled: true },
      })
    );
    expect(event.properties).toEqual({
      language: 'javascript',
      enabled: true,
    });
  });
  it('drops non-boolean enabled', () => {
    const { event, droppedKeys } = redactForTelemetry(
      buildEvent({
        event: 'runtime.compare_view_toggled',
        properties: { language: 'python', enabled: 'yes' },
      })
    );
    expect(event.properties).not.toHaveProperty('enabled');
    expect(droppedKeys).toContain('enabled');
  });
  it('drops unknown property keys', () => {
    const { event, droppedKeys } = redactForTelemetry(
      buildEvent({
        event: 'runtime.compare_view_toggled',
        properties: {
          language: 'typescript',
          enabled: false,
          extra: 'unused',
        },
      })
    );
    expect(event.properties).toEqual({
      language: 'typescript',
      enabled: false,
    });
    expect(droppedKeys).toContain('extra');
  });
});

describe('runtime.timeout_preset_changed value validator (RL-020 Slice 7)', () => {
  it('accepts the closed enum payload', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.timeout_preset_changed',
        properties: { language: 'python', preset: 'long' },
      })
    );
    expect(event.properties).toEqual({ language: 'python', preset: 'long' });
  });
  it('drops an unknown preset token', () => {
    const { event, droppedKeys } = redactForTelemetry(
      buildEvent({
        event: 'runtime.timeout_preset_changed',
        properties: { language: 'javascript', preset: 'forever' },
      })
    );
    expect(event.properties).not.toHaveProperty('preset');
    expect(droppedKeys).toContain('preset');
  });
  it('drops unknown property keys', () => {
    const { event, droppedKeys } = redactForTelemetry(
      buildEvent({
        event: 'runtime.timeout_preset_changed',
        properties: { language: 'typescript', preset: 'quick', when: 42 },
      })
    );
    expect(event.properties).toEqual({
      language: 'typescript',
      preset: 'quick',
    });
    expect(droppedKeys).toContain('when');
  });
});

describe('runtime.node_runner_used value validator (RL-019 Slice 2)', () => {
  it('accepts the closed-enum payload', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.node_runner_used',
        properties: { language: 'javascript', status: 'success' },
      })
    );
    expect(event.properties).toEqual({
      language: 'javascript',
      status: 'success',
    });
  });
  it('accepts every closed-enum status bucket', () => {
    for (const status of ['success', 'error', 'timeout', 'stopped', 'missing-binary']) {
      const { event } = redactForTelemetry(
        buildEvent({
          event: 'runtime.node_runner_used',
          properties: { language: 'typescript', status },
        })
      );
      expect(event.properties).toEqual({ language: 'typescript', status });
    }
  });
  it('drops an unknown status bucket', () => {
    const { event, droppedKeys } = redactForTelemetry(
      buildEvent({
        event: 'runtime.node_runner_used',
        properties: { language: 'javascript', status: 'killed-by-signal' },
      })
    );
    expect(event.properties).not.toHaveProperty('status');
    expect(droppedKeys).toContain('status');
  });
  it('drops unknown property keys', () => {
    const { event, droppedKeys } = redactForTelemetry(
      buildEvent({
        event: 'runtime.node_runner_used',
        properties: {
          language: 'javascript',
          status: 'success',
          exitCode: 0,
        },
      })
    );
    expect(event.properties).toEqual({
      language: 'javascript',
      status: 'success',
    });
    expect(droppedKeys).toContain('exitCode');
  });
});

describe('runtime.variable_inspector_opened value validator (RL-020 Slice 9)', () => {
  it('accepts the closed-enum payload', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runtime.variable_inspector_opened',
        properties: { language: 'javascript', variableCount: '6-20' },
      })
    );
    expect(event.properties).toEqual({
      language: 'javascript',
      variableCount: '6-20',
    });
  });
  it('drops an unknown bucket', () => {
    const { event, droppedKeys } = redactForTelemetry(
      buildEvent({
        event: 'runtime.variable_inspector_opened',
        properties: { language: 'python', variableCount: '500' },
      })
    );
    expect(event.properties).not.toHaveProperty('variableCount');
    expect(droppedKeys).toContain('variableCount');
  });
  it('drops unknown property keys', () => {
    const { event, droppedKeys } = redactForTelemetry(
      buildEvent({
        event: 'runtime.variable_inspector_opened',
        properties: {
          language: 'typescript',
          variableCount: '0',
          source: 'palette',
        },
      })
    );
    expect(event.properties).toEqual({
      language: 'typescript',
      variableCount: '0',
    });
    expect(droppedKeys).toContain('source');
  });
});

describe('capsule.exported value validator (RL-094 Slice 1 fold A)', () => {
  it('accepts every closed-enum trigger', () => {
    for (const trigger of ['settings-export', 'palette-export'] as const) {
      const { event } = redactForTelemetry(
        buildEvent({
          event: 'capsule.exported',
          properties: { trigger, sizeBucket: '<10kb' },
        })
      );
      expect(event.properties).toEqual({ trigger, sizeBucket: '<10kb' });
    }
  });
  it('accepts every closed-enum sizeBucket', () => {
    for (const sizeBucket of ['<10kb', '<100kb', '<1mb', '<4mb', '>=4mb'] as const) {
      const { event } = redactForTelemetry(
        buildEvent({
          event: 'capsule.exported',
          properties: { trigger: 'settings-export', sizeBucket },
        })
      );
      expect(event.properties).toEqual({ trigger: 'settings-export', sizeBucket });
    }
  });
  it('drops unknown trigger', () => {
    const { event, droppedKeys } = redactForTelemetry(
      buildEvent({
        event: 'capsule.exported',
        properties: { trigger: 'remote-upload', sizeBucket: '<10kb' },
      })
    );
    expect(event.properties).not.toHaveProperty('trigger');
    expect(droppedKeys).toContain('trigger');
  });
  it('drops unknown sizeBucket', () => {
    const { event, droppedKeys } = redactForTelemetry(
      buildEvent({
        event: 'capsule.exported',
        properties: { trigger: 'settings-export', sizeBucket: 'gigantic' },
      })
    );
    expect(event.properties).not.toHaveProperty('sizeBucket');
    expect(droppedKeys).toContain('sizeBucket');
  });
});

describe('runtime.python_rich_media_used value validator (RL-044 Slice 2b-β-β-α fold E)', () => {
  it('accepts the closed-enum kind (chart / image / html)', () => {
    for (const kind of ['chart', 'image', 'html'] as const) {
      const { event } = redactForTelemetry(
        buildEvent({
          event: 'runtime.python_rich_media_used',
          properties: { kind },
        })
      );
      expect(event.properties).toEqual({ kind });
    }
  });
  it('drops an unknown kind', () => {
    const { event, droppedKeys } = redactForTelemetry(
      buildEvent({
        event: 'runtime.python_rich_media_used',
        properties: { kind: 'svg' },
      })
    );
    expect(event.properties).not.toHaveProperty('kind');
    expect(droppedKeys).toContain('kind');
  });
  it('drops unknown property keys', () => {
    const { event, droppedKeys } = redactForTelemetry(
      buildEvent({
        event: 'runtime.python_rich_media_used',
        properties: { kind: 'chart', src: 'data:image/png;base64,aaa' },
      })
    );
    expect(event.properties).toEqual({ kind: 'chart' });
    expect(droppedKeys).toContain('src');
  });
});

describe('runner.executed status enum (RL-020 Slice 7)', () => {
  it('accepts the four-state widened enum', () => {
    for (const status of ['ok', 'error', 'timeout', 'stopped'] as const) {
      const { event } = redactForTelemetry(
        buildEvent({
          event: 'runner.executed',
          properties: {
            language: 'javascript',
            status,
            durationBucketMs: 250,
          },
        })
      );
      expect(event.properties.status).toBe(status);
    }
  });
  it('drops anything outside the closed set', () => {
    const { event } = redactForTelemetry(
      buildEvent({
        event: 'runner.executed',
        properties: {
          language: 'javascript',
          status: 'partial',
          durationBucketMs: 250,
        },
      })
    );
    expect(event.properties).not.toHaveProperty('status');
  });
});

describe('createSessionId', () => {
  it('produces a 32-hex-char launch-scoped id', () => {
    const id = createSessionId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('produces unique ids across multiple calls so we never collide across launches', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      ids.add(createSessionId());
    }
    expect(ids.size).toBe(200);
  });
});
