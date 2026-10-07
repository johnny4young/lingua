import type { Monaco } from '@monaco-editor/react';
import type { RelativePath, RootId } from '../../../../shared/fs/brandedIds';
import { getActiveTab, useEditorStore } from '../../../stores/editorStore';
import { useProjectStore } from '../../../stores/projectStore';
import { joinAbsolute, pathToFileUri } from '../../../utils/filePath';
import { languageFromPath } from '../../../utils/language';
import { monacoLanguageFor } from '../../../utils/languageMeta';

type TextModel = import('monaco-editor').editor.ITextModel;

/** Peek and references resolve destinations through existing models only, so unopened files need one. */
export const MAX_LSP_PREVIEW_MODELS = 50;

const previews = new Map<string, { model: TextModel; rootId: RootId }>();
let monacoRef: Monaco | null = null;
let subscribed = false;

function disposePreview(uri: string): void {
  const entry = previews.get(uri);
  if (!entry) return;
  previews.delete(uri);
  if (!entry.model.isDisposed()) entry.model.dispose();
}

// A real tab must start from its own content, not adopt a preview that may have diverged.
function releaseForActiveTab(): void {
  const active = getActiveTab(useEditorStore.getState());
  if (!active?.filePath || !monacoRef || previews.size === 0) return;
  disposePreview(monacoRef.Uri.parse(pathToFileUri(active.filePath)).toString());
}

function releaseOtherProjects(): void {
  const rootId = useProjectStore.getState().currentProject?.rootId;
  for (const [uri, entry] of previews) if (entry.rootId !== rootId) disposePreview(uri);
}

function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  useEditorStore.subscribe(releaseForActiveTab);
  useProjectStore.subscribe(releaseOtherProjects);
}

/**
 * Create read-only-by-convention models for authorized destinations that have
 * none. Returns false when `fresh` turned stale while reading.
 */
export async function ensureLspPreviewModels(
  monaco: Monaco,
  project: { rootId: RootId; rootPath: string },
  relativePaths: readonly RelativePath[],
  fresh: () => boolean
): Promise<boolean> {
  monacoRef = monaco;
  ensureSubscribed();
  const unique = [...new Set(relativePaths)].slice(0, MAX_LSP_PREVIEW_MODELS);
  for (const relativePath of unique) {
    const uri = monaco.Uri.parse(pathToFileUri(joinAbsolute(project.rootPath, relativePath)));
    const key = uri.toString();
    if (monaco.editor.getModel(uri)) {
      const entry = previews.get(key);
      if (entry) {
        previews.delete(key);
        previews.set(key, entry);
      }
      continue;
    }
    // An open but never-mounted buffer is what the server analyzed, not the disk copy.
    const buffer = useEditorStore
      .getState()
      .tabs.find(tab => tab.rootId === project.rootId && tab.relativePath === relativePath);
    let text: string;
    try {
      text = buffer ? buffer.content : await window.lingua.fs.read(project.rootId, relativePath);
    } catch {
      continue;
    }
    if (!fresh()) return false;
    if (monaco.editor.getModel(uri)) continue;
    const model = monaco.editor.createModel(
      text,
      monacoLanguageFor(languageFromPath(relativePath) ?? 'plaintext'),
      uri
    );
    previews.set(model.uri.toString(), { model, rootId: project.rootId });
    while (previews.size > MAX_LSP_PREVIEW_MODELS) {
      const oldest = previews.keys().next().value;
      if (oldest === undefined) break;
      disposePreview(oldest);
    }
  }
  return fresh();
}

/** Test-only: drop every preview model and forget the Monaco instance. */
export function resetLspPreviewModelsForTests(): void {
  for (const uri of [...previews.keys()]) disposePreview(uri);
  monacoRef = null;
}
