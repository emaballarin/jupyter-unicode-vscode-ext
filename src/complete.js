'use strict';

const vscode = require('vscode');
const symbols = require('./symbols');

/** Separates the name from its character in the popup row. */
const GAP = '  ';

/**
 * Offers the Unicode character for the `\name` under the cursor.
 *
 * The items are built once per symbol set and reused: there are up to ~2550 of them and
 * the set only changes when the setting does, so rebuilding on every keystroke would be
 * pure waste. Only the range, which moves with the cursor, is assigned per request.
 */
class LatexCompletionProvider {
  constructor() {
    /** @type {Map<string, vscode.CompletionItem[]>} */
    this.cache = new Map();
  }

  /**
   * @param {vscode.TextDocument} document
   * @param {vscode.Position} position
   */
  provideCompletionItems(document, position) {
    const token = symbols.tokenAt(document, position);
    if (!token) {
      return undefined;
    }

    const settings = vscode.workspace.getConfiguration('jupyterUnicode', document);
    const range = new vscode.Range(
      position.line,
      token.start,
      position.line,
      position.character,
    );

    // Prefix matching, the way Jupyter does it. Handing the widget all 1300 names and
    // letting its fuzzy matcher pick turns `\pi` into a list of `\phi`, `\psi`, `\bbPi`.
    const matches = [];
    for (const item of this.items(settings.get('symbolSet', 'jupyter'))) {
      if (!item.name.startsWith(token.text)) {
        continue;
      }
      item.range = range;
      // The preview depends on what sits before the backslash, so a combining mark shows
      // as it will actually land.
      if (item.combining) {
        item.label.detail = GAP + symbols.preview(item.character, token.preceding);
      }
      matches.push(item);
    }
    // Incomplete, so the next keystroke comes back here for a narrower prefix instead of
    // being fuzzy-filtered against this list.
    return new vscode.CompletionList(matches, true);
  }

  /**
   * @param {string} symbolSet
   * @returns {vscode.CompletionItem[]}
   */
  items(symbolSet) {
    const cached = this.cache.get(symbolSet);
    if (cached) {
      return cached;
    }

    const table = symbols.forSet(symbolSet);
    const items = Object.entries(table).map(([name, character]) => {
      // The character rides alongside the name, so the popup shows what you are about to
      // get -- which is the whole point of it appearing.
      const label = { label: name, detail: GAP + character };
      const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Text);
      item.insertText = character;
      item.name = name;
      // The widget filters on the word it finds itself, which stops at the backslash.
      // Saying so explicitly is what makes typing `\be` narrow to `\beta`.
      item.filterText = name;
      // Shorter names first, so `\to` outranks `\toea` on the same prefix.
      item.sortText = String(name.length).padStart(3, '0') + name;
      item.character = character;
      item.combining = symbols.isCombining(character);
      if (item.combining) {
        // The mark can only be folded into its base once both are in the document.
        item.command = {
          command: 'jupyterUnicode.compose',
          title: 'Compose the accent with the character it modifies',
        };
      }
      return item;
    });

    this.cache.set(symbolSet, items);
    return items;
  }

  /** Drop the cached items, after the symbol set changes. */
  clear() {
    this.cache.clear();
  }
}

module.exports = { LatexCompletionProvider };
