import { describe, expect, it } from 'vitest';
import {
  buildInstallCommand,
  detectGoImports,
  detectNativeDependencies,
  detectRubyGems,
  detectRustCrates,
} from '../../src/shared/dependencies/nativeDependencies';

describe('detectGoImports', () => {
  it('extracts third-party modules from a grouped import block and skips stdlib', () => {
    const src = `package main
import (
  "fmt"
  "net/http"
  "github.com/gin-gonic/gin"
  "golang.org/x/sync/errgroup"
)`;
    expect(detectGoImports(src).sort()).toEqual(
      ['github.com/gin-gonic/gin', 'golang.org/x/sync'].sort()
    );
  });

  it('handles single-line and aliased imports', () => {
    const src = `import "github.com/pkg/errors"
import mux "github.com/gorilla/mux"
import "strings"`;
    expect(detectGoImports(src).sort()).toEqual(
      ['github.com/pkg/errors', 'github.com/gorilla/mux'].sort()
    );
  });

  it('returns [] for stdlib-only or empty source', () => {
    expect(detectGoImports('import "fmt"')).toEqual([]);
    expect(detectGoImports('')).toEqual([]);
  });
});

describe('detectRustCrates', () => {
  it('extracts crates from use and extern crate, filtering built-ins', () => {
    const src = `extern crate serde;
use tokio::runtime::Runtime;
use std::collections::HashMap;
use crate::helpers;
use serde_json::Value;`;
    expect(detectRustCrates(src).sort()).toEqual(['serde', 'tokio', 'serde_json'].sort());
  });

  it('ignores self/super/core/alloc', () => {
    expect(detectRustCrates('use self::x; use super::y; use core::mem; use alloc::vec;')).toEqual([]);
  });
});

describe('detectRubyGems', () => {
  it('extracts gems from gem and require, filtering stdlib', () => {
    const src = `require 'json'
require 'sinatra'
gem 'rails'
require 'active_support/all'`;
    expect(detectRubyGems(src).sort()).toEqual(['sinatra', 'rails', 'active_support'].sort());
  });

  it('returns [] for stdlib-only source', () => {
    expect(detectRubyGems("require 'json'\nrequire 'date'")).toEqual([]);
  });
});

describe('detectNativeDependencies', () => {
  it('dispatches by language', () => {
    expect(detectNativeDependencies('go', 'import "github.com/a/b"')).toEqual(['github.com/a/b']);
    expect(detectNativeDependencies('rust', 'use rand::random;')).toEqual(['rand']);
    expect(detectNativeDependencies('ruby', "gem 'pg'")).toEqual(['pg']);
  });
});

describe('buildInstallCommand', () => {
  it('builds go get / cargo add / bundle add with a -- end-of-options guard', () => {
    expect(buildInstallCommand('go', ['github.com/gin-gonic/gin'])).toEqual({
      binary: 'go',
      args: ['get', '--', 'github.com/gin-gonic/gin'],
    });
    expect(buildInstallCommand('rust', ['serde', 'tokio'])).toEqual({
      binary: 'cargo',
      args: ['add', '--', 'serde', 'tokio'],
    });
    expect(buildInstallCommand('ruby', ['rails'])).toEqual({
      binary: 'bundle',
      args: ['add', '--', 'rails'],
    });
  });

  it('accepts versioned specifiers', () => {
    expect(buildInstallCommand('rust', ['serde@1.0'])?.args).toEqual([
      'add',
      '--',
      'serde@1.0',
    ]);
  });

  it('returns null for an empty list', () => {
    expect(buildInstallCommand('go', [])).toBeNull();
  });

  it('rejects unsafe specifiers (no shell metacharacters reach argv)', () => {
    expect(buildInstallCommand('ruby', ['rails; rm -rf /'])).toBeNull();
    expect(buildInstallCommand('go', ['$(evil)'])).toBeNull();
  });

  it('rejects flag-injection and path-traversal specifiers', () => {
    // Leading-dash tokens would be parsed as options by the package manager
    // (e.g. `cargo add --path ../x` rewrites Cargo.toml from an attacker path).
    for (const bad of ['--path', '-C', '-u', '--offline', '--git']) {
      expect(buildInstallCommand('rust', [bad])).toBeNull();
    }
    // Path traversal is rejected even though its chars are otherwise allowed.
    expect(buildInstallCommand('go', ['../../etc/passwd'])).toBeNull();
    expect(buildInstallCommand('ruby', ['a/../b'])).toBeNull();
  });

  it('filters unsafe entries but keeps valid ones', () => {
    expect(buildInstallCommand('rust', ['serde', 'bad name', '--path'])).toEqual({
      binary: 'cargo',
      args: ['add', '--', 'serde'],
    });
  });
});
