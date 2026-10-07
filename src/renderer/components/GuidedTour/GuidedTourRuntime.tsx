import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { createDefaultTab, useEditorStore } from '../../stores/editorStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { useAnnounce } from '../../hooks/useAnnounce';
import type { GuidedTourRuntimeProps } from './guidedTourRuntimeContract';
import { GUIDED_TOUR_SELECTORS, waitForGuidedTourSelector } from './guidedTourSelectors';
import {
  DONT_SHOW_AGAIN_TESTID,
  buildGuidedTourSteps,
  type GuidedTourButtonKind,
} from './guidedTourSteps';

import { calculatePanelStyle, type GuidedTourTargetRect } from './guidedTourLayout';

const TARGET_PADDING = 10;

const BUTTON_LABEL_KEYS: Record<GuidedTourButtonKind, string> = {
  back: 'tour.buttons.back',
  finish: 'tour.buttons.finish',
  next: 'tour.buttons.next',
  run: 'tour.buttons.run',
  skip: 'tour.buttons.skip',
};

// accessibility pass — focusable descendants of the tour dialog, for the Tab trap.
const TOUR_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getTourFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(TOUR_FOCUSABLE_SELECTOR)).filter(
    el =>
      !el.hasAttribute('disabled') &&
      el.getAttribute('aria-hidden') !== 'true' &&
      el.tabIndex !== -1
  );
}

