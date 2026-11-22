import { useEffect, useState, type ComponentType } from 'react';
import { getActiveTab, useEditorStore } from '../../stores/editorStore';
import { useProjectTestStore } from '../../stores/projectTestStore';
import type { TestLineAnswersProps } from './TestLineAnswers';

let answersPromise: Promise<{ TestLineAnswers: ComponentType<TestLineAnswersProps> }> | null = null;

/** Loads the test answers the first time the open file has results from a project test run. */
export function TestLineAnswersHost(props: TestLineAnswersProps) {
  const tabRoot = useEditorStore(state => getActiveTab(state)?.rootId);
  const tabFile = useEditorStore(state => getActiveTab(state)?.relativePath);
  const hasResults = useProjectTestStore(
    state =>
      tabRoot !== undefined &&
      tabFile !== undefined &&
      state.rootId === tabRoot &&
      (state.cases?.some(entry => entry.file === tabFile || entry.failureFile === tabFile) ?? false)
  );
  const [Answers, setAnswers] = useState<ComponentType<TestLineAnswersProps> | null>(null);

  useEffect(() => {
    if (!hasResults || Answers) return;
    let active = true;
    answersPromise ??= import('./TestLineAnswers');
    void answersPromise
      .then(module => {
        if (active) setAnswers(() => module.TestLineAnswers);
      })
      .catch((error: unknown) => console.error('[editor] failed to load the test answers', error));
    return () => {
      active = false;
    };
  }, [hasResults, Answers]);

  return Answers && hasResults ? <Answers {...props} /> : null;
}
