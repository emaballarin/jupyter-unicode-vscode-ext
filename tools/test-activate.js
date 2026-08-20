'use strict';

// Activates the extension against a stub of the `vscode` API.
//
// This cannot tell you whether Tab is bound correctly -- only a real extension host can,
// so that part is checked by hand against test/scratch.ipynb --
// but it does catch the errors that otherwise surface as a silent failure to activate: a
// misspelt API, a provider registered against nothing, a command declared in package.json
// with no handler behind it.

const assert = require('assert');
const path = require('path');
const Module = require('module');

const calls = {
  providers: [],
  commands: new Map(),
  context: new Map(),
  listeners: {},
};

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

class Range {
  constructor(line, start, endLine, end) {
    this.start = new Position(line, start);
    this.end = new Position(endLine, end);
  }
}

class CompletionItem {
  constructor(label, kind) {
    this.label = label;
    this.kind = kind;
  }
}

class CompletionList {
  constructor(items, isIncomplete) {
    this.items = items;
    this.isIncomplete = isIncomplete;
  }
}

const settings = new Map([
  ['triggerOnBackslash', false],
  ['composeAccents', true],
  ['languages', ['python']],
]);

const listener = (name) => (handler) => {
  calls.listeners[name] = handler;
  return { dispose() {} };
};

const vscode = {
  Position,
  Range,
  CompletionItem,
  CompletionList,
  CompletionItemKind: { Text: 1 },
  languages: {
    registerCompletionItemProvider(selector, provider, ...triggers) {
      calls.providers.push({ selector, provider, triggers });
      return { dispose() {} };
    },
  },
  commands: {
    registerCommand(name, handler) {
      calls.commands.set(name, handler);
      return { dispose() {} };
    },
    executeCommand(name, key, value) {
      if (name === 'setContext') {
        calls.context.set(key, value);
      }
      return Promise.resolve();
    },
  },
  window: {
    activeTextEditor: undefined,
    onDidChangeActiveTextEditor: listener('activeEditor'),
    onDidChangeTextEditorSelection: listener('selection'),
  },
  workspace: {
    getConfiguration: () => ({ get: (key, fallback) => (settings.has(key) ? settings.get(key) : fallback) }),
    onDidChangeConfiguration: listener('configuration'),
  },
};

// Hand our stub to `require('vscode')`, which only exists inside the extension host.
const load = Module._load;
Module._load = (request, ...rest) =>
  request === 'vscode' ? vscode : load(request, ...rest);

const extension = require('../src/extension');

let run = 0;

function test(name, body) {
  run += 1;
  try {
    body();
  } catch (error) {
    console.error(`FAIL ${name}\n  ${error.message}`);
    process.exitCode = 1;
  }
}

const context = { subscriptions: [] };
extension.activate(context);

test('registers for notebook cells and for python, exactly once', () => {
  // A python notebook cell matches both selectors. Registering once per selector offered
  // every symbol twice, which is what the popup actually showed.
  assert.strictEqual(calls.providers.length, 1, 'one registration, or items come doubled');
  const selectors = calls.providers[0].selector.map((s) => JSON.stringify(s));
  assert.ok(selectors.includes('{"scheme":"vscode-notebook-cell"}'), 'notebook cells');
  assert.ok(selectors.includes('{"language":"python"}'), 'python');
});

test('does not claim the backslash trigger by default', () => {
  assert.deepStrictEqual(calls.providers[0].triggers, []);
});

test('every command in package.json has a handler', () => {
  const manifest = require('../package.json');
  for (const { command } of manifest.contributes.commands) {
    assert.ok(calls.commands.has(command), `${command} is declared but not registered`);
  }
  // The compose command is internal -- referenced by completion items, not the palette.
  assert.ok(calls.commands.has('jupyterUnicode.compose'), 'compose is registered');
});

test('the keybinding command is the one that is registered', () => {
  const manifest = require('../package.json');
  assert.ok(calls.commands.has(manifest.contributes.keybindings[0].command));
});

test('arms the context key only just after a name', () => {
  const editor = (line, character) => ({
    document: { lineAt: () => ({ text: line }) },
    selection: { active: new Position(0, character) },
  });
  const armed = (line, character) => {
    calls.listeners.selection({ textEditor: editor(line, character) });
    return calls.context.get('jupyterUnicode.atLatexToken');
  };
  assert.strictEqual(armed('\\beta', 5), true);
  assert.strictEqual(armed('beta', 4), false);
  assert.strictEqual(armed('    ', 4), false, 'plain indentation must leave Tab alone');
  assert.strictEqual(armed('def f():', 8), false);
});

test('offers items covering the whole name, backslash included', () => {
  const { provider } = calls.providers[0];
  const document = { lineAt: () => ({ text: 'y\\tilde' }) };
  const { items } = provider.provideCompletionItems(document, new Position(0, 7));

  const tilde = items.find((item) => item.name === '\\tilde');
  assert.strictEqual(tilde.range.start.character, 1, 'the range takes the backslash');
  assert.strictEqual(tilde.range.end.character, 7);
  assert.strictEqual(tilde.filterText, '\\tilde');
  assert.ok(tilde.label.detail.endsWith('y' + tilde.insertText), 'previewed on its base');
  assert.strictEqual(tilde.command.command, 'jupyterUnicode.compose');
});

test('matches on the prefix, not fuzzily', () => {
  const { provider } = calls.providers[0];
  const document = { lineAt: () => ({ text: '\\pi' }) };
  const list = provider.provideCompletionItems(document, new Position(0, 3));
  const names = list.items.map((item) => item.name);

  assert.ok(names.includes('\\pi'), 'the exact name is there');
  // What the widget's own fuzzy matcher dragged in when handed the whole table.
  for (const noise of ['\\phi', '\\psi', '\\Pi', '\\bbPi', '\\bfPi']) {
    assert.ok(!names.includes(noise), `${noise} is not a prefix of \\pi`);
  }
  assert.ok(list.isIncomplete, 'the next keystroke must re-query, not re-filter this list');

  const beta = provider
    .provideCompletionItems({ lineAt: () => ({ text: '\\bet' }) }, new Position(0, 4))
    .items.find((item) => item.name === '\\beta');
  assert.strictEqual(beta.insertText, 'β');
  assert.strictEqual(beta.command, undefined, 'no composition for a standalone glyph');
});

test('stays silent where there is no name', () => {
  const { provider } = calls.providers[0];
  const document = { lineAt: () => ({ text: '    pass' }) };
  assert.strictEqual(provider.provideCompletionItems(document, new Position(0, 4)), undefined);
});

test('offers only what can sit in a python name', () => {
  const { provider } = calls.providers[0];
  // Python's identifier rules are why IPython drops these, and this follows IPython.
  for (const name of ['\\sum', '\\in', '\\to']) {
    const line = { lineAt: () => ({ text: name }) };
    const { items } = provider.provideCompletionItems(line, new Position(0, name.length));
    assert.ok(!items.some((item) => item.name === name), `${name} is not identifier-safe`);
  }
});

if (!process.exitCode) {
  console.log(`ok: ${run} activation tests`);
}
