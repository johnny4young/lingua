import type { editor } from 'monaco-editor';
import { useProjectStore } from '../../stores/projectStore';
import { getActiveTab, useEditorStore } from '../../stores/editorStore';
import { joinAbsolute } from '../../utils/filePath';
import { languageFromPath } from '../../utils/language';

/** Project capability and context checks for Monaco's destination opener. */
export function createLspEditorOpener(): editor.ICodeEditorOpener {
  return {
    async openCodeEditor(
      source: import('monaco-editor').editor.ICodeEditor,
      resource: import('monaco-editor').Uri,
      selection?: import('monaco-editor').IRange | import('monaco-editor').IPosition
    ) {
      const active = getActiveTab(useEditorStore.getState());
      const project = useProjectStore.getState().currentProject;
      if (
        !project ||
        !active ||
        (active.language !== 'go' && active.language !== 'rust') ||
        active.rootId !== project.rootId
      )
        return false;
      const model = source.getModel();
      const version = model?.getVersionId();
      const stillCurrent = () =>
        useProjectStore.getState().currentProject?.rootId === project.rootId &&
        useEditorStore.getState().activeTabId === active.id &&
        source.getModel() === model &&
        model?.getVersionId() === version;
      const relativePath = await window.lingua.lsp.resolveTarget(
        project.rootId,
        resource.toString()
      );
      if (!relativePath || !stillCurrent()) return false;
      const name = relativePath.split('/').pop() ?? relativePath;
      await useEditorStore
        .getState()
        .openFile(
          project.rootId,
          relativePath,
          name,
          languageFromPath(name) ?? 'plaintext',
          joinAbsolute(project.rootPath, relativePath),
          stillCurrent
        );
      if (useProjectStore.getState().currentProject?.rootId !== project.rootId) return false;
      const tab = useEditorStore
        .getState()
        .tabs.find(tab => tab.rootId === project.rootId && tab.relativePath === relativePath);
      // A refused/stale open must not leave a reveal queued for a later visit.
      if (!tab || useEditorStore.getState().activeTabId !== tab.id) return false;
      if (selection)
        useEditorStore.getState().requestReveal({
          tabId: tab.id,
          line: 'startLineNumber' in selection ? selection.startLineNumber : selection.lineNumber,
          column: 'startColumn' in selection ? selection.startColumn : selection.column,
          ...('endLineNumber' in selection
            ? { endLine: selection.endLineNumber, endColumn: selection.endColumn }
            : {}),
        });
      return true;
    },
  };
}
