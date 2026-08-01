/**
 * Hero code snippets — three real, runnable lines per language.
 * No fake output, no fake "running" animation. Each one is something a
 * senior dev would actually write into Lingua to test it.
 */

import type { HeroLang } from './shiki';

export const HERO_SNIPPETS: Record<HeroLang, { label: string; code: string }> = {
  javascript: {
    label: 'JavaScript',
    code: `const sizes = [512, 1024, 4096];
const kib = sizes.map((n) => n >> 10);
console.log(kib);`,
  },
  typescript: {
    label: 'TypeScript',
    code: `type Lang = 'ts' | 'py' | 'go';
const active: Lang = 'ts';
console.log(active.toUpperCase());`,
  },
  python: {
    label: 'Python',
    code: `from pathlib import PurePosixPath
path = PurePosixPath("src/runner/python.py")
print(path.suffix)`,
  },
  ruby: {
    label: 'Ruby',
    code: `records = [{ name: "Ada", score: 98 }, { name: "Linus", score: 95 }]
leaders = records.select { |record| record[:score] >= 96 }
puts leaders.map { |record| record[:name] }`,
  },
  go: {
    label: 'Go',
    code: `package main
import "fmt"
func main() { fmt.Println("hello from your local go toolchain") }`,
  },
  rust: {
    label: 'Rust',
    code: `fn main() {
    println!("local rustc, no project required");
}`,
  },
};
