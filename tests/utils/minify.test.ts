import { describe, expect, it } from 'vitest';
import { minifySource } from '@/utils/minify';

describe('minifySource (json)', () => {
  it('compacts well-formed JSON', () => {
    const result = minifySource('json', '{\n  "a": 1,\n  "b": [2, 3]\n}\n');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('{"a":1,"b":[2,3]}');
  });

  it('is a no-op on an empty string', () => {
    const result = minifySource('json', '');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('');
  });

  it('returns a parse-error result for invalid JSON', () => {
    const result = minifySource('json', '{ not: "json" }');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('parse-error');
  });

  it('round-trips beautify → minify → same minified output for fixture set', () => {
    const fixtures = [
      '{"a":1}',
      '{"users":[{"name":"a"},{"name":"b"}],"count":2}',
      '[]',
      '{}',
      '{"n":0,"b":true,"s":"hello","a":[1,2,3],"o":{"k":"v"}}',
    ];
    for (const fixture of fixtures) {
      const parsed = JSON.parse(fixture) as unknown;
      const beautified = JSON.stringify(parsed, null, 2);
      const reMinified = minifySource('json', beautified);
      expect(reMinified.ok).toBe(true);
      if (reMinified.ok) {
        expect(reMinified.output).toBe(fixture);
      }
    }
  });
});

