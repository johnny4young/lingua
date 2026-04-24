import { describe, expect, it } from 'vitest';
import { minifySource } from '@/utils/minify';

describe('minifySource (json)', () => {
  it('compacts well-formed JSON', async () => {
    const result = await minifySource('json', '{\n  "a": 1,\n  "b": [2, 3]\n}\n');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('{"a":1,"b":[2,3]}');
  });

  it('is a no-op on an empty string', async () => {
    const result = await minifySource('json', '');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('');
  });

  it('returns a parse-error result for invalid JSON', async () => {
    const result = await minifySource('json', '{ not: "json" }');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('parse-error');
  });

  it('round-trips beautify → minify → same minified output for fixture set', async () => {
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
      const reMinified = await minifySource('json', beautified);
      expect(reMinified.ok).toBe(true);
      if (reMinified.ok) {
        expect(reMinified.output).toBe(fixture);
      }
    }
  });
});

describe('minifySource (javascript, via terser)', () => {
  // terser is a real minifier — it mangles names, eliminates dead code,
  // and compacts expressions. The tests below assert behavioral
  // properties (comments stripped, string / regex content preserved,
  // output parses back to equivalent values) rather than exact output
  // bytes, which would drift with every terser release.

  it('is a no-op on an empty JS source', async () => {
    const result = await minifySource('javascript', '');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('');
  });

  it('strips both line and block comments', async () => {
    const result = await minifySource(
      'javascript',
      '// keep nothing\nexport const x = 1; /* nor this */ export const y = 2;\n',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).not.toContain('keep nothing');
    expect(result.output).not.toContain('nor this');
    // Real bindings survive because they're exported.
    expect(result.output).toContain('const');
    expect(result.output).toContain('1');
    expect(result.output).toContain('2');
  });

  it('preserves whitespace inside string literals exactly', async () => {
    const result = await minifySource(
      'javascript',
      'export const s = "a  b\\tc";',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The literal value survives the sign/sign-pass; we assert on the
      // interior spacing rather than the whole line.
      expect(result.output).toContain('"a  b\\tc"');
    }
  });

  it('preserves template literal content — both lines survive minification', async () => {
    // Terser is free to normalize template literals with no
    // interpolation into regular quoted strings (a size win), and to
    // escape real newlines as `\n`. We only assert the two content
    // lines appear somewhere in the output.
    const result = await minifySource(
      'javascript',
      'export const t = `line 1\n  line 2`;',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toContain('line 1');
      expect(result.output).toContain('line 2');
    }
  });

  it('keeps // inside a string literal from being treated as a comment', async () => {
    const result = await minifySource(
      'javascript',
      'export const url = "https://example.com/";',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toContain('"https://example.com/"');
    }
  });

  it('preserves regex literals that contain // so they are not mistaken for comments', async () => {
    const result = await minifySource(
      'javascript',
      'export const re = /https?:\\/\\/[a-z]+/gi;',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toMatch(/\/https\?:\\\/\\\/\[a-z\]\+\/gi/);
    }
  });

  it('returns a parse-error result for a syntactically broken source', async () => {
    const result = await minifySource('javascript', 'function (');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('parse-error');
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it('actually shortens a verbose input (proof the minifier is real)', async () => {
    const source = `
      // a helpful comment
      export function greet(name /* the name */) {
        const greeting = 'Hello, ' + name + '!';
        return greeting;
      }
    `;
    const result = await minifySource('javascript', source);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.length).toBeLessThan(source.length / 2);
      expect(result.output).not.toContain('/* the name */');
      expect(result.output).not.toContain('// a helpful comment');
      expect(result.output).toContain('greet');
    }
  });
});