function toTargetRect(rect: DOMRect): GuidedTourTargetRect {
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Expand the visible spotlight beyond the target element so focus rings and
 * small toolbar buttons do not feel clipped by the overlay cutout.
 */
function calculateSpotlightStyle(targetRect: GuidedTourTargetRect): CSSProperties {
  return {
    height: Math.max(0, targetRect.height + TARGET_PADDING * 2),
    left: Math.max(0, targetRect.left - TARGET_PADDING),
    top: Math.max(0, targetRect.top - TARGET_PADDING),
    width: Math.max(0, targetRect.width + TARGET_PADDING * 2),
  };
}

function getButtonClassName(kind: GuidedTourButtonKind) {
  if (kind === 'skip') {
    return 'guided-tour-button guided-tour-button-ghost';
  }

  if (kind === 'back') {
    return 'guided-tour-button guided-tour-button-secondary';
  }

  return 'guided-tour-button guided-tour-button-primary';
}

export function GuidedTourRuntime({
  controls,
  hasActiveOverlay,
  onActiveChange,
  startRequest,
}: GuidedTourRuntimeProps) {
  const { t } = useTranslation();
  const setHasCompletedTour = useSettingsStore(state => state.setHasCompletedTour);
  const suppressTourAutoStart = useSettingsStore(state => state.suppressTourAutoStart);
  const setSuppressTourAutoStart = useSettingsStore(state => state.setSuppressTourAutoStart);
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(null);
  const [targetRect, setTargetRect] = useState<GuidedTourTargetRect | null>(null);
  const activeStepIndexRef = useRef<number | null>(null);
  const controlsRef = useRef(controls);
  // accessibility pass — focus management for the tour dialog (it declared
  // role=dialog + aria-modal but trapped nothing). Focus the dialog when the
  // tour opens and restore focus to the trigger when it closes.
  const dialogRef = useRef<HTMLElement>(null);
  const [panelSize, setPanelSize] = useState({ width: 400, height: 260 });
  const tourReturnFocusRef = useRef<HTMLElement | null>(null);
  // accessibility pass — the layer used to wrap the whole card in aria-live, which
  // re-announced the buttons + checkbox on every step. Announce only the new
  // step's title + body (the open is handled by focus + aria-describedby).
  const announce = useAnnounce();
  const previousStepIndexRef = useRef<number | null>(null);

  useEffect(() => {
    controlsRef.current = controls;
  }, [controls]);

  const tourSteps = useMemo(
    () =>
      buildGuidedTourSteps({
        t,
        ensureConsoleVisible: () => useUIStore.getState().openBottomPanel('console'),
        getSuppressTourAutoStart: () => useSettingsStore.getState().suppressTourAutoStart,
        setSuppressTourAutoStart: value =>
          useSettingsStore.getState().setSuppressTourAutoStart(value),
      }),
    [t]
  );

  useEffect(() => {
    activeStepIndexRef.current = activeStepIndex;
  }, [activeStepIndex]);

  const activeStep = activeStepIndex === null ? null : (tourSteps[activeStepIndex] ?? null);

  const cancelTour = useCallback(() => {
    setActiveStepIndex(null);
    setTargetRect(null);
  }, []);

  // Skipping counts as dismissal for auto-start unless the user set the
  // "don't show again" box themselves during this tour.
  const autoStartChoiceTouchedRef = useRef(false);
  const skipTour = useCallback(() => {
    if (!autoStartChoiceTouchedRef.current) {
      useSettingsStore.getState().setSuppressTourAutoStart(true);
    }
    cancelTour();
  }, [cancelTour]);

  // A keyboard shortcut can open an App overlay while the tour owns focus.
  // Yield immediately instead of leaving two dialogs mounted together.
  useEffect(() => {
    if (hasActiveOverlay && activeStepIndexRef.current !== null) {
      cancelTour();
    }
  }, [cancelTour, hasActiveOverlay]);

  // accessibility pass — capture the trigger when the tour opens, move focus into
  // the dialog, and restore focus to the trigger when it closes.
  const tourActive = activeStepIndex !== null;
  useEffect(() => {
    if (!tourActive) return;
    tourReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => {
      dialogRef.current?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      const previous = tourReturnFocusRef.current;
      if (previous && document.contains(previous)) {
        try {
          previous.focus({ preventScroll: true });
        } catch {
          // Detached node during a fast close — ignore.
        }
      }
    };
  }, [tourActive]);

  // Announce step changes politely. The initial open is read by the dialog's
  // accessible name + description when focus lands on it, so only subsequent
  // navigation (Next/Back) needs an announcement.
  useEffect(() => {
    if (activeStepIndex === null) {
      previousStepIndexRef.current = null;
      return;
    }
    const previousIndex = previousStepIndexRef.current;
    previousStepIndexRef.current = activeStepIndex;
    if (previousIndex === null) return;
    const step = tourSteps[activeStepIndex];
    if (step) {
      announce(`${step.title}. ${step.text}`);
    }
  }, [activeStepIndex, tourSteps, announce]);

  // Escape skips the tour; Tab is trapped inside the dialog.
  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      skipTour();
      return;
    }
    if (event.key !== 'Tab') return;
    const root = dialogRef.current;
    if (!root) return;
    const focusable = getTourFocusable(root);
    if (focusable.length === 0) {
      event.preventDefault();
      root.focus({ preventScroll: true });
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    // `active === root` covers Shift+Tab while the dialog container itself
    // holds focus (the on-open target), which would otherwise escape backward.
    if (event.shiftKey && (active === first || active === root || !root.contains(active))) {
      event.preventDefault();
      last?.focus({ preventScroll: true });
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first?.focus({ preventScroll: true });
    }
  };

  const completeTour = useCallback(() => {
    setHasCompletedTour(true);
    setActiveStepIndex(null);
    setTargetRect(null);
  }, [setHasCompletedTour]);

  const goToNextStep = useCallback(() => {
    setActiveStepIndex(current => {
      if (current === null) return current;
      return Math.min(current + 1, tourSteps.length - 1);
    });
  }, [tourSteps.length]);

  const goToPreviousStep = useCallback(() => {
    setActiveStepIndex(current => {
      if (current === null) return current;
      return Math.max(current - 1, 0);
    });
  }, []);

  useEffect(() => {
    if (!activeStep) {
      return;
    }

    // A step can run async setup (opening panels, palettes, snippets) before
    // its target exists. Keep a cancellation flag so a fast skip/next does not
    // apply a stale rectangle or highlight class after the step has changed.
    let cancelled = false;
    let highlightedElement: HTMLElement | null = null;
    let targetObserver: ResizeObserver | null = null;

    const clearHighlight = () => {
      targetObserver?.disconnect();
      highlightedElement?.classList.remove('guided-tour-target');
      highlightedElement = null;
    };

    const updateTarget = () => {
      const element = document.querySelector<HTMLElement>(activeStep.attachTo.selector);
      if (element !== highlightedElement) clearHighlight();

      if (!element) {
        setTargetRect(null);
        return;
      }

      if (element !== highlightedElement) {
        element.classList.add('guided-tour-target');
        highlightedElement = element;
        if (typeof ResizeObserver !== 'undefined') {
          targetObserver = new ResizeObserver(updateTarget);
          targetObserver.observe(element);
        }
      }
      setTargetRect(toTargetRect(element.getBoundingClientRect()));
    };

    const showStep = async () => {
      setTargetRect(null);
      await activeStep.beforeShowPromise?.();
      await waitForGuidedTourSelector(activeStep.attachTo.selector);

      if (!cancelled) {
        document.querySelector(activeStep.attachTo.selector)?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'center',
        });
        updateTarget();
      }
    };

    void showStep();

    window.addEventListener('resize', updateTarget);
    window.addEventListener('scroll', updateTarget, true);

    return () => {
      cancelled = true;
      clearHighlight();
      window.removeEventListener('resize', updateTarget);
      window.removeEventListener('scroll', updateTarget, true);
    };
  }, [activeStep]);

  const startTour = useCallback(async () => {
    autoStartChoiceTouchedRef.current = false;
    controlsRef.current.closeOverlay();

    const { tabs, addTab } = useEditorStore.getState();
    if (tabs.length === 0) {
      addTab(createDefaultTab('javascript'));
    }

    useUIStore.getState().openBottomPanel('console');

    // `startTour` can be called by Settings, the command palette, and
    // first-run choreography. If a tour is already active, leave the current
    // step in control instead of restarting underneath the user.
    if (activeStepIndexRef.current !== null) {
      return;
    }

    await waitForGuidedTourSelector(GUIDED_TOUR_SELECTORS.editor);

    if (activeStepIndexRef.current === null) {
      setActiveStepIndex(0);
    }
  }, []);

  useEffect(() => {
    if (startRequest === 0) return;
    void startTour();
  }, [startRequest, startTour]);

  const handleButtonClick = (button: GuidedTourButtonKind) => {
    if (button === 'back') {
      goToPreviousStep();
      return;
    }

    if (button === 'finish') {
      completeTour();
      return;
    }

    if (button === 'next') {
      goToNextStep();
      return;
    }

    if (button === 'run') {
      const selector = activeStep?.actionTarget;
      const target = selector ? document.querySelector<HTMLButtonElement>(selector) : null;
      if (!target || target.disabled) {
        return;
      }
      target.click();
      goToNextStep();
      return;
    }

    skipTour();
  };

  // The translated copy can be taller than an estimate. Measure actual content,
  // including overflow, so the Console step stays above the output it explains.
  useEffect(() => {
    const panel = dialogRef.current;
    if (!panel) return;
    const measure = () => {
      const { width, height } = panel.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      const contentHeight = Math.max(height, panel.scrollHeight + 2);
      setPanelSize(previous =>
        previous.width === width && previous.height === contentHeight
          ? previous
          : { width, height: contentHeight }
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [activeStep]);

  const panelStyle = calculatePanelStyle(targetRect, activeStep?.attachTo.on ?? null, panelSize, {
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    onActiveChange(tourActive);
  }, [tourActive, onActiveChange]);

  useEffect(
    () => () => {
      onActiveChange(false);
    },
    [onActiveChange]
  );

  return activeStep ? (
    <div className="guided-tour-layer">
      <div className="guided-tour-overlay" data-spotlight={targetRect ? 'true' : 'false'} />
      {targetRect ? (
        <div
          aria-hidden="true"
          className="guided-tour-spotlight"
          style={calculateSpotlightStyle(targetRect)}
        />
      ) : null}
      <section
        ref={dialogRef}
        aria-describedby="guided-tour-text"
        aria-labelledby="guided-tour-title"
        aria-modal="true"
        className="guided-tour-step"
        onKeyDown={handleDialogKeyDown}
        role="dialog"
        style={panelStyle}
        tabIndex={-1}
      >
        <header className="guided-tour-header">
          <h2 id="guided-tour-title" className="guided-tour-title">
            {activeStep.title}
          </h2>
          <button
            type="button"
            className="guided-tour-close"
            aria-label={t('tour.buttons.skip')}
            onClick={skipTour}
          >
            <X aria-hidden="true" size={18} strokeWidth={2} />
          </button>
        </header>
        <div id="guided-tour-text" className="guided-tour-text">
          {activeStep.text}
        </div>
        <footer className="guided-tour-footer">
          <label className="guided-tour-dont-show-again" data-testid={DONT_SHOW_AGAIN_TESTID}>
            <input
              checked={suppressTourAutoStart}
              className="guided-tour-dont-show-again-input"
              onChange={event => {
                autoStartChoiceTouchedRef.current = true;
                setSuppressTourAutoStart(event.currentTarget.checked);
              }}
              type="checkbox"
            />
            <span>{t('tour.options.dontShowAgain')}</span>
          </label>
          <div className="guided-tour-actions">
            {activeStep.buttons.map(button => (
              <button
                key={button}
                type="button"
                className={getButtonClassName(button)}
                onClick={() => handleButtonClick(button)}
              >
                {t(BUTTON_LABEL_KEYS[button])}
              </button>
            ))}
          </div>
        </footer>
      </section>
    </div>
  ) : null;
}
