/**
 * implementation — offline, rule-based runtime-error explainer.
 *
 * Turns a raw runner error message into a plain-language explanation plus
 * a few concrete fix hints, entirely locally — no network, no model, no
 * user code leaving the machine. This is the shippable v1 of the "explain
 * this error" surface reserved under the `LOCAL_AI` entitlement; a future
 * future work can swap in an on-device model behind the same `explainError`
 * contract (the return shape is provider-agnostic on purpose).
 *
 * Pure and dependency-free so it is exhaustively unit-testable and can run
 * in the renderer, the web build, or vitest without any host bridge. The
 * explanation text is deliberately kept in English technical register —
 * the same policy the repo applies to code samples and raw runtime errors
 * (see the i18n contributor notes); only the UI wrapper around it is
 * localized.
 */

export interface ErrorExplanation {
  /** `true` when a specific rule matched; `false` for the generic fallback. */
  matched: boolean;
  /** Short headline naming the error class in human terms. */
  title: string;
  /** One or two sentences on what went wrong and why. */
  explanation: string;
  /** Concrete, ordered things to check or try. */
  hints: readonly string[];
}

export interface ExplainErrorInput {
  message: string;
  /** Language id (e.g. `javascript`, `typescript`, `python`, `ruby`). */
  language?: string;
}

interface Rule {
  /** Languages this rule applies to; empty = any language. */
  languages: readonly string[];
  test: RegExp;
  build: (match: RegExpMatchArray) => Omit<ErrorExplanation, 'matched'>;
}

function inLang(language: string | undefined, langs: readonly string[]): boolean {
  if (langs.length === 0) return true;
  if (!language) return false;
  return langs.includes(language);
}

const JS = ['javascript', 'typescript'] as const;

