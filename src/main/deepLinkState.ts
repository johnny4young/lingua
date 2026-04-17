import {
  extractLinguaDeepLinkUrl,
  parseLinguaDeepLink,
  type DeepLinkTarget,
} from '../shared/deepLinks';

export interface DeepLinkRuntimeState {
  pendingTarget: DeepLinkTarget | null;
  rendererReady: boolean;
}

export function createDeepLinkRuntimeState(): DeepLinkRuntimeState {
  return {
    pendingTarget: null,
    rendererReady: false,
  };
}

export function markDeepLinkRendererReady(
  state: DeepLinkRuntimeState,
  ready: boolean
): void {
  state.rendererReady = ready;
}

export function consumePendingDeepLink(
  state: DeepLinkRuntimeState
): DeepLinkTarget | null {
  const target = state.pendingTarget;
  state.pendingTarget = null;
  return target;
}

export function handleIncomingDeepLink(
  state: DeepLinkRuntimeState,
  rawUrl: string,
  dispatchToRenderer: (target: DeepLinkTarget) => boolean
): DeepLinkTarget | null {
  const target = parseLinguaDeepLink(rawUrl);
  if (!target) {
    return null;
  }

  if (state.rendererReady && dispatchToRenderer(target)) {
    return target;
  }

  state.pendingTarget = target;
  return target;
}

export function primeDeepLinkFromArgv(
  state: DeepLinkRuntimeState,
  argv: readonly string[]
): DeepLinkTarget | null {
  const rawUrl = extractLinguaDeepLinkUrl(argv);
  if (!rawUrl) {
    return null;
  }

  return handleIncomingDeepLink(state, rawUrl, () => false);
}
