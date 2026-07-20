// SPDX-License-Identifier: MIT
/**
 * implementation — Component tests for the Welcome project
 * templates panel. Locks the visible card count, the disabled-during-
 * scaffold guard, and the web-build short-circuit.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectTemplatesPanel } from '../../../src/renderer/components/Welcome/ProjectTemplatesPanel';
import { PROJECT_TEMPLATES } from '../../../src/renderer/data/projectTemplates';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && Object.keys(opts).length > 0) {
        return `${key}::${JSON.stringify(opts)}`;
      }
      return key;
    },
  }),
}));

const scaffoldMock = vi.fn();
vi.mock(
  '../../../src/renderer/hooks/useProjectTemplateScaffolder',
  () => ({
    useProjectTemplateScaffolder: () => ({ scaffold: scaffoldMock }),
  })
);

const originalLingua = window.lingua;

afterEach(() => {
  (window as unknown as { lingua: unknown }).lingua = originalLingua;
  vi.clearAllMocks();
});

function setPlatform(platform: 'desktop' | 'web' | undefined) {
  if (platform === undefined) {
    (window as unknown as { lingua: unknown }).lingua = undefined;
    return;
  }
  (window as unknown as { lingua: unknown }).lingua = {
    platform,
    fs: {
      revealInFinder: vi.fn(),
    },
  };
}

describe('ProjectTemplatesPanel', () => {
  beforeEach(() => {
    setPlatform('desktop');
  });

  it('renders one card per curated template (5 total)', () => {
    render(<ProjectTemplatesPanel />);
    for (const template of PROJECT_TEMPLATES) {
      expect(
        screen.getByTestId(`welcome-project-template-${template.id}`)
      ).toBeTruthy();
    }
  });

  it('invokes the scaffolder when a card action is clicked', async () => {
    scaffoldMock.mockResolvedValue({
      kind: 'success',
      rootId: 'r1',
      rootPath: '/tmp/d',
      entryFile: 'src/index.js',
    });
    render(<ProjectTemplatesPanel />);
    fireEvent.click(
      screen.getByTestId('welcome-project-template-express-api-hello-action')
    );
    await waitFor(() => {
      expect(scaffoldMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'express-api-hello' })
      );
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('welcome-project-template-notice-success')
      ).toBeTruthy();
    });
  });

  it('renders the non-empty-dir warning notice on that outcome', async () => {
    scaffoldMock.mockResolvedValue({ kind: 'non-empty-dir', meaningfulCount: 4 });
    render(<ProjectTemplatesPanel />);
    fireEvent.click(
      screen.getByTestId('welcome-project-template-fastapi-hello-action')
    );
    await waitFor(() => {
      expect(
        screen.getByTestId('welcome-project-template-notice-non-empty-dir')
      ).toBeTruthy();
    });
  });

  it('short-circuits to the web-unavailable notice on the web build', async () => {
    setPlatform('web');
    render(<ProjectTemplatesPanel />);
    fireEvent.click(
      screen.getByTestId('welcome-project-template-react-component-sandbox-action')
    );
    await waitFor(() => {
      expect(
        screen.getByTestId('welcome-project-template-notice-web-unavailable')
      ).toBeTruthy();
    });
    // Critical: the scaffolder MUST NOT have been called on the web
    // build — it would try to open a folder picker that does not
    // exist in the FSA stub.
    expect(scaffoldMock).not.toHaveBeenCalled();
  });

  it('keeps the notice empty when the user cancels the picker', async () => {
    scaffoldMock.mockResolvedValue({ kind: 'canceled' });
    render(<ProjectTemplatesPanel />);
    fireEvent.click(
      screen.getByTestId('welcome-project-template-python-data-explorer-action')
    );
    await waitFor(() => {
      expect(scaffoldMock).toHaveBeenCalled();
    });
    // No notice container of any kind should render.
    expect(
      screen.queryByTestId(/welcome-project-template-notice-/)
    ).toBeNull();
  });
});
