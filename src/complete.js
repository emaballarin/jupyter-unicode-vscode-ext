'use strict';

const vscode = require('vscode');
const symbols = require('./symbols');

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

    const items = this.items(settings.get('symbolSet', 'jupyter'));
    for (const item of items) {
      item.range = range;
      // The preview depends on what sits before the backslash, so a combining mark shows
      // as it will actually land.
      if (item.combining) {
        item.detail = symbols.preview(item.character, token.preceding);
      }
    }
    return items;
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
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Text);
      item.insertText = character;
      item.detail = character;
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
