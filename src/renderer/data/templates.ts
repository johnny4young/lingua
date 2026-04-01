import type { Language } from '../types';

export interface Template {
  id: string;
  language: Language;
  label: string;
  description: string;
  code: string;
}

export const BUILT_IN_TEMPLATES: Template[] = [
  // ── JavaScript ────────────────────────────────────────────────────────────
  {
    id: 'js-hello',
    language: 'javascript',
    label: 'Hello World',
    description: 'Print a greeting to the console',
    code: `console.log("Hello, World!");
`,
  },
  {
    id: 'js-fetch',
    language: 'javascript',
    label: 'Fetch HTTP',
    description: 'Fetch data from a public API',
    code: `const res = await fetch("https://jsonplaceholder.typicode.com/todos/1");
const todo = await res.json();
console.log(todo);
`,
  },
  {
    id: 'js-sort',
    language: 'javascript',
    label: 'Sorting Algorithms',
    description: 'QuickSort and MergeSort implementations',
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
    label: 'Class & OOP',
    description: 'ES2022 class with private fields',
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
    label: 'Hello World',
    description: 'Typed greeting function',
    code: `function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

console.log(greet("World"));
`,
  },
  {
    id: 'ts-generic',
    language: 'typescript',
    label: 'Generic Stack',
    description: 'Type-safe stack data structure',
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
    label: 'Sorting Algorithms',
    description: 'Generic QuickSort in TypeScript',
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
    label: 'Async / Await',
    description: 'Typed async functions with error handling',
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
    label: 'Hello World',
    description: 'Classic Go hello world',
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
    label: 'Goroutines & Channels',
    description: 'Concurrent fan-out with channels',
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
    label: 'Sorting',
    description: 'Sort a slice with the standard library',
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
    label: 'Hello World',
    description: 'Print a greeting',
    code: `print("Hello, World!")
`,
  },
  {
    id: 'py-list',
    language: 'python',
    label: 'List Comprehensions',
    description: 'Pythonic list processing',
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
    label: 'Sorting Algorithms',
    description: 'MergeSort implementation in Python',
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
    label: 'Dataclass',
    description: 'Python dataclass with type hints',
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
    label: 'Hello World',
    description: 'Classic Rust hello world',
    code: `fn main() {
    println!("Hello, World!");
}
`,
  },
  {
    id: 'rs-ownership',
    language: 'rust',
    label: 'Ownership & Borrowing',
    description: 'Demonstrates Rust ownership rules',
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
    label: 'Sorting',
    description: 'Sort a vector with the standard library',
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
    label: 'Structs & Traits',
    description: 'Implement Display trait on a struct',
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
];

/** Get templates for a specific language */
export function getTemplatesForLanguage(language: Language): Template[] {
  return BUILT_IN_TEMPLATES.filter((t) => t.language === language);
}
