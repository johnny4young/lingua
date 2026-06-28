import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { createDefaultTab, useEditorStore } from '../../stores/editorStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { useAnnounce } from '../../hooks/useAnnounce';
import { GuidedTourContext } from './guidedTourContext';
import { GUIDED_TOUR_SELECTORS, waitForGuidedTourSelector } from './guidedTourSelectors';
import {
  DONT_SHOW_AGAIN_TESTID,
  buildGuidedTourSteps,
  type GuidedTourButtonKind,
  type GuidedTourPlacement,
} from './guidedTourSteps';

interface GuidedTourControls {
  closeOverlay: () => void;
  openPalette: () => void;
  openSnippets: () => void;
}

interface GuidedTourProviderProps {
  children: ReactNode;
  controls: GuidedTourControls;
}

interface GuidedTourTargetRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

const TARGET_PADDING = 10;
const PANEL_MARGIN = 16;
const PANEL_WIDTH = 400;
const PANEL_HEIGHT_ESTIMATE = 260;

const BUTTON_LABEL_KEYS: Record<GuidedTourButtonKind, string> = {
  back: 'tour.buttons.back',
  finish: 'tour.buttons.finish',
  next: 'tour.buttons.next',
  skip: 'tour.buttons.skip',
};

// UX Sweep T8 — focusable descendants of the tour dialog, for the Tab trap.
const TOUR_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getTourFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(TOUR_FOCUSABLE_SELECTOR)
  ).filter(
    (el) =>
      !el.hasAttribute('disabled') &&
      el.getAttribute('aria-hidden') !== 'true' &&
      el.tabIndex !== -1
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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
 * Position the tour card near the highlighted element while keeping it inside
 * the viewport. The panel height is an estimate because copy length changes by
 * locale; the final clamp is the safety rail that prevents offscreen controls.
 */
function calculatePanelStyle(
  targetRect: GuidedTourTargetRect | null,
  placement: GuidedTourPlacement | null
): CSSProperties {
  if (!targetRect || !placement) {
    return {
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
    };
  }

  const maxLeft = Math.max(PANEL_MARGIN, window.innerWidth - PANEL_WIDTH - PANEL_MARGIN);
  const maxTop = Math.max(
    PANEL_MARGIN,
    window.innerHeight - PANEL_HEIGHT_ESTIMATE - PANEL_MARGIN
  );
  let left = targetRect.left;
  let top = targetRect.bottom + PANEL_MARGIN;

  if (placement === 'right' || placement === 'right-start') {
    left = targetRect.right + PANEL_MARGIN;
    top =
      placement === 'right-start'
        ? targetRect.top
        : targetRect.top + targetRect.height / 2 - PANEL_HEIGHT_ESTIMATE / 2;

    if (left > maxLeft) {
      left = targetRect.left - PANEL_WIDTH - PANEL_MARGIN;
    }
  }

  if (placement === 'bottom') {
    left = targetRect.left + targetRect.width / 2 - PANEL_WIDTH / 2;
    top = targetRect.bottom + PANEL_MARGIN;
  }

  if (placement === 'bottom-end') {
    left = targetRect.right - PANEL_WIDTH;
    top = targetRect.bottom + PANEL_MARGIN;
  }

  if (placement === 'top') {
    left = targetRect.left + targetRect.width / 2 - PANEL_WIDTH / 2;
    top = targetRect.top - PANEL_HEIGHT_ESTIMATE - PANEL_MARGIN;
  }

  if (top > maxTop && targetRect.top > PANEL_HEIGHT_ESTIMATE + PANEL_MARGIN * 2) {
    top = targetRect.top - PANEL_HEIGHT_ESTIMATE - PANEL_MARGIN;
  }

  return {
    left: clamp(left, PANEL_MARGIN, maxLeft),
    top: clamp(top, PANEL_MARGIN, maxTop),
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

function GuidedTourRuntime({
  children,
  controls,
}: GuidedTourProviderProps) {
  const { t } = useTranslation();
  const hasCompletedTour = useSettingsStore((state) => state.hasCompletedTour);
  const setHasCompletedTour = useSettingsStore((state) => state.setHasCompletedTour);
  const suppressTourAutoStart = useSettingsStore((state) => state.suppressTourAutoStart);
  const setSuppressTourAutoStart = useSettingsStore(
    (state) => state.setSuppressTourAutoStart
  );
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(null);
  const [targetRect, setTargetRect] = useState<GuidedTourTargetRect | null>(null);
  const activeStepIndexRef = useRef<number | null>(null);
  const controlsRef = useRef(controls);
  // UX Sweep T8 — focus management for the tour dialog (it declared
  // role=dialog + aria-modal but trapped nothing). Focus the dialog when the
  // tour opens and restore focus to the trigger when it closes.
  const dialogRef = useRef<HTMLElement>(null);
  const tourReturnFocusRef = useRef<HTMLElement | null>(null);
  // UX Sweep T8 — the layer used to wrap the whole card in aria-live, which
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
        closeOverlay: () => controlsRef.current.closeOverlay(),
        openPalette: () => controlsRef.current.openPalette(),
        openSnippets: () => controlsRef.current.openSnippets(),
        ensureConsoleVisible: () => useUIStore.getState().openBottomPanel('console'),
        ensureSidebarVisible: () => useUIStore.getState().setSidebarVisible(true),
        getSuppressTourAutoStart: () =>
          useSettingsStore.getState().suppressTourAutoStart,
        setSuppressTourAutoStart: (value) =>
          useSettingsStore.getState().setSuppressTourAutoStart(value),
      }),
    [t]
  );

  useEffect(() => {
    activeStepIndexRef.current = activeStepIndex;
  }, [activeStepIndex]);

  const activeStep =
    activeStepIndex === null ? null : (tourSteps[activeStepIndex] ?? null);

  const cancelTour = useCallback(() => {
    setActiveStepIndex(null);
    setTargetRect(null);
    controlsRef.current.closeOverlay();
  }, []);

  // UX Sweep T8 — capture the trigger when the tour opens, move focus into
  // the dialog, and restore focus to the trigger when it closes.
  const tourActive = activeStepIndex !== null;
  useEffect(() => {
    if (!tourActive) return;
    tourReturnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
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
      cancelTour();
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
    if (
      event.shiftKey &&
      (active === first || active === root || !root.contains(active))
    ) {
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
    controlsRef.current.closeOverlay();
  }, [setHasCompletedTour]);

  const goToNextStep = useCallback(() => {
    setActiveStepIndex((current) => {
      if (current === null) return current;
      return Math.min(current + 1, tourSteps.length - 1);
    });
  }, [tourSteps.length]);

  const goToPreviousStep = useCallback(() => {
    setActiveStepIndex((current) => {
      if (current === null) return current;
      return Math.max(current - 1, 0);
    });
  }, []);

  useEffect(() => {
    if (!activeStep) {
      setTargetRect(null);
      return;
    }

    // A step can run async setup (opening panels, palettes, snippets) before
    // its target exists. Keep a cancellation flag so a fast skip/next does not
    // apply a stale rectangle or highlight class after the step has changed.
    let cancelled = false;
    let highlightedElement: HTMLElement | null = null;

    const clearHighlight = () => {
      highlightedElement?.classList.remove('guided-tour-target');
      highlightedElement = null;
    };

    const updateTarget = () => {
      const element = document.querySelector<HTMLElement>(activeStep.attachTo.selector);
      clearHighlight();

      if (!element) {
        setTargetRect(null);
        return;
      }

      element.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'center',
      });
      element.classList.add('guided-tour-target');
      highlightedElement = element;
      setTargetRect(toTargetRect(element.getBoundingClientRect()));
    };

    const showStep = async () => {
      setTargetRect(null);
      await activeStep.beforeShowPromise?.();
      await waitForGuidedTourSelector(activeStep.attachTo.selector);

      if (!cancelled) {
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

  useEffect(() => {
    if (!activeStep?.advanceOn) {
      return;
    }

    // Some steps advance after the user interacts with a target rendered by a
    // different overlay. Capture the step index when the listener is installed
    // so delayed events cannot advance a newer step accidentally.
    let cancelled = false;
    let element: HTMLElement | null = null;
    const { event, selector } = activeStep.advanceOn;
    const expectedStepIndex = activeStepIndex;
    const handleAdvance = () => {
      if (activeStepIndexRef.current === expectedStepIndex) {
        goToNextStep();
      }
    };

    const attachListener = async () => {
      await waitForGuidedTourSelector(selector);
      if (cancelled) return;

      element = document.querySelector<HTMLElement>(selector);
      element?.addEventListener(event, handleAdvance);
    };

    void attachListener();

    return () => {
      cancelled = true;
      element?.removeEventListener(event, handleAdvance);
    };
  }, [activeStep, activeStepIndex, goToNextStep]);

  const startTour = useCallback(async () => {
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

    cancelTour();
  };

  const contextValue = {
    startTour,
    isTourActive: activeStepIndex !== null,
    hasCompletedTour,
  };
  const panelStyle = calculatePanelStyle(
    targetRect,
    activeStep?.attachTo.on ?? null
  );

  return (
    <GuidedTourContext.Provider value={contextValue}>
      {children}
      {activeStep ? (
        <div className="guided-tour-layer">
          <div className="guided-tour-overlay" />
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
                onClick={cancelTour}
              >
                <X aria-hidden="true" size={18} strokeWidth={2} />
              </button>
            </header>
            <div id="guided-tour-text" className="guided-tour-text">
              {activeStep.text}
            </div>
            <footer className="guided-tour-footer">
              <label
                className="guided-tour-dont-show-again"
                data-testid={DONT_SHOW_AGAIN_TESTID}
              >
                <input
                  checked={suppressTourAutoStart}
                  className="guided-tour-dont-show-again-input"
                  onChange={(event) =>
                    setSuppressTourAutoStart(event.currentTarget.checked)
                  }
                  type="checkbox"
                />
                <span>{t('tour.options.dontShowAgain')}</span>
              </label>
              <div className="guided-tour-actions">
                {activeStep.buttons.map((button) => (
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
      ) : null}
    </GuidedTourContext.Provider>
  );
}

export function GuidedTourProvider({ children, controls }: GuidedTourProviderProps) {
  return <GuidedTourRuntime controls={controls}>{children}</GuidedTourRuntime>;
}
