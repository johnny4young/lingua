import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  richKindBucket,
  typeIcon,
  payloadHasRichSurface,
  payloadAsJsonString,
} from '@/components/Console/richConsoleFormat';
import { RichValueChart } from '@/components/Console/RichValueChart';
import type { RichOutputPayload } from '#src/shared/richOutput';

const chartMocks = vi.hoisted(() => ({
  canExportChart: false,
  finalize: vi.fn(),
  pushUpsellNotice: vi.fn(),
  toSVG: vi.fn(async () => '<svg><rect /></svg>'),
  toCanvas: vi.fn(async () => document.createElement('canvas')),
  vegaEmbed: vi.fn(),
}));

vi.mock('vega-embed', () => ({
  default: chartMocks.vegaEmbed,
}));

vi.mock('@/hooks/useEntitlement', () => ({
  useEntitlement: () => chartMocks.canExportChart,
}));

vi.mock('@/utils/upsellNotice', () => ({
  pushUpsellNotice: chartMocks.pushUpsellNotice,
}));

describe('richConsoleFormat — RL-044 Slice 1B helpers', () => {
  it('richKindBucket maps every payload kind into the closed-enum bucket', () => {
    const cases: Array<[RichOutputPayload, string]> = [
      [{ kind: 'table', columns: [], rows: [] }, 'table'],
      [{ kind: 'map', size: 0, entries: [] }, 'mapSet'],
      [{ kind: 'set', size: 0, entries: [] }, 'mapSet'],
      [{ kind: 'date', iso: '2024-01-01T00:00:00.000Z' }, 'date'],
      [{ kind: 'promise', state: 'pending' }, 'promise'],
      [{ kind: 'rawText', text: 'hello' }, 'rawText'],
      [{ kind: 'image', src: 'x', mime: 'image/png' }, 'image'],
      [{ kind: 'chart', spec: {} }, 'chart'],
      [
        {
          kind: 'object',
          previewType: 'Object',
          entries: [],
          truncatedCount: undefined,
        } as unknown as RichOutputPayload,
        'object',
      ],
      [
        {
          kind: 'array',
          length: 0,
          entries: [],
        } as unknown as RichOutputPayload,
        'array',
      ],
      [
        { kind: 'primitive', type: 'string', repr: '"hi"' },
        'text',
      ],
      [{ kind: 'function', name: 'foo' }, 'text'],
      // RL-044 Slice 1C fold F — error kind now bucketed distinctly
      // so Python exception payloads survive the telemetry redactor
      // (and dashboards can count error payloads separately).
      [{ kind: 'error', message: 'nope' }, 'error'],
    ];

    for (const [payload, expected] of cases) {
      expect(richKindBucket(payload), `kind=${payload.kind}`).toBe(expected);
    }
  });

  it('typeIcon returns a single non-empty glyph for every payload kind', () => {
    const kinds: RichOutputPayload['kind'][] = [
      'primitive',
      'function',
      'object',
      'array',
      'error',
      'map',
      'set',
      'date',
      'promise',
      'table',
      'rawText',
      'image',
      'chart',
    ];
    for (const kind of kinds) {
      const stub = { kind } as unknown as RichOutputPayload;
      const icon = typeIcon(stub);
      expect(icon.length).toBeGreaterThan(0);
    }
  });

  it('payloadHasRichSurface keeps text-only kinds on the legacy path', () => {
    expect(
      payloadHasRichSurface({ kind: 'primitive', type: 'string', repr: 'x' })
    ).toBe(false);
    expect(payloadHasRichSurface({ kind: 'function', name: 'f' })).toBe(false);
    // RL-044 Slice 2a: stack-less errors stay on the text path; the
    // dispatcher only opens the popover when a structured `stack`
    // is present.
    expect(payloadHasRichSurface({ kind: 'error', message: 'oh' })).toBe(false);
  });

  it('payloadHasRichSurface activates for tables, maps, sets, objects, arrays, dates, promises, rawText, image, html, chart, error+stack', () => {
    expect(payloadHasRichSurface({ kind: 'table', columns: [], rows: [] })).toBe(true);
    expect(payloadHasRichSurface({ kind: 'map', size: 0, entries: [] })).toBe(true);
    expect(payloadHasRichSurface({ kind: 'set', size: 0, entries: [] })).toBe(true);
    expect(payloadHasRichSurface({ kind: 'date', iso: 'x' })).toBe(true);
    expect(payloadHasRichSurface({ kind: 'promise', state: 'pending' })).toBe(true);
    expect(payloadHasRichSurface({ kind: 'rawText', text: 'x' })).toBe(true);
    // RL-044 Slice 2a — image / html have dedicated renderers.
    expect(
      payloadHasRichSurface({ kind: 'image', src: 'data:image/png;base64,a', mime: 'png' })
    ).toBe(true);
    expect(payloadHasRichSurface({ kind: 'html', html: '<p/>' })).toBe(true);
    // RL-044 Slice 2b-β-α — chart now opens the popover (vega-embed UI).
    expect(payloadHasRichSurface({ kind: 'chart', spec: {} })).toBe(true);
    // RL-044 Slice 2a — error WITH stack opens the popover.
    expect(
      payloadHasRichSurface({
        kind: 'error',
        message: 'boom',
        stack: [{ text: 'at x', file: 'x.ts', line: 1 }],
      })
    ).toBe(true);
  });

  it('payloadAsJsonString round-trips a table payload', () => {
    const payload: RichOutputPayload = {
      kind: 'table',
      columns: ['a', 'b'],
      rows: [],
    };
    const json = payloadAsJsonString(payload);
    expect(JSON.parse(json)).toEqual(payload);
  });
});