describe('minifySource (html)', () => {
  it('is a no-op on an empty string', async () => {
    const result = await minifySource('html', '');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('');
  });

  it('collapses consecutive whitespace in text to a single space', async () => {
    const result = await minifySource('html', '<p>hello   world</p>');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<p>hello world</p>');
  });

  it('drops whitespace that sits only between tag boundaries', async () => {
    const result = await minifySource(
      'html',
      '<div>\n  <span>hi</span>\n  <span>world</span>\n</div>'
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<div><span>hi</span><span>world</span></div>');
  });

  it('strips HTML comments from text content', async () => {
    const result = await minifySource('html', '<!-- intro --><p>hi</p><!-- outro -->');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<p>hi</p>');
  });

  it('strips IE conditional comments as a documented side effect', async () => {
    const result = await minifySource(
      'html',
      '<!--[if IE]><p>legacy</p><![endif]--><p>modern</p>'
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<p>modern</p>');
  });

  it('preserves whitespace inside <pre> byte-for-byte', async () => {
    const source = '<pre>  indented\n    further\n</pre>';
    const result = await minifySource('html', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe(source);
  });

  it('preserves <script> content verbatim including comments', async () => {
    const source = '<script>\n  // keep me\n  const x = 1;\n  /* also */\n</script>';
    const result = await minifySource('html', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe(source);
  });

  it('preserves <style> content verbatim', async () => {
    const source = '<style>\n  .x {\n    color: red;\n  }\n</style>';
    const result = await minifySource('html', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe(source);
  });

  it('preserves <textarea> content verbatim', async () => {
    const source = '<textarea>line 1\n  line 2</textarea>';
    const result = await minifySource('html', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe(source);
  });

  it('keeps multi-space attribute values inside quotes exact', async () => {
    const result = await minifySource('html', '<a title="hello   world">click</a>');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<a title="hello   world">click</a>');
  });

  it('collapses whitespace between attributes but preserves quoted values', async () => {
    const result = await minifySource(
      'html',
      '<input   type="text"    value="a  b"   required>'
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toBe('<input type="text" value="a  b" required>');
    }
  });

  it('handles self-closing tags without entering preserve mode', async () => {
    const result = await minifySource('html', '<br/><br /><img src="a.png"/>');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<br/><br /><img src="a.png"/>');
  });

  it('tolerates malformed input (unclosed tag) without throwing', async () => {
    const result = await minifySource('html', '<div>hello');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<div>hello');
  });

  it('keeps the DOCTYPE intact', async () => {
    const result = await minifySource(
      'html',
      '<!DOCTYPE html>\n<html>\n  <body>hi</body>\n</html>'
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<!DOCTYPE html><html><body>hi</body></html>');
  });

  it('does not choke on a </script> that appears inside nested content', async () => {
    const source = '<script>const s = "</script>";</script>';
    const result = await minifySource('html', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe(source);
  });

  it('does not treat a raw-text close-tag prefix as a real closing tag', async () => {
    const source = '<script>const text = "</scripted>  keep   spacing";</script>';
    const result = await minifySource('html', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe(source);
  });

  it('collapses whitespace before the > in a preserve-element closing tag', async () => {
    const source = '<script>const x = 1;</script >';
    const result = await minifySource('html', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<script>const x = 1;</script>');
  });
});

describe('minifySource (css)', () => {
  it('is a no-op on an empty string', async () => {
    const result = await minifySource('css', '');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('');
  });

  it('strips /* */ block comments', async () => {
    const result = await minifySource('css', '/* leading */ .x { color: red; } /* trailing */');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('.x{color:red}');
  });

  it('collapses whitespace around structural chars', async () => {
    const result = await minifySource(
      'css',
      '.x , .y   {\n  color :  red ;\n  padding:  1px   2px ;\n}'
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('.x,.y{color:red;padding:1px 2px}');
  });

  it('drops the trailing semicolon before a closing brace', async () => {
    const result = await minifySource('css', '.x { color: red; }');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('.x{color:red}');
  });

  it('preserves whitespace inside double-quoted strings', async () => {
    const result = await minifySource('css', '.x { content: "  keep  spaces  "; }');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('.x{content:"  keep  spaces  "}');
  });

  it('preserves whitespace inside single-quoted strings', async () => {
    const result = await minifySource('css', ".x { content: '  quoted  '; }");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe(".x{content:'  quoted  '}");
  });

  it('preserves escaped quotes inside strings', async () => {
    const result = await minifySource('css', '.x { content: "a\\"b"; }');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('.x{content:"a\\"b"}');
  });

  it('preserves unquoted url() content byte-for-byte', async () => {
    const result = await minifySource('css', '.x { background: url(path with space.png); }');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('.x{background:url(path with space.png)}');
  });

  it('preserves escaped close parens inside unquoted url() content', async () => {
    const result = await minifySource(
      'css',
      String.raw`.x { background: url(foo\)bar.png); color: red; }`,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe(String.raw`.x{background:url(foo\)bar.png);color:red}`);
  });

  it('preserves quoted url() content', async () => {
    const result = await minifySource('css', '.x { background: url( "path.png" ); }');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('.x{background:url("path.png")}');
  });

  it('preserves a data-URI inside url()', async () => {
    const source =
      '.x { background: url("data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22></svg>"); }';
    const result = await minifySource('css', source);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toBe(
        '.x{background:url("data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22></svg>")}'
      );
    }
  });

  it('handles @media + @keyframes block nesting', async () => {
    const result = await minifySource(
      'css',
      '@media (min-width: 600px) {\n  .x { color: red; }\n  .y { color: blue; }\n}'
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toBe('@media (min-width:600px){.x{color:red}.y{color:blue}}');
    }
  });

  it('is lenient on an unclosed block comment (runs to EOF without throwing)', async () => {
    const result = await minifySource('css', '.x { /* never closes }');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('.x{');
  });
});

describe('minifySource (scss)', () => {
  it('strips // line comments and collapses nested rules', async () => {
    const result = await minifySource(
      'scss',
      `// header
.outer {
  color: red; // inline
  .inner { padding: 1px 2px; }
}`,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('.outer{color:red;.inner{padding:1px 2px}}');
  });

  it('preserves // inside double-quoted strings', async () => {
    const result = await minifySource('scss', '.x { content: "// not a comment"; }');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('.x{content:"// not a comment"}');
  });

  it('preserves // inside unquoted url()', async () => {
    const result = await minifySource('scss', '.x { background: url(//example.com/bg.png); }');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('.x{background:url(//example.com/bg.png)}');
  });

  it('handles @mixin / @include whitespace correctly', async () => {
    const result = await minifySource(
      'scss',
      '@mixin square($size) {\n  width: $size;\n  height: $size;\n}\n.x { @include square(10px); }',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toBe(
        '@mixin square($size){width:$size;height:$size}.x{@include square(10px)}',
      );
    }
  });

  it('strips a // line comment that precedes the first rule', async () => {
    const result = await minifySource('scss', '// lead\n.x { color: red; }');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('.x{color:red}');
  });
});

describe('minifySource (less)', () => {
  it('preserves @variable declarations and interpolations', async () => {
    const result = await minifySource(
      'less',
      '@primary: #333;\n.x {\n  color: @primary;\n  border: 1px solid @primary;\n}',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toBe('@primary:#333;.x{color:@primary;border:1px solid @primary}');
    }
  });

  it('strips // line comments like SCSS', async () => {
    const result = await minifySource(
      'less',
      '// top\n.x {\n  color: red; // inline\n}',
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('.x{color:red}');
  });

  it('handles nested rules and the & parent reference', async () => {
    const result = await minifySource(
      'less',
      '.x {\n  color: red;\n  &:hover { color: blue; }\n}',
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('.x{color:red;&:hover{color:blue}}');
  });
});

describe('minifySource (xml)', () => {
  it('is a no-op on an empty string', async () => {
    const result = await minifySource('xml', '');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('');
  });

  it('strips XML comments', async () => {
    const result = await minifySource(
      'xml',
      '<!-- note --><root><child>hi</child><!-- inner --></root>'
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<root><child>hi</child></root>');
  });

  it('collapses whitespace between tags', async () => {
    const result = await minifySource(
      'xml',
      '<root>\n  <child>\n    hi\n  </child>\n</root>'
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<root><child>hi</child></root>');
  });

  it('preserves CDATA content byte-for-byte', async () => {
    const source = '<root><![CDATA[  keep <tags> & "quotes"  ]]></root>';
    const result = await minifySource('xml', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe(source);
  });

  it('preserves processing instructions including the XML declaration', async () => {
    const source = '<?xml version="1.0" encoding="UTF-8"?>\n<root/>';
    const result = await minifySource('xml', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<?xml version="1.0" encoding="UTF-8"?><root/>');
  });

  it('preserves attribute values with whitespace', async () => {
    const result = await minifySource('xml', '<root  title="hello  world"  >content</root>');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<root title="hello  world">content</root>');
  });

  it('handles self-closing tags', async () => {
    const result = await minifySource('xml', '<root>\n  <child/>\n  <other />\n</root>');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<root><child/><other /></root>');
  });

  it('preserves single-quoted attributes with whitespace inside', async () => {
    const result = await minifySource('xml', "<root title='  ok  '/>");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe("<root title='  ok  '/>");
  });

  it('preserves an inline <![CDATA[]]> that contains a literal ]] sequence', async () => {
    const source = '<root><![CDATA[a ]] b]]></root>';
    const result = await minifySource('xml', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe(source);
  });

  it('is lenient on malformed input (unclosed tag runs to EOF)', async () => {
    const result = await minifySource('xml', '<root>hello');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<root>hello');
  });
});
