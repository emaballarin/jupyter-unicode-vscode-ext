"use strict";

// The symbol table and the text scanning around it. Everything here is independent of the
// completion machinery, so it stays testable by eye and reusable from a command.

const fs = require("fs");
const path = require("path");

/**
 * Characters that may follow the backslash in a name. Beyond letters and digits this needs
 * `^` and `_` for the sub- and superscript names (`\^A`, `\_beta`), and digits and `/` for
 * the fractions (`\1/4`). The last two are reachable only from the full table, which is
 * what prose draws on; the identifier-safe subset contains no name with a digit in it.
 */
const TOKEN_CHARACTER = /[A-Za-z0-9^_/]/;

/**
 * How far back to look for the opening backslash. The longest real name is a little over
 * twenty characters; the bound is what stops a line of prose full of backslashes from
 * being rescanned to its start on every cursor move.
 */
const MAX_TOKEN_LENGTH = 40;

/** U+25CC, the placeholder a lone combining mark is conventionally drawn on. */
const DOTTED_CIRCLE = "◌";

/**
 * Documents that get the whole table rather than the identifier-safe subset.
 *
 * `\sum` is the point: ∑ cannot sit in a Python name, so IPython withholds it and so do we
 * in code -- but in prose it is exactly what one reaches for. A notebook cell reports its
 * own language, so a markdown cell lands here while the code cell beside it does not.
 */
const PROSE_LANGUAGES = new Set(["markdown", "plaintext"]);

let allSymbols = null;
let jupyterNames = null;
let allEntries = null;
let jupyterEntries = null;

/** @returns {Record<string, string>} every name Julia's REPL knows, ~2550 of them. */
function all() {
    if (!allSymbols) {
        allSymbols = load("symbols.json");
    }
    return allSymbols;
}

/** @returns {Record<string, string>} only names whose character is valid in a Python name. */
function jupyter() {
    if (!jupyterNames) {
        const everything = all();
        jupyterNames = {};
        for (const name of load("jupyter.json")) {
            jupyterNames[name] = everything[name];
        }
    }
    return jupyterNames;
}

function load(file) {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", file), "utf8"));
}

/**
 * @typedef {{ name: string, character: string, combining: boolean }} Entry
 */

/**
 * The table a document draws on, sorted by name and built once.
 *
 * Sorted because both callers want a prefix range out of it, and a sorted array gives that
 * by binary search -- which matters for the arming check, which runs on every cursor move.
 *
 * @param {string} languageId
 * @returns {Entry[]}
 */
function entriesFor(languageId) {
    if (PROSE_LANGUAGES.has(languageId)) {
        if (!allEntries) {
            allEntries = entriesOf(all());
        }
        return allEntries;
    }
    if (!jupyterEntries) {
        jupyterEntries = entriesOf(jupyter());
    }
    return jupyterEntries;
}

/** @param {Record<string, string>} table @returns {Entry[]} */
function entriesOf(table) {
    return Object.keys(table)
        .sort()
        .map((name) => ({ name, character: table[name], combining: isCombining(table[name]) }));
}

/**
 * Index of the first entry whose name is not less than `prefix`.
 *
 * Every name sharing a prefix is contiguous under lexicographic order, so this index is
 * also the start of the run of matches, if there is one.
 *
 * @param {Entry[]} entries
 * @param {string} prefix
 */
function lowerBound(entries, prefix) {
    let low = 0;
    let high = entries.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (entries[middle].name < prefix) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
}

/**
 * Every entry whose name starts with `prefix`, in the order the popup wants them.
 *
 * @param {string} languageId
 * @param {string} prefix
 * @returns {Entry[]}
 */
function matches(languageId, prefix) {
    const entries = entriesFor(languageId);
    const start = lowerBound(entries, prefix);
    let end = start;
    while (end < entries.length && entries[end].name.startsWith(prefix)) {
        end += 1;
    }
    return entries.slice(start, end);
}

/**
 * Is there anything at all to complete for `prefix`?
 *
 * Kept separate from `matches` because this is the question the Tab binding asks on every
 * cursor move, and it wants an answer without allocating the list. Arming on the shape of
 * the text alone would swallow Tab after `C:\Users` or a stray `\zzz`, where there is
 * nothing to offer and Tab must go on meaning indent.
 *
 * @param {string} languageId
 * @param {string} prefix
 */
function hasMatch(languageId, prefix) {
    const entries = entriesFor(languageId);
    const index = lowerBound(entries, prefix);
    return index < entries.length && entries[index].name.startsWith(prefix);
}

/**
 * The `\name` being typed at a position, if there is one.
 *
 * A backslash is not a word character, so the editor's own word range stops at the `n` of
 * `\beta` and every caller would have to widen it again. Scanning here once keeps the
 * definition of "a name" in a single place, shared by the completion provider and the
 * context key that arms the Tab binding.
 *
 * Note that this reports the shape of the text, not whether anything matches: ask
 * `hasMatch` for that.
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
    if (start === 0 || line[start - 1] !== "\\") {
        return null;
    }
    start -= 1;

    // An escaped backslash is not the start of a name: in `"a\\beta"` the user means a
    // literal backslash followed by the word, and completing there would be wrong.
    let backslashes = 0;
    while (start - backslashes > 0 && line[start - backslashes - 1] === "\\") {
        backslashes += 1;
    }
    if (backslashes % 2 === 1) {
        return null;
    }

    return {
        text: line.slice(start, cursor),
        start,
        preceding: characterBefore(line, start),
    };
}

/**
 * The single character ending at `index`, or "" at the start of the line.
 *
 * Sliced rather than spread: this sits on the path walked at every cursor move, and
 * spreading the whole prefix to take its last element allocates the length of the line for
 * one character.
 *
 * @param {string} line
 * @param {number} index
 */
function characterBefore(line, index) {
    if (index <= 0) {
        return "";
    }
    const unit = line.charCodeAt(index - 1);
    // A low surrogate is the tail of an astral pair; taking one unit would halve a codepoint.
    const width = unit >= 0xdc00 && unit <= 0xdfff && index > 1 ? 2 : 1;
    return line.slice(index - width, index);
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
    matches,
    hasMatch,
    tokenAt,
    preview,
    isCombining,
    DOTTED_CIRCLE,
    PROSE_LANGUAGES,
};