const chartPayload = {
  kind: 'chart' as const,
  spec: {
    mark: 'bar',
    data: { values: [{ label: 'A', value: 1 }] },
    encoding: {
      x: { field: 'label', type: 'nominal' },
      y: { field: 'value', type: 'quantitative' },
    },
  },
};

describe('RichValueChart — RL-044 Slice 2b-beta', () => {
  beforeEach(() => {
    chartMocks.canExportChart = false;
    chartMocks.finalize.mockReset();
    chartMocks.pushUpsellNotice.mockReset();
    chartMocks.toSVG.mockClear();
    chartMocks.toCanvas.mockClear();
    chartMocks.vegaEmbed.mockReset();
    chartMocks.vegaEmbed.mockResolvedValue({
      finalize: chartMocks.finalize,
      view: {
        toSVG: chartMocks.toSVG,
        toCanvas: chartMocks.toCanvas,
      },
    });
  });

  it('lazy-renders the chart and finalizes Vega on unmount', async () => {
    const { unmount } = render(createElement(RichValueChart, { payload: chartPayload }));

    await waitFor(() => {
      expect(
        screen.getByTestId('console-rich-chart').getAttribute('data-chart-status')
      ).toBe('ready');
    });
    expect(chartMocks.vegaEmbed).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      chartPayload.spec,
      expect.objectContaining({
        actions: false,
        renderer: 'canvas',
      })
    );

    unmount();
    expect(chartMocks.finalize).toHaveBeenCalledTimes(1);
  });

  it('shows a localized failure chip when Vega rejects the spec', async () => {
    chartMocks.vegaEmbed.mockRejectedValueOnce(new Error('vega failed'));

    render(createElement(RichValueChart, { payload: chartPayload }));

    await waitFor(() => {
      expect(
        screen.getByTestId('console-rich-chart').getAttribute('data-chart-status')
      ).toBe('failed');
    });
    expect(screen.getByTestId('console-rich-chart-failed')).toBeTruthy();
  });

  it('routes Free-tier export clicks to the upsell notice', async () => {
    const user = userEvent.setup();
    render(createElement(RichValueChart, { payload: chartPayload }));

    await waitFor(() => {
      expect(
        screen.getByTestId('console-rich-chart').getAttribute('data-chart-status')
      ).toBe('ready');
    });
    await user.click(screen.getByTestId('console-rich-chart-actions'));
    await user.click(screen.getByTestId('console-rich-chart-export-pro'));

    expect(chartMocks.pushUpsellNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        messageKey: 'upsell.freeCeilingReached',
        featureLabel: 'Export chart as PNG / SVG',
      })
    );
    expect(chartMocks.toSVG).not.toHaveBeenCalled();
  });

  it('closes the actions menu with Escape', async () => {
    const user = userEvent.setup();
    render(createElement(RichValueChart, { payload: chartPayload }));

    await waitFor(() => {
      expect(
        screen.getByTestId('console-rich-chart').getAttribute('data-chart-status')
      ).toBe('ready');
    });
    const actions = screen.getByTestId('console-rich-chart-actions');
    await user.click(actions);
    expect(actions.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('console-rich-chart-menu')).toBeTruthy();

    await user.keyboard('{Escape}');

    expect(actions.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('console-rich-chart-menu')).toBeNull();
  });
});
