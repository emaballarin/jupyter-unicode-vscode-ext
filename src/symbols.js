'use strict';

// The symbol table and the text scanning around it. Everything here is independent of the
// completion machinery, so it stays testable by eye and reusable from a command.

const fs = require('fs');
const path = require('path');

/**
 * Characters that may follow the backslash in a name. Beyond letters and digits this
 * needs `^` and `_` for `\^2` and `\_1`, and `/` for the handful of names like `\1/4`.
 */
const TOKEN_CHARACTER = /[A-Za-z0-9^_/]/;

/**
 * How far back to look for the opening backslash. The longest real name is a little over
 * twenty characters; the bound is what stops a line of prose full of backslashes from
 * being rescanned to its start on every cursor move.
 */
const MAX_TOKEN_LENGTH = 40;

/** U+25CC, the placeholder a lone combining mark is conventionally drawn on. */
const DOTTED_CIRCLE = '◌';

let allSymbols = null;
let jupyterNames = null;

/** @returns {Record<string, string>} every name Julia's REPL knows, ~2550 of them. */
function all() {
  if (!allSymbols) {
    allSymbols = load('symbols.json');
  }
  return allSymbols;
}

/** @returns {Record<string, string>} only names whose character is valid in a Python name. */
function jupyter() {
  if (!jupyterNames) {
    const everything = all();
    jupyterNames = {};
    for (const name of load('jupyter.json')) {
      jupyterNames[name] = everything[name];
    }
  }
  return jupyterNames;
}

function load(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', file), 'utf8'));
}

/**
 * The `\name` being typed at a position, if there is one.
 *
 * A backslash is not a word character, so the editor's own word range stops at the `n` of
 * `\beta` and every caller would have to widen it again. Scanning here once keeps the
 * definition of "a name" in a single place, shared by the completion provider and the
 * context key that arms the Tab binding.
 *
 * @param {import('vscode').TextDocument} document
 * @param {import('vscode').Position} position
 * @returns {{ text: string, start: number, preceding: string } | null}
 */
function tokenAt(document, position) {
  const line = document.lineAt(position.line).text;
  const cursor = position.character;
  const limit = Math.max(0, cursor - MAX_TOKEN_LENGTH);

  let start = cursor;
  while (start > limit && TOKEN_CHARACTER.test(line[start - 1])) {
    start -= 1;
  }
  if (start === 0 || line[start - 1] !== '\\') {
    return null;
  }
  start -= 1;

  // An escaped backslash is not the start of a name: in `"a\\beta"` the user means a
  // literal backslash followed by the word, and completing there would be wrong.
  let backslashes = 0;
  while (start - backslashes > 0 && line[start - backslashes - 1] === '\\') {
    backslashes += 1;
  }
  if (backslashes % 2 === 1) {
    return null;
  }

  return {
    text: line.slice(start, cursor),
    start,
    preceding: start > 0 ? [...line.slice(0, start)].pop() || '' : '',
  };
}

/**
 * How a character should be shown in the popup.
 *
 * Forty-eight entries are marks that render on top of the previous character rather than
 * on their own: `\tilde` is U+0303, which alone shows as a stray accent hanging off
 * whatever the widget drew last. Attaching it to the character it is about to modify is
 * both legible and a preview of the real result, so `y\tilde` displays as ỹ.
 *
 * @param {string} char
 * @param {string} preceding the character before the backslash, if any
 */
function preview(char, preceding) {
  if (!isCombining(char)) {
    return char;
  }
  return (preceding || DOTTED_CIRCLE) + char;
}

/**
 * Is this a combining mark, i.e. does it render on top of the previous character?
 *
 * Node has no access to the Unicode category table, but all forty-eight in this table
 * fall in one of the four standard ranges, so testing the ranges avoids shipping a
 * category database. The ranges also take the four enclosing marks (`\enclosecircle`
 * U+20DD and friends), whose canonical combining class is zero but which still draw
 * around the previous character -- which is what this predicate is really asking.
 *
 * @param {string} char
 */
function isCombining(char) {
  const code = char.codePointAt(0);
  return (
    (code >= 0x0300 && code <= 0x036f) || // combining diacritical marks
    (code >= 0x1ab0 && code <= 0x1aff) || // ... extended
    (code >= 0x1dc0 && code <= 0x1dff) || // ... supplement
    (code >= 0x20d0 && code <= 0x20ff) // ... for symbols
  );
}

module.exports = {
  all,
  jupyter,
  tokenAt,
  preview,
  isCombining,
  DOTTED_CIRCLE,
};