const RULES: readonly Rule[] = [
  {
    languages: JS,
    test: /(\w[\w$]*) is not defined/,
    build: (m) => ({
      title: `\`${m[1]}\` is not defined`,
      explanation: `The name \`${m[1]}\` is used before it exists in scope. It was never declared, is misspelled, or is defined in another module that was not imported.`,
      hints: [
        `Check the spelling and capitalization of \`${m[1]}\`.`,
        `If it comes from another file or package, add the missing import.`,
        `If it should be a string, wrap it in quotes.`,
      ],
    }),
  },
  {
    languages: JS,
    test: /Cannot read propert(?:y|ies) (?:'([^']+)'|of) .*(?:of )?(undefined|null)/,
    build: (m) => ({
      title: `Reading a property of ${m[2]}`,
      explanation: `You accessed ${m[1] ? `\`.${m[1]}\`` : 'a property'} on a value that is \`${m[2]}\`. The variable or expression before the dot did not hold an object at that moment.`,
      hints: [
        'Log the value just before the failing line to see why it is empty.',
        m[1] ? `Guard with optional chaining: \`obj?.${m[1]}\`.` : 'Guard with optional chaining (`obj?.prop`).',
        'Ensure any async value has resolved before you read from it.',
      ],
    }),
  },
  {
    languages: JS,
    test: /(\w[\w$.]*) is not a function/,
    build: (m) => ({
      title: `\`${m[1]}\` is not a function`,
      explanation: `\`${m[1]}\` exists but is not callable — it is likely a different type (object, undefined, a value), or the name shadows the function you meant.`,
      hints: [
        `Confirm \`${m[1]}\` is actually a function where you call it.`,
        'Check for a typo in the method name or a wrong import.',
        'If it is a class, remember to use `new`.',
      ],
    }),
  },
  {
    languages: JS,
    test: /Maximum call stack size exceeded/,
    build: () => ({
      title: 'Infinite recursion (stack overflow)',
      explanation: 'A function called itself (directly or through a cycle) without ever reaching a base case, so the call stack filled up.',
      hints: [
        'Add a base case that returns without recursing.',
        'Verify the recursive call moves toward the base case each time.',
        'Watch for two functions that call each other in a loop.',
      ],
    }),
  },
  {
    languages: JS,
    test: /await is only valid in async function|Unexpected reserved word 'await'/,
    build: () => ({
      title: '`await` used outside an async function',
      explanation: '`await` can only appear inside an `async` function (or at the top level of a module).',
      hints: [
        'Mark the enclosing function `async`.',
        'Or use the promise directly with `.then(...)`.',
      ],
    }),
  },
  {
    languages: JS,
    test: /Unexpected (?:token|end of input|identifier)/,
    build: () => ({
      title: 'Syntax error',
      explanation: 'The parser hit something it did not expect — usually a missing or extra bracket, parenthesis, comma, or quote.',
      hints: [
        'Check the line the error points to and the one just above it.',
        'Look for an unbalanced `{ }`, `( )`, or `[ ]`.',
        'Make sure strings are closed with matching quotes.',
      ],
    }),
  },
  {
    languages: ['python'],
    test: /NameError: name '([^']+)' is not defined/,
    build: (m) => ({
      title: `\`${m[1]}\` is not defined`,
      explanation: `Python could not find a variable or function named \`${m[1]}\`. It is undefined at this point, misspelled, or defined in a module you did not import.`,
      hints: [
        `Check the spelling of \`${m[1]}\`.`,
        'Make sure it is assigned before this line runs.',
        'If it comes from a module, add the `import`.',
      ],
    }),
  },
  {
    languages: ['python'],
    test: /ModuleNotFoundError: No module named '([^']+)'/,
    build: (m) => ({
      title: `Module \`${m[1]}\` not found`,
      explanation: `Python could not import \`${m[1]}\` — it is not installed in this environment or the name is wrong.`,
      hints: [
        `Install it (in Lingua, use the Dependencies panel; elsewhere \`pip install ${m[1]}\`).`,
        'Check for a typo in the module name.',
      ],
    }),
  },
  {
    languages: ['python'],
    test: /IndentationError|TabError/,
    build: () => ({
      title: 'Indentation error',
      explanation: 'Python uses indentation to define blocks. A line is indented inconsistently, or mixes tabs and spaces.',
      hints: [
        'Use 4 spaces per level consistently — do not mix tabs and spaces.',
        'Check the block under the last `:` (if / for / def / class).',
      ],
    }),
  },
  {
    languages: ['python'],
    test: /ZeroDivisionError/,
    build: () => ({
      title: 'Division by zero',
      explanation: 'A number was divided (or modulo-d) by zero, which is undefined.',
      hints: ['Guard the denominator: check it is non-zero before dividing.'],
    }),
  },
  {
    languages: ['python'],
    test: /(IndexError|KeyError)/,
    build: (m) => ({
      title: m[1] === 'KeyError' ? 'Missing dictionary key' : 'Index out of range',
      explanation:
        m[1] === 'KeyError'
          ? 'You looked up a key that is not in the dictionary.'
          : 'You indexed a list/sequence past its last element.',
      hints:
        m[1] === 'KeyError'
          ? ['Use `dict.get(key)` for a safe lookup, or check `key in dict` first.']
          : ['Check the length before indexing; remember indexes are 0-based.'],
    }),
  },
  {
    languages: ['ruby'],
    test: /undefined method [`']([^']+)'/,
    build: (m) => ({
      title: `Undefined method \`${m[1]}\``,
      explanation: `Ruby could not find a method named \`${m[1]}\` on the receiver — it is misspelled, called on the wrong object, or \`nil\`.`,
      hints: [
        `Check the spelling of \`${m[1]}\` and the object you call it on.`,
        'If the receiver may be `nil`, use `&.` (safe navigation).',
      ],
    }),
  },
  {
    languages: ['ruby'],
    test: /undefined local variable or method [`']([^']+)'/,
    build: (m) => ({
      title: `\`${m[1]}\` is not defined`,
      explanation: `Ruby treated \`${m[1]}\` as a local variable or method it cannot find.`,
      hints: [`Assign \`${m[1]}\` before use, or check for a typo.`],
    }),
  },
];

/**
 * Explain a runtime error. Always returns an explanation — falls back to
 * a generic, still-useful message when no specific rule matches.
 */
export function explainError(input: ExplainErrorInput): ErrorExplanation {
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  if (message.length === 0) {
    return {
      matched: false,
      title: 'No error message',
      explanation: 'There was no error text to analyze.',
      hints: ['Run the code again and try once an error is produced.'],
    };
  }

  for (const rule of RULES) {
    if (!inLang(input.language, rule.languages)) continue;
    const match = message.match(rule.test);
    if (match) {
      return { matched: true, ...rule.build(match) };
    }
  }

  return {
    matched: false,
    title: 'Runtime error',
    explanation:
      'This error was not recognized by the built-in patterns, but the message usually names the failing operation and the line it happened on.',
    hints: [
      'Read the first line of the error — it names the error type.',
      'Follow the top stack frame to the exact line in your code.',
      'Search the exact message text for known causes.',
    ],
  };
}

/** Render an explanation as a plain-text block for the console. */
export function formatExplanation(explanation: ErrorExplanation): string {
  const lines = [explanation.title, '', explanation.explanation];
  if (explanation.hints.length > 0) {
    lines.push('');
    for (const hint of explanation.hints) lines.push(`• ${hint}`);
  }
  return lines.join('\n');
}
