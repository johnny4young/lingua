import path from 'node:path';

const SUPPORTED_ARCHES = new Set(['arm64', 'x64']);

function normalizedPath(value) {
  return value.split(path.sep).join('/').toLowerCase();
}

/**
 * Infer the architecture encoded by electron-builder's macOS output layout.
 *
 * Current outputs use `mac-arm64/lingua.app` for Apple Silicon and
 * `mac/lingua.app` for Intel. Release archives include the architecture in the
 * filename (`Lingua-<version>-mac-arm64.zip`). The plain `mac/` directory is an
 * electron-builder convention for x64, not an architecture-neutral bundle.
 */
export function inferPackagedMacArch(artifactPath) {
  const value = normalizedPath(artifactPath);
  const explicit = value.match(/(?:^|[/_-])(?:mac|darwin)[-_](arm64|x64)(?:[/_.-]|$)/u);
  if (explicit) return explicit[1];
  if (/(?:^|\/)mac(?:\/|$)/u.test(value)) return 'x64';
  if (/(?:^|[/_-])universal(?:[/_.-]|$)/u.test(value)) return 'universal';
  return 'unknown';
}

/** Select a host-compatible app/archive and never silently fall back to Rosetta. */
export function selectPackagedMacArtifact(candidates, targetArch) {
  if (!SUPPORTED_ARCHES.has(targetArch)) {
    throw new Error(`Unsupported macOS smoke architecture: ${targetArch}`);
  }
  if (candidates.length === 0) return null;

  const classified = candidates.map(candidate => ({
    candidate,
    arch: inferPackagedMacArch(candidate),
  }));
  const exact = classified.find(item => item.arch === targetArch);
  if (exact) return exact.candidate;
  const universal = classified.find(item => item.arch === 'universal');
  if (universal) return universal.candidate;
  if (classified.length === 1 && classified[0].arch === 'unknown') {
    return classified[0].candidate;
  }

  throw new Error(
    `No ${targetArch} macOS artifact found. Candidates: ${classified
      .map(item => `${item.candidate} (${item.arch})`)
      .join(', ')}`
  );
}

/** Return the runnable architectures reported by macOS `file`. */
export function parseMacBinaryArchitectures(fileOutput) {
  const architectures = new Set();
  if (/\barm64e?\b/iu.test(fileOutput)) architectures.add('arm64');
  if (/\bx86_64\b/iu.test(fileOutput)) architectures.add('x64');
  return architectures;
}

/**
 * Check the executable itself as a final guard for direct `.app` / `.zip`
 * inputs whose surrounding path may not encode an architecture.
 */
export function assertMacBinarySupportsArch(fileOutput, targetArch, binaryPath) {
  if (!SUPPORTED_ARCHES.has(targetArch)) {
    throw new Error(`Unsupported macOS smoke architecture: ${targetArch}`);
  }
  const architectures = parseMacBinaryArchitectures(fileOutput);
  if (!architectures.has(targetArch)) {
    const detected = [...architectures].join(', ') || 'unknown';
    throw new Error(
      `Packaged binary ${binaryPath} does not support host architecture ${targetArch}; detected ${detected}`
    );
  }
}
