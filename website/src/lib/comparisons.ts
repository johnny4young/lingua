import type { Locale } from '~/lib/i18n';

/**
 * SR-42 — honest head-to-head comparison pages. High-intent SEO ("X
 * alternative") with a capability matrix and a genuine "when to choose the
 * other tool" section, because a comparison that pretends the competitor has
 * no strengths reads as marketing and converts worse than an honest one.
 *
 * Every Lingua claim here is verifiable in the shipping app; every competitor
 * claim reflects their public positioning as of July 2026. Keep it accurate —
 * a wrong claim on a compare page is the fastest way to lose a skeptical
 * buyer.
 */

export type Verdict = 'yes' | 'no' | 'partial';

export interface CompareRow {
  feature: Record<Locale, string>;
  lingua: Verdict;
  linguaNote?: Record<Locale, string>;
  other: Verdict;
  otherNote?: Record<Locale, string>;
}

export interface Comparison {
  slug: string;
  /** Competitor display name. */
  competitor: string;
  /** Short descriptor of what the competitor is. */
  what: Record<Locale, string>;
  title: Record<Locale, string>;
  metaDescription: Record<Locale, string>;
  /** One-paragraph honest framing at the top. */
  intro: Record<Locale, string>;
  rows: CompareRow[];
  /** Honest "pick the other tool when…" bullets. */
  chooseOther: Record<Locale, string[]>;
  /** "pick Lingua when…" bullets. */
  chooseLingua: Record<Locale, string[]>;
}

