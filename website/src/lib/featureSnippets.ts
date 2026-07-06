/**
 * Real, runnable code snippets used as visual anchors on /features.
 * Different from heroSnippets (those are 3-line teasers); these show a bit
 * more — what each language runner is actually competent at.
 */

import type { HeroLang } from './shiki';

export const FEATURE_SNIPPETS: Record<HeroLang, { label: string; tier: 'Free' | 'Pro'; runtime: string; code: string }> = {
  javascript: {
    label: 'JavaScript',
    tier: 'Free',
    runtime: 'Web Worker · parent-owned timeouts',
    code: `// runs in a sandboxed worker, capped output, instant feedback
const reqs = ['/api/health', '/api/version', '/api/build'];
const probes = await Promise.all(
  reqs.map((u) => fetch(u).then((r) => [u, r.status]))
);
console.table(Object.fromEntries(probes));`,
  },
  typescript: {
    label: 'TypeScript',
    tier: 'Free',
    runtime: 'esbuild-wasm transpile → JS worker',
    code: `// type-check happens in your editor; runtime is the JS worker
type Tier = 'free' | 'pro' | 'pro_lifetime' | 'team';
const limits: Record<Tier, number | 'unlimited'> = {
  free: 5, pro: 'unlimited', pro_lifetime: 'unlimited', team: 'unlimited',
};
console.log(limits.free); //=> 5`,
  },
  python: {
    label: 'Python',
    tier: 'Free',
    runtime: 'Pyodide v0.26.4 · vendored offline on desktop',
    code: `# zero install — Pyodide ships inside the binary
import statistics
samples = [42, 51, 39, 47, 55, 38, 49, 44, 52, 46]
print({
    'mean': round(statistics.mean(samples), 2),
    'stdev': round(statistics.stdev(samples), 2),
})`,
  },
  go: {
    label: 'Go',
    tier: 'Pro',
    runtime: 'Local go toolchain · minimal subprocess env',
    code: `package main

import "fmt"

func main() {
    langs := []string{"js", "ts", "python", "go", "rust"}
    fmt.Printf("lingua runs %d languages\\n", len(langs))
}`,
  },
  rust: {
    label: 'Rust',
    tier: 'Pro',
    runtime: 'Local rustc toolchain · cleaned tmpdir per run',
    code: `fn main() {
    let langs = ["js", "ts", "python", "go", "rust"];
    let total: usize = langs.iter().map(|l| l.len()).sum();
    println!("{} chars across {} langs", total, langs.len());
}`,
  },
};
