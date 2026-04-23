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

  it('handles whitespace before the > in a preserve-element closing tag', () => {
    // Rare but spec-legal: `</script >` with a space before `>`. Tag-mode
    // rules collapse the space, so the closing tag is emitted as `</script >`
    // (valid HTML, still readable as a proper close for the block).
    const source = '<script>const x = 1;</script >';
    const result = minifySource('html', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('<script>const x = 1;</script >');
  });
});