const COMPARISONS: Comparison[] = [
  {
    slug: 'runjs',
    competitor: 'RunJS',
    what: {
      en: 'a mature JavaScript/TypeScript playground for the desktop',
      es: 'un playground maduro de JavaScript/TypeScript para escritorio',
    },
    title: {
      en: 'Lingua vs RunJS',
      es: 'Lingua vs RunJS',
    },
    metaDescription: {
      en: 'RunJS is a focused JS/TS playground. Lingua runs five languages with a real desktop Node runtime, SQL and HTTP workspaces, 31 utilities, and local-first AI. An honest side-by-side.',
      es: 'RunJS es un playground enfocado en JS/TS. Lingua ejecuta cinco lenguajes con un runtime Node de escritorio real, workspaces SQL y HTTP, 31 utilidades e IA local-first. Un comparativo honesto.',
    },
    intro: {
      en: 'RunJS pioneered the instant-feedback JS scratchpad and it is still one of the best at exactly that. Lingua is a broader local-first lab: the same scratchpad feel, plus four more languages, SQL and HTTP workspaces, a utility shelf, and AI that runs on a local model. If you only touch JavaScript, RunJS is a fine, focused pick. If your day crosses languages, keep reading.',
      es: 'RunJS fue pionero del scratchpad de JS con feedback instantáneo y sigue siendo de los mejores en exactamente eso. Lingua es un laboratorio local-first más amplio: la misma sensación de scratchpad, más cuatro lenguajes adicionales, workspaces SQL y HTTP, un estante de utilidades e IA que corre en un modelo local. Si solo tocas JavaScript, RunJS es una elección enfocada y buena. Si tu día cruza lenguajes, sigue leyendo.',
    },
    rows: [
      {
        feature: { en: 'JavaScript & TypeScript scratchpad', es: 'Scratchpad de JavaScript y TypeScript' },
        lingua: 'yes',
        other: 'yes',
        otherNote: { en: 'the original strength', es: 'su fortaleza original' },
      },
      {
        feature: { en: 'Node runtime with require() of npm', es: 'Runtime Node con require() de npm' },
        lingua: 'yes',
        linguaNote: { en: 'desktop, from your project node_modules', es: 'desktop, desde los node_modules de tu proyecto' },
        other: 'yes',
      },
      {
        feature: { en: 'Python, Go, Rust, Ruby runners', es: 'Runners de Python, Go, Rust, Ruby' },
        lingua: 'yes',
        other: 'no',
      },
      {
        feature: { en: 'SQL workspace (DuckDB) & HTTP client', es: 'Workspace SQL (DuckDB) y cliente HTTP' },
        lingua: 'yes',
        other: 'no',
      },
      {
        feature: { en: 'Built-in developer utilities', es: 'Utilidades de desarrollo integradas' },
        lingua: 'yes',
        linguaNote: { en: '31 panels', es: '31 paneles' },
        other: 'no',
      },
      {
        feature: { en: 'AI assistance', es: 'Asistencia con IA' },
        lingua: 'yes',
        linguaNote: { en: 'runs on a local model, BYO-key', es: 'corre en un modelo local, con tu clave' },
        other: 'partial',
        otherNote: { en: 'cloud AI chat', es: 'chat de IA en la nube' },
      },
      {
        feature: { en: 'Runs in a browser, no install', es: 'Corre en el navegador, sin instalar' },
        lingua: 'yes',
        other: 'no',
      },
      {
        feature: { en: 'Notebooks with a shared kernel', es: 'Notebooks con kernel compartido' },
        lingua: 'yes',
        other: 'no',
      },
    ],
    chooseOther: {
      en: [
        'You only ever write JavaScript or TypeScript and want the most focused tool for exactly that.',
        'You rely on a specific RunJS workflow detail you already know by heart.',
      ],
      es: [
        'Solo escribes JavaScript o TypeScript y quieres la herramienta más enfocada en exactamente eso.',
        'Dependes de un detalle específico del flujo de RunJS que ya conoces de memoria.',
      ],
    },
    chooseLingua: {
      en: [
        'Your work crosses languages — a Python function today, a Go benchmark tomorrow.',
        'You want SQL, an HTTP client, and 31 utilities in the same window as your code.',
        'You want AI that never sends your code to a cloud you did not choose.',
      ],
      es: [
        'Tu trabajo cruza lenguajes — una función Python hoy, un benchmark de Go mañana.',
        'Quieres SQL, un cliente HTTP y 31 utilidades en la misma ventana que tu código.',
        'Quieres IA que nunca envía tu código a una nube que no elegiste.',
      ],
    },
  },
  {
    slug: 'postman',
    competitor: 'Postman',
    what: {
      en: 'the incumbent cloud-first API platform',
      es: 'la plataforma de APIs cloud-first dominante',
    },
    title: {
      en: 'Lingua vs Postman',
      es: 'Lingua vs Postman',
    },
    metaDescription: {
      en: "Postman is a cloud API platform. Lingua's HTTP workspace is local-first, imports your Postman collections, and lives beside a five-language code runner. When a local client is enough.",
      es: 'Postman es una plataforma de APIs en la nube. El workspace HTTP de Lingua es local-first, importa tus colecciones de Postman y vive junto a un runner de cinco lenguajes. Cuándo basta un cliente local.',
    },
    intro: {
      en: "Postman is a deep, team-oriented API platform — monitors, mock servers, cloud collaboration, an enterprise governance surface. Lingua is not trying to replace that. Lingua's HTTP workspace is for the developer who wants to compose and send requests locally, without a mandatory account, right next to the code that consumes the API. It imports your existing Postman and Bruno collections, so trying it costs nothing.",
      es: 'Postman es una plataforma de APIs profunda y orientada a equipos — monitores, mock servers, colaboración en la nube, una superficie de gobernanza enterprise. Lingua no intenta reemplazar eso. El workspace HTTP de Lingua es para el developer que quiere componer y enviar requests localmente, sin cuenta obligatoria, justo al lado del código que consume el API. Importa tus colecciones existentes de Postman y Bruno, así que probarlo no cuesta nada.',
    },
    rows: [
      {
        feature: { en: 'Compose & send HTTP requests', es: 'Componer y enviar requests HTTP' },
        lingua: 'yes',
        other: 'yes',
      },
      {
        feature: { en: 'Works without a cloud account', es: 'Funciona sin cuenta en la nube' },
        lingua: 'yes',
        linguaNote: { en: 'local-first, no sign-in', es: 'local-first, sin login' },
        other: 'no',
      },
      {
        feature: { en: 'Import Postman / Bruno collections', es: 'Importar colecciones Postman / Bruno' },
        lingua: 'yes',
        other: 'yes',
      },
      {
        feature: { en: 'Environments & request chaining', es: 'Environments y encadenamiento de requests' },
        lingua: 'yes',
        linguaNote: { en: 'secret-aware variables, response capture', es: 'variables secret-aware, captura de respuestas' },
        other: 'yes',
      },
      {
        feature: { en: 'Also runs code in five languages', es: 'También ejecuta código en cinco lenguajes' },
        lingua: 'yes',
        other: 'no',
      },
      {
        feature: { en: 'SQL workspace & 31 utilities', es: 'Workspace SQL y 31 utilidades' },
        lingua: 'yes',
        other: 'no',
      },
      {
        feature: { en: 'Cloud monitors & mock servers', es: 'Monitores y mock servers en la nube' },
        lingua: 'no',
        other: 'yes',
        otherNote: { en: 'a core Postman strength', es: 'una fortaleza central de Postman' },
      },
      {
        feature: { en: 'Team cloud workspaces & governance', es: 'Workspaces de equipo en la nube y gobernanza' },
        lingua: 'no',
        other: 'yes',
      },
      {
        feature: { en: 'Price for one developer', es: 'Precio para un developer' },
        lingua: 'yes',
        linguaNote: { en: 'HTTP workspace is free', es: 'el workspace HTTP es gratis' },
        other: 'partial',
        otherNote: { en: 'Free capped at 1 user (2026)', es: 'Free limitado a 1 usuario (2026)' },
      },
    ],
    chooseOther: {
      en: [
        'You run a team that needs shared cloud workspaces, monitors, or mock servers.',
        'You depend on Postman’s enterprise governance, SSO, or its huge integration ecosystem.',
        'API testing is your whole job, not one task among many.',
      ],
      es: [
        'Diriges un equipo que necesita workspaces compartidos en la nube, monitores o mock servers.',
        'Dependes de la gobernanza enterprise de Postman, SSO o su enorme ecosistema de integraciones.',
        'El testing de APIs es todo tu trabajo, no una tarea entre muchas.',
      ],
    },
    chooseLingua: {
      en: [
        'You want to hit an endpoint without creating an account or syncing to a cloud.',
        'You want the API client beside the code that calls it, plus SQL and utilities.',
        'Postman’s new pricing pushed your solo or small-team use out of the free tier.',
      ],
      es: [
        'Quieres pegarle a un endpoint sin crear cuenta ni sincronizar a una nube.',
        'Quieres el cliente de API junto al código que lo llama, más SQL y utilidades.',
        'El nuevo pricing de Postman sacó tu uso solo o de equipo pequeño del tier gratuito.',
      ],
    },
  },
  {
    slug: 'devutils',
    competitor: 'DevUtils',
    what: {
      en: 'a polished macOS-only utility belt',
      es: 'un cinturón de utilidades pulido, solo para macOS',
    },
    title: {
      en: 'Lingua vs DevUtils',
      es: 'Lingua vs DevUtils',
    },
    metaDescription: {
      en: 'DevUtils is a native macOS toolbox. Lingua ships 31 of the same utilities plus a five-language code runner, SQL and HTTP workspaces, and cross-platform builds. When you also need to run code.',
      es: 'DevUtils es una caja de herramientas nativa de macOS. Lingua incluye 31 de las mismas utilidades más un runner de cinco lenguajes, workspaces SQL y HTTP, y builds multiplataforma. Cuándo también necesitas ejecutar código.',
    },
    intro: {
      en: 'DevUtils is a lovely native macOS utility belt — fast, menu-bar-close, offline. Lingua includes 31 of the same tools (JSON, JWT, hash, Base64, regex, cron, color, and the rest), but they sit next to something DevUtils does not have: an actual code runner for five languages, a SQL workspace, and an HTTP client. If you never need to run code and you live on a Mac, DevUtils is great. If you do, one window can cover both.',
      es: 'DevUtils es un lindo cinturón de utilidades nativo de macOS — rápido, cerca de la barra de menú, offline. Lingua incluye 31 de las mismas herramientas (JSON, JWT, hash, Base64, regex, cron, color y las demás), pero conviven con algo que DevUtils no tiene: un runner de código real para cinco lenguajes, un workspace SQL y un cliente HTTP. Si nunca necesitas ejecutar código y vives en un Mac, DevUtils es genial. Si sí, una sola ventana cubre ambos.',
    },
    rows: [
      {
        feature: { en: 'Formatter / encoder / inspector utilities', es: 'Utilidades de formato / codificación / inspección' },
        lingua: 'yes',
        linguaNote: { en: '31 panels', es: '31 paneles' },
        other: 'yes',
      },
      {
        feature: { en: 'Fully offline', es: 'Completamente offline' },
        lingua: 'yes',
        other: 'yes',
      },
      {
        feature: { en: 'Runs code in five languages', es: 'Ejecuta código en cinco lenguajes' },
        lingua: 'yes',
        other: 'no',
      },
      {
        feature: { en: 'SQL workspace & HTTP client', es: 'Workspace SQL y cliente HTTP' },
        lingua: 'yes',
        other: 'no',
      },
      {
        feature: { en: 'Windows, Linux & browser', es: 'Windows, Linux y navegador' },
        lingua: 'yes',
        other: 'no',
        otherNote: { en: 'macOS only', es: 'solo macOS' },
      },
      {
        feature: { en: 'Native menu-bar quick access', es: 'Acceso rápido nativo desde la barra de menú' },
        lingua: 'no',
        other: 'yes',
        otherNote: { en: 'a DevUtils strength', es: 'una fortaleza de DevUtils' },
      },
    ],
    chooseOther: {
      en: [
        'You are macOS-only and want a native, menu-bar-resident utility belt.',
        'You never need to actually run code — just format, decode, and inspect.',
      ],
      es: [
        'Eres solo de macOS y quieres un cinturón de utilidades nativo residente en la barra de menú.',
        'Nunca necesitas ejecutar código — solo formatear, decodificar e inspeccionar.',
      ],
    },
    chooseLingua: {
      en: [
        'You want the utilities and a real code runner in the same app.',
        'You work on Windows or Linux, or want to try it in a browser first.',
        'You want your utilities to hand off into runnable code, SQL, or an HTTP request.',
      ],
      es: [
        'Quieres las utilidades y un runner de código real en la misma app.',
        'Trabajas en Windows o Linux, o quieres probarlo primero en un navegador.',
        'Quieres que tus utilidades pasen a código ejecutable, SQL o una request HTTP.',
      ],
    },
  },
  {
    slug: 'coderunner',
    competitor: 'CodeRunner',
    what: {
      en: 'a native macOS multi-language editor',
      es: 'un editor multi-lenguaje nativo de macOS',
    },
    title: {
      en: 'Lingua vs CodeRunner',
      es: 'Lingua vs CodeRunner',
    },
    metaDescription: {
      en: 'CodeRunner runs 25 languages through your local toolchain on macOS. Lingua sandboxes its runners, shows inline values and per-line timing, and ships on Windows, Linux, and the web too.',
      es: 'CodeRunner ejecuta 25 lenguajes a través de tu toolchain local en macOS. Lingua aísla sus runners, muestra valores inline y timing por línea, y también corre en Windows, Linux y la web.',
    },
    intro: {
      en: "CodeRunner is a fast native macOS editor that runs 25 languages by shelling out to whatever toolchains you have installed. Lingua takes a different bet: fewer languages, but sandboxed runners with observability baked in — inline values next to every line, per-line timing, and a queryable run ledger — and it runs on Windows, Linux, and in a browser, not just macOS. Different tools for different priorities.",
      es: 'CodeRunner es un editor nativo de macOS rápido que ejecuta 25 lenguajes llamando a las toolchains que tengas instaladas. Lingua hace una apuesta distinta: menos lenguajes, pero runners aislados con observabilidad incorporada — valores inline junto a cada línea, timing por línea y un run ledger consultable — y corre en Windows, Linux y un navegador, no solo macOS. Herramientas distintas para prioridades distintas.',
    },
    rows: [
      {
        feature: { en: 'Number of runnable languages', es: 'Número de lenguajes ejecutables' },
        lingua: 'partial',
        linguaNote: { en: 'five, deeply integrated', es: 'cinco, integrados a fondo' },
        other: 'yes',
        otherNote: { en: '25 via your toolchain', es: '25 vía tu toolchain' },
      },
      {
        feature: { en: 'Inline values & per-line timing', es: 'Valores inline y timing por línea' },
        lingua: 'yes',
        other: 'no',
      },
      {
        feature: { en: 'Sandboxed execution', es: 'Ejecución aislada' },
        lingua: 'yes',
        linguaNote: { en: 'allow-listed env, no shell', es: 'entorno restringido, sin shell' },
        other: 'partial',
        otherNote: { en: 'runs on your machine directly', es: 'corre en tu máquina directamente' },
      },
      {
        feature: { en: 'Queryable run history (Run Ledger)', es: 'Historial de runs consultable (Run Ledger)' },
        lingua: 'yes',
        other: 'no',
      },
      {
        feature: { en: 'SQL workspace, HTTP client, utilities', es: 'Workspace SQL, cliente HTTP, utilidades' },
        lingua: 'yes',
        other: 'no',
      },
      {
        feature: { en: 'Windows, Linux & browser', es: 'Windows, Linux y navegador' },
        lingua: 'yes',
        other: 'no',
        otherNote: { en: 'macOS only', es: 'solo macOS' },
      },
      {
        feature: { en: 'Native macOS editor feel', es: 'Sensación de editor nativo de macOS' },
        lingua: 'partial',
        other: 'yes',
        otherNote: { en: 'a CodeRunner strength', es: 'una fortaleza de CodeRunner' },
      },
    ],
    chooseOther: {
      en: [
        'You are macOS-only and want the widest possible language count out of the box.',
        'You want a native-feeling Mac editor and already have every toolchain installed.',
        'You need debugging across a dozen languages today.',
      ],
      es: [
        'Eres solo de macOS y quieres la mayor cantidad de lenguajes posible de fábrica.',
        'Quieres un editor con sensación nativa de Mac y ya tienes cada toolchain instalada.',
        'Necesitas debugging en una docena de lenguajes hoy.',
      ],
    },
    chooseLingua: {
      en: [
        'You want to see values and timing without adding a single log line.',
        'You work across macOS, Windows, Linux, or want a browser demo with no install.',
        'You want SQL, HTTP, utilities, and a queryable run history in the same app.',
      ],
      es: [
        'Quieres ver valores y timing sin agregar una sola línea de log.',
        'Trabajas entre macOS, Windows, Linux, o quieres una demo en navegador sin instalar.',
        'Quieres SQL, HTTP, utilidades y un historial de runs consultable en la misma app.',
      ],
    },
  },
];

export function allComparisons(): Comparison[] {
  return COMPARISONS;
}

export function comparisonBySlug(slug: string): Comparison | undefined {
  return COMPARISONS.find(entry => entry.slug === slug);
}