describe('minifySource (javascript)', () => {
  it('strips single- and multi-line comments', () => {
    const result = minifySource(
      'javascript',
      '// comment\nconst x = 1; /* block */ const y = 2;\n'
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('const x=1;const y=2;');
  });

  it('preserves whitespace inside string literals exactly', () => {
    const source = 'const s = "a  b\\tc";';
    const result = minifySource('javascript', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('const s="a  b\\tc";');
  });

  it('preserves template literals verbatim', () => {
    const source = 'const t = `line 1\n  line 2`;';
    const result = minifySource('javascript', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('const t=`line 1\n  line 2`;');
  });

  it('collapses whitespace only between identifiers/keywords', () => {
    const result = minifySource('javascript', 'if (a ===  b) {\n  return 1;\n}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('if(a===b){return 1;}');
  });

  it('keeps a space between two identifiers (return 1)', () => {
    const result = minifySource('javascript', 'function f() {\n  return   42;\n}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('function f(){return 42;}');
  });

  it('drops a // inside a string literal correctly (no false comment)', () => {
    const source = 'const url = "https://example.com/";';
    const result = minifySource('javascript', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('const url="https://example.com/";');
  });

  it('preserves regex literals that contain // so they are not mistaken for comments', () => {
    const source = 'const re = /https?:\\/\\/[a-z]+/gi;';
    const result = minifySource('javascript', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('const re=/https?:\\/\\/[a-z]+/gi;');
  });

  it('keeps regex literals after return-like keywords intact', () => {
    const source = 'function hasFoo(value) {\n  return /foo/.test(value);\n}';
    const result = minifySource('javascript', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('function hasFoo(value){return/foo/.test(value);}');
  });

  it('handles an empty JS source', () => {
    const result = minifySource('javascript', '');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('');
  });
});

describe('minifySource (html)', () => {
  it('is a no-op on an empty string', () => {
    const result = minifySource('html', '');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('');
  });

  it('collapses consecutive whitespace in text to a single space', () => {
    const result = minifySource('html', '<p>hello   world</p>');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<p>hello world</p>');
  });

  it('drops whitespace that sits only between tag boundaries', () => {
    const result = minifySource(
      'html',
      '<div>\n  <span>hi</span>\n  <span>world</span>\n</div>'
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<div><span>hi</span><span>world</span></div>');
  });

  it('strips HTML comments from text content', () => {
    const result = minifySource('html', '<!-- intro --><p>hi</p><!-- outro -->');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<p>hi</p>');
  });

  it('strips IE conditional comments as a documented side effect', () => {
    // Conditional comments are plain <!-- ... --> syntactically; the MVP
    // strips them. This test pins the behavior so any future change is
    // deliberate.
    const result = minifySource(
      'html',
      '<!--[if IE]><p>legacy</p><![endif]--><p>modern</p>'
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<p>modern</p>');
  });

  it('preserves whitespace inside <pre> byte-for-byte', () => {
    const source = '<pre>  indented\n    further\n</pre>';
    const result = minifySource('html', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe(source);
  });

  it('preserves <script> content verbatim including comments', () => {
    const source = '<script>\n  // keep me\n  const x = 1;\n  /* also */\n</script>';
    const result = minifySource('html', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe(source);
  });

  it('preserves <style> content verbatim', () => {
    const source = '<style>\n  .x {\n    color: red;\n  }\n</style>';
    const result = minifySource('html', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe(source);
  });

  it('preserves <textarea> content verbatim', () => {
    const source = '<textarea>line 1\n  line 2</textarea>';
    const result = minifySource('html', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe(source);
  });

  it('keeps multi-space attribute values inside quotes exact', () => {
    const result = minifySource('html', '<a title="hello   world">click</a>');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<a title="hello   world">click</a>');
  });

  it('collapses whitespace between attributes but preserves quoted values', () => {
    const result = minifySource(
      'html',
      '<input   type="text"    value="a  b"   required>'
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toBe('<input type="text" value="a  b" required>');
    }
  });

  it('handles self-closing tags without entering preserve mode', () => {
    const result = minifySource('html', '<br/><br /><img src="a.png"/>');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<br/><br /><img src="a.png"/>');
  });

  it('tolerates malformed input (unclosed tag) without throwing', () => {
    const result = minifySource('html', '<div>hello');
    // Minifier is lenient — it just emits whatever it saw. No error.
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<div>hello');
  });

  it('keeps the DOCTYPE intact', () => {
    const result = minifySource(
      'html',
      '<!DOCTYPE html>\n<html>\n  <body>hi</body>\n</html>'
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<!DOCTYPE html><html><body>hi</body></html>');
  });

  it('does not choke on a </script> that appears inside nested content', () => {
    // Inside a <script>, the literal "</script>" terminates the block even
    // when it lives in a string — this matches the HTML spec. The test pins
    // the behavior so callers know the lenient contract.
    const source = '<script>const s = "</script>";</script>';
    const result = minifySource('html', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe(source);
  });

  it('collapses whitespace before the > in a preserve-element closing tag', () => {
    // Rare but spec-legal: `</script >` with a space before `>`. Tag-mode
    // trims any trailing whitespace when emitting `>`, so the closing tag
    // tightens to `</script>` — the canonical form. Pins the behavior so
    // any future reintroduction of the stray space is deliberate.
    const source = '<script>const x = 1;</script >';
    const result = minifySource('html', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<script>const x = 1;</script>');
  });
});

describe('minifySource (css)', () => {
  it('is a no-op on an empty string', () => {
    const result = minifySource('css', '');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('');
  });

  it('strips /* */ block comments', () => {
    const result = minifySource('css', '/* leading */ .x { color: red; } /* trailing */');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('.x{color:red}');
  });

  it('collapses whitespace around structural chars', () => {
    const result = minifySource('css', '.x , .y   {\n  color :  red ;\n  padding:  1px   2px ;\n}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('.x,.y{color:red;padding:1px 2px}');
  });

  it('drops the trailing semicolon before a closing brace', () => {
    const result = minifySource('css', '.x { color: red; }');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('.x{color:red}');
  });

  it('preserves whitespace inside double-quoted strings', () => {
    const result = minifySource('css', '.x { content: "  keep  spaces  "; }');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('.x{content:"  keep  spaces  "}');
  });

  it('preserves whitespace inside single-quoted strings', () => {
    const result = minifySource('css', ".x { content: '  quoted  '; }");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe(".x{content:'  quoted  '}");
  });

  it('preserves escaped quotes inside strings', () => {
    const result = minifySource('css', '.x { content: "a\\"b"; }');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('.x{content:"a\\"b"}');
  });

  it('preserves unquoted url() content byte-for-byte', () => {
    const result = minifySource('css', '.x { background: url(path with space.png); }');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('.x{background:url(path with space.png)}');
  });

  it('preserves quoted url() content', () => {
    const result = minifySource('css', '.x { background: url( "path.png" ); }');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('.x{background:url("path.png")}');
  });

  it('preserves a data-URI inside url()', () => {
    const source =
      '.x { background: url("data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22></svg>"); }';
    const result = minifySource('css', source);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toBe(
        '.x{background:url("data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22></svg>")}'
      );
    }
  });

  it('handles @media + @keyframes block nesting', () => {
    const result = minifySource(
      'css',
      '@media (min-width: 600px) {\n  .x { color: red; }\n  .y { color: blue; }\n}'
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toBe('@media (min-width:600px){.x{color:red}.y{color:blue}}');
    }
  });

  it('is lenient on an unclosed block comment (runs to EOF without throwing)', () => {
    const result = minifySource('css', '.x { /* never closes }');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('.x{');
  });
});

describe('minifySource (xml)', () => {
  it('is a no-op on an empty string', () => {
    const result = minifySource('xml', '');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('');
  });

  it('strips XML comments', () => {
    const result = minifySource(
      'xml',
      '<!-- note --><root><child>hi</child><!-- inner --></root>'
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<root><child>hi</child></root>');
  });

  it('collapses whitespace between tags', () => {
    const result = minifySource(
      'xml',
      '<root>\n  <child>\n    hi\n  </child>\n</root>'
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<root><child>hi</child></root>');
  });

  it('preserves CDATA content byte-for-byte', () => {
    const source = '<root><![CDATA[  keep <tags> & "quotes"  ]]></root>';
    const result = minifySource('xml', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe(source);
  });

  it('preserves processing instructions including the XML declaration', () => {
    const source = '<?xml version="1.0" encoding="UTF-8"?>\n<root/>';
    const result = minifySource('xml', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<?xml version="1.0" encoding="UTF-8"?><root/>');
  });

  it('preserves attribute values with whitespace', () => {
    const result = minifySource('xml', '<root  title="hello  world"  >content</root>');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<root title="hello  world">content</root>');
  });

  it('handles self-closing tags', () => {
    const result = minifySource('xml', '<root>\n  <child/>\n  <other />\n</root>');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<root><child/><other /></root>');
  });

  it('preserves single-quoted attributes with whitespace inside', () => {
    const result = minifySource('xml', "<root title='  ok  '/>");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe("<root title='  ok  '/>");
  });

  it('preserves an inline <![CDATA[]]> that contains a literal ]] sequence', () => {
    // CDATA can only end on `]]>`, so a lone `]]` inside survives.
    const source = '<root><![CDATA[a ]] b]]></root>';
    const result = minifySource('xml', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe(source);
  });

  it('is lenient on malformed input (unclosed tag runs to EOF)', () => {
    const result = minifySource('xml', '<root>hello');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<root>hello');
  });
});
