import type { Monaco } from '@monaco-editor/react';
import type { LspLanguageIntelligenceAdapter } from '../../../languageIntelligence/types';
import { useEditorStore } from '../../../stores/editorStore';
import { useProjectStore } from '../../../stores/projectStore';
import { joinAbsolute, pathToFileUri } from '../../../utils/filePath';

/** Every destination is authorized in main before Monaco receives a navigable URI. */
export function createLspNavigationProviders(
  monaco: Monaco,
  language: 'go' | 'rust',
  available: () => boolean,
  adapter: () => LspLanguageIntelligenceAdapter | null
) {
  type Model = import('monaco-editor').editor.ITextModel;
  type Position = import('monaco-editor').Position;
  type Token = import('monaco-editor').CancellationToken;
  async function locations(model: Model, position: Position, token: Token, references?: boolean) {
    const project = useProjectStore.getState().currentProject;
    const uri = model.uri.toString();
    const tab = useEditorStore
      .getState()
      .tabs.find(
        tab =>
          tab.language === language &&
          tab.rootId === project?.rootId &&
          tab.relativePath &&
          tab.filePath &&
          pathToFileUri(tab.filePath) === uri
      );
    const service = adapter();
    if (!project || !tab || !available() || !service || token.isCancellationRequested) return [];
    const version = model.getVersionId();
    const buffersVersion = useEditorStore
      .getState()
      .tabs.filter(current => current.language === language && current.rootId === project.rootId)
      .map(current => [current.id, current.content] as const);
    const fresh = () =>
      !token.isCancellationRequested &&
      !model.isDisposed() &&
      model.getVersionId() === version &&
      useProjectStore.getState().currentProject?.rootId === project.rootId &&
      useEditorStore.getState().activeTabId === tab.id &&
      buffersVersion.every(
        ([id, content]) =>
          useEditorStore.getState().tabs.find(current => current.id === id)?.content === content
      ) &&
      useEditorStore
        .getState()
        .tabs.some(
          current =>
            current.id === tab.id &&
            current.rootId === project.rootId &&
            current.filePath === tab.filePath
        );
    try {
      // Navigation must see existing dirty project buffers, not just the active model.
      const buffers = useEditorStore
        .getState()
        .tabs.filter(
          current =>
            current.language === language && current.rootId === project.rootId && current.filePath
        );
      for (const buffer of buffers)
        service.openDocument(
          pathToFileUri(buffer.filePath!),
          buffer.id === tab.id ? model.getValue() : buffer.content
        );

      const destinations =
        references !== undefined
          ? await service.provideReferences?.(uri, position.lineNumber, position.column, references)
          : await service.provideDefinition?.(uri, position.lineNumber, position.column);
      if (!fresh()) return [];
      const authorized = [];
      for (const destination of destinations ?? []) {
        if (!fresh()) return [];
        const relativePath = await window.lingua.lsp.resolveTarget(project.rootId, destination.uri);
        if (!fresh()) return [];
        if (!relativePath) continue;
        authorized.push({
          uri: monaco.Uri.parse(pathToFileUri(joinAbsolute(project.rootPath, relativePath))),
          range: {
            startLineNumber: destination.range.start.line + 1,
            startColumn: destination.range.start.character + 1,
            endLineNumber: destination.range.end.line + 1,
            endColumn: destination.range.end.character + 1,
          },
        });
      }
      return authorized;
    } catch {
      return [];
    }
  }
  return {
    definition: {
      provideDefinition: (model: Model, position: Position, token: Token) =>
        locations(model, position, token),
    },
    references: {
      provideReferences: (
        model: Model,
        position: Position,
        context: { includeDeclaration: boolean },
        token: Token
      ) => locations(model, position, token, context.includeDeclaration),
    },
  };
}
