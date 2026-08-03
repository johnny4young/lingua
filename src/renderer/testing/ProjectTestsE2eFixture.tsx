/** Playwright-only deterministic evidence surface for the project test runner. */

import { ProjectTestsOverlay } from '../components/ProjectTests/ProjectTestsOverlay';

export function ProjectTestsE2eFixture() {
  return <ProjectTestsOverlay onClose={() => undefined} />;
}
