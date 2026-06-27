import type { TFunction } from 'i18next';
import type { Language } from '../types';

/**
 * Built-in templates keep their UI-facing copy in translation catalogs so
 * labels and descriptions stay aligned with the active locale. Template
 * code bodies remain source-language content and are intentionally not
 * localized for the MVP (see RL-018 Phase 3).
 */
export interface Template {
  id: string;
  language: Language;
  fileStem: string;
  labelKey: string;
  descriptionKey: string;
  code: string;
}

export const BUILT_IN_TEMPLATES: readonly Template[] = [
  // ── JavaScript ────────────────────────────────────────────────────────────
  {
    id: 'js-hello',
    language: 'javascript',
    fileStem: 'Hello World',
    labelKey: 'templates.js-hello.label',
    descriptionKey: 'templates.js-hello.description',
    code: `console.log("Hello, World!");
`,
  },
  {
    id: 'js-fetch',
    language: 'javascript',
    fileStem: 'Fetch HTTP',
    labelKey: 'templates.js-fetch.label',
    descriptionKey: 'templates.js-fetch.description',
    code: `const res = await fetch("https://jsonplaceholder.typicode.com/todos/1");
const todo = await res.json();
console.log(todo);
`,
  },
  {
    id: 'js-sort',
    language: 'javascript',
    fileStem: 'Sorting Algorithms',
    labelKey: 'templates.js-sort.label',
    descriptionKey: 'templates.js-sort.description',
    code: `function quickSort(arr) {
  if (arr.length <= 1) return arr;
  const pivot = arr[Math.floor(arr.length / 2)];
  const left = arr.filter((x) => x < pivot);
  const mid = arr.filter((x) => x === pivot);
  const right = arr.filter((x) => x > pivot);
  return [...quickSort(left), ...mid, ...quickSort(right)];
}

const nums = [3, 6, 8, 10, 1, 2, 1];
console.log("QuickSort:", quickSort(nums));
`,
  },
  {
    id: 'js-class',
    language: 'javascript',
    fileStem: 'Class & OOP',
    labelKey: 'templates.js-class.label',
    descriptionKey: 'templates.js-class.description',
    code: `class Counter {
  #count = 0;

  increment() { this.#count++; }
  decrement() { this.#count--; }
  get value() { return this.#count; }
}

const c = new Counter();
c.increment();
c.increment();
c.decrement();
console.log("Count:", c.value); // 1
`,
  },

  // ── TypeScript ────────────────────────────────────────────────────────────
  {
    id: 'ts-hello',
    language: 'typescript',
    fileStem: 'Hello World',
    labelKey: 'templates.ts-hello.label',
    descriptionKey: 'templates.ts-hello.description',
    code: `function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

console.log(greet("World"));
`,
  },
  {
    id: 'ts-generic',
    language: 'typescript',
    fileStem: 'Generic Stack',
    labelKey: 'templates.ts-generic.label',
    descriptionKey: 'templates.ts-generic.description',
    code: `class Stack<T> {
  private items: T[] = [];

  push(item: T): void { this.items.push(item); }
  pop(): T | undefined { return this.items.pop(); }
  peek(): T | undefined { return this.items[this.items.length - 1]; }
  get size(): number { return this.items.length; }
}

const s = new Stack<number>();
s.push(1);
s.push(2);
s.push(3);
console.log("Peek:", s.peek()); // 3
console.log("Pop:", s.pop());   // 3
console.log("Size:", s.size);   // 2
`,
  },
  {
    id: 'ts-sort',
    language: 'typescript',
    fileStem: 'Sorting Algorithms',
    labelKey: 'templates.ts-sort.label',
    descriptionKey: 'templates.ts-sort.description',
    code: `function quickSort<T>(arr: T[], compare = (a: T, b: T) => (a < b ? -1 : a > b ? 1 : 0)): T[] {
  if (arr.length <= 1) return arr;
  const pivot = arr[Math.floor(arr.length / 2)];
  return [
    ...quickSort(arr.filter((x) => compare(x, pivot) < 0), compare),
    ...arr.filter((x) => compare(x, pivot) === 0),
    ...quickSort(arr.filter((x) => compare(x, pivot) > 0), compare),
  ];
}

console.log(quickSort([3, 1, 4, 1, 5, 9, 2, 6]));
console.log(quickSort(["banana", "apple", "cherry"]));
`,
  },
  {
    id: 'ts-async',
    language: 'typescript',
    fileStem: 'Async / Await',
    labelKey: 'templates.ts-async.label',
    descriptionKey: 'templates.ts-async.description',
    code: `interface Post {
  id: number;
  title: string;
  body: string;
}

async function fetchPost(id: number): Promise<Post> {
  const res = await fetch(\`https://jsonplaceholder.typicode.com/posts/\${id}\`);
  if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
  return res.json() as Promise<Post>;
}

const post = await fetchPost(1);
console.log(post.title);
`,
  },

  // ── Go ────────────────────────────────────────────────────────────────────
  {
    id: 'go-hello',
    language: 'go',
    fileStem: 'Hello World',
    labelKey: 'templates.go-hello.label',
    descriptionKey: 'templates.go-hello.description',
    code: `package main

import "fmt"

func main() {
\tfmt.Println("Hello, World!")
}
`,
  },
  {
    id: 'go-goroutine',
    language: 'go',
    fileStem: 'Goroutines & Channels',
    labelKey: 'templates.go-goroutine.label',
    descriptionKey: 'templates.go-goroutine.description',
    code: `package main

import (
\t"fmt"
\t"sync"
)

func worker(id int, wg *sync.WaitGroup) {
\tdefer wg.Done()
\tfmt.Printf("Worker %d starting\\n", id)
\t// simulate work
\tfmt.Printf("Worker %d done\\n", id)
}

func main() {
\tvar wg sync.WaitGroup
\tfor i := 1; i <= 5; i++ {
\t\twg.Add(1)
\t\tgo worker(i, &wg)
\t}
\twg.Wait()
\tfmt.Println("All workers done")
}
`,
  },
  {
    id: 'go-sort',
    language: 'go',
    fileStem: 'Sorting',
    labelKey: 'templates.go-sort.label',
    descriptionKey: 'templates.go-sort.description',
    code: `package main

import (
\t"fmt"
\t"sort"
)

func main() {
\tnums := []int{3, 1, 4, 1, 5, 9, 2, 6}
\tsort.Ints(nums)
\tfmt.Println(nums)

\twords := []string{"banana", "apple", "cherry"}
\tsort.Strings(words)
\tfmt.Println(words)
}
`,
  },

  // ── Python ────────────────────────────────────────────────────────────────
  {
    id: 'py-hello',
    language: 'python',
    fileStem: 'Hello World',
    labelKey: 'templates.py-hello.label',
    descriptionKey: 'templates.py-hello.description',
    code: `print("Hello, World!")
`,
  },
  {
    id: 'py-list',
    language: 'python',
    fileStem: 'List Comprehensions',
    labelKey: 'templates.py-list.label',
    descriptionKey: 'templates.py-list.description',
    code: `numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

evens = [n for n in numbers if n % 2 == 0]
squares = [n ** 2 for n in numbers]
even_squares = [n ** 2 for n in numbers if n % 2 == 0]

print("Even:", evens)
print("Squares:", squares)
print("Even squares:", even_squares)
`,
  },
  {
    id: 'py-sort',
    language: 'python',
    fileStem: 'Sorting Algorithms',
    labelKey: 'templates.py-sort.label',
    descriptionKey: 'templates.py-sort.description',
    code: `def merge_sort(arr):
    if len(arr) <= 1:
        return arr
    mid = len(arr) // 2
    left = merge_sort(arr[:mid])
    right = merge_sort(arr[mid:])
    return merge(left, right)

def merge(left, right):
    result = []
    i = j = 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            result.append(left[i]); i += 1
        else:
            result.append(right[j]); j += 1
    return result + left[i:] + right[j:]

nums = [3, 1, 4, 1, 5, 9, 2, 6]
print(merge_sort(nums))
`,
  },
  {
    id: 'py-class',
    language: 'python',
    fileStem: 'Dataclass',
    labelKey: 'templates.py-class.label',
    descriptionKey: 'templates.py-class.description',
    code: `from dataclasses import dataclass, field
from typing import List

@dataclass
class Student:
    name: str
    grade: float
    courses: List[str] = field(default_factory=list)

    def gpa_letter(self) -> str:
        if self.grade >= 90: return 'A'
        if self.grade >= 80: return 'B'
        if self.grade >= 70: return 'C'
        return 'F'

alice = Student("Alice", 92.5, ["Math", "CS", "Physics"])
print(f"{alice.name}: {alice.gpa_letter()} ({alice.grade})")
print(f"Courses: {', '.join(alice.courses)}")
`,
  },

  // ── Rust ─────────────────────────────────────────────────────────────────
  {
    id: 'rs-hello',
    language: 'rust',
    fileStem: 'Hello World',
    labelKey: 'templates.rs-hello.label',
    descriptionKey: 'templates.rs-hello.description',
    code: `fn main() {
    println!("Hello, World!");
}
`,
  },
  {
    id: 'rs-ownership',
    language: 'rust',
    fileStem: 'Ownership & Borrowing',
    labelKey: 'templates.rs-ownership.label',
    descriptionKey: 'templates.rs-ownership.description',
    code: `fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {
    if x.len() > y.len() { x } else { y }
}

fn main() {
    let s1 = String::from("long string");
    let result;
    {
        let s2 = String::from("xyz");
        result = longest(s1.as_str(), s2.as_str());
        println!("Longest: {}", result);
    }
}
`,
  },
  {
    id: 'rs-sort',
    language: 'rust',
    fileStem: 'Sorting',
    labelKey: 'templates.rs-sort.label',
    descriptionKey: 'templates.rs-sort.description',
    code: `fn main() {
    let mut nums = vec![3, 1, 4, 1, 5, 9, 2, 6];
    nums.sort();
    println!("{:?}", nums);

    let mut words = vec!["banana", "apple", "cherry"];
    words.sort();
    println!("{:?}", words);
}
`,
  },
  {
    id: 'rs-struct',
    language: 'rust',
    fileStem: 'Structs & Traits',
    labelKey: 'templates.rs-struct.label',
    descriptionKey: 'templates.rs-struct.description',
    code: `use std::fmt;

struct Point {
    x: f64,
    y: f64,
}

impl Point {
    fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    fn distance(&self, other: &Point) -> f64 {
        ((self.x - other.x).powi(2) + (self.y - other.y).powi(2)).sqrt()
    }
}

impl fmt::Display for Point {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "({}, {})", self.x, self.y)
    }
}

fn main() {
    let a = Point::new(0.0, 0.0);
    let b = Point::new(3.0, 4.0);
    println!("Distance from {} to {}: {}", a, b, a.distance(&b));
}
`,
  },

  // ── Ruby ─────────────────────────────────────────────────────────────────
  // RL-042 Slice 5 — starter set matching the JS/TS/Python pattern so the
  // language pack's `templateIds` contract has something to resolve once
  // Ruby flipped from validate-only to runnable.
  {
    id: 'rb-hello',
    language: 'ruby',
    fileStem: 'Hello World',
    labelKey: 'templates.rb-hello.label',
    descriptionKey: 'templates.rb-hello.description',
    code: `puts "Hello, World!"
`,
  },
  {
    id: 'rb-sort',
    language: 'ruby',
    fileStem: 'Sorting',
    labelKey: 'templates.rb-sort.label',
    descriptionKey: 'templates.rb-sort.description',
    code: `nums = [3, 1, 4, 1, 5, 9, 2, 6]

ascending = nums.sort
descending = nums.sort.reverse
by_evens_first = nums.sort_by { |n| [n.even? ? 0 : 1, n] }

puts "Ascending:  #{ascending.inspect}"
puts "Descending: #{descending.inspect}"
puts "Evens first: #{by_evens_first.inspect}"
`,
  },
  {
    id: 'rb-class',
    language: 'ruby',
    fileStem: 'Class',
    labelKey: 'templates.rb-class.label',
    descriptionKey: 'templates.rb-class.description',
    code: `class Student
  attr_reader :name, :grade, :courses

  def initialize(name, grade, courses = [])
    @name = name
    @grade = grade
    @courses = courses
  end

  def gpa_letter
    return 'A' if grade >= 90
    return 'B' if grade >= 80
    return 'C' if grade >= 70
    'F'
  end
end

alice = Student.new("Alice", 92.5, ["Math", "CS", "Physics"])
puts "#{alice.name}: #{alice.gpa_letter} (#{alice.grade})"
puts "Courses: #{alice.courses.join(', ')}"
`,
  },
];

export function getTemplatesForLanguage(language: Language): Template[] {
  return BUILT_IN_TEMPLATES.filter((template) => template.language === language);
}

/**
 * Generated file names intentionally stay stable and source-language based.
 * Phase 3 localizes visible UI copy, but filenames remain non-localized per
 * the internal delivery rules.
 */
export function resolveTemplateFileStem(template: Template): string {
  return template.fileStem;
}

/**
 * Resolve a template's user-facing label through the active i18n catalog.
 * Falls back to the template id when no translator is provided so legacy
 * surfaces that have not yet wired i18next still render a sensible string.
 */
export function resolveTemplateLabel(template: Template, t?: TFunction): string {
  if (!t) return template.fileStem;
  return t(template.labelKey) as unknown as string;
}

export function resolveTemplateDescription(template: Template, t?: TFunction): string {
  if (!t) return '';
  return t(template.descriptionKey) as unknown as string;
}
