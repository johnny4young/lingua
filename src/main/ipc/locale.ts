import { app } from 'electron';
import { typedHandle } from './typedHandle';

export function registerLocaleHandlers(): void {
  typedHandle('app:get-system-languages', () =>
    app.getPreferredSystemLanguages()
  );
}
