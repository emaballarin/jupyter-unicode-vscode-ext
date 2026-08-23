"use strict";

const vscode = require("vscode");
const symbols = require("./symbols");

/** Separates the name from its character in the popup row. */
const GAP = "  ";

/**
 * Offers the Unicode character for the `\name` under the cursor.
 *
 * The items are built once and reused: there are 1300 of them, so rebuilding on every
 * keystroke would be pure waste. Only the range, which moves with the cursor, is assigned
 * per request.
 */
class LatexCompletionProvider {
    constructor() {
        /** @type {vscode.CompletionItem[] | null} */
        this.cache = null;
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

        const range = new vscode.Range(position.line, token.start, position.line, position.character);

        // Prefix matching, the way Jupyter does it. Handing the widget all 1300 names and
        // letting its fuzzy matcher pick turns `\pi` into a list of `\phi`, `\psi`, `\bbPi`.
        const matches = [];
        for (const item of this.items()) {
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

    /** @returns {vscode.CompletionItem[]} */
    items() {
        if (this.cache) {
            return this.cache;
        }

        const items = Object.entries(symbols.jupyter()).map(([name, character]) => {
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
            item.sortText = String(name.length).padStart(3, "0") + name;
            item.character = character;
            item.combining = symbols.isCombining(character);
            if (item.combining) {
                // The mark can only be folded into its base once both are in the document.
                item.command = {
                    command: "jupyterUnicode.compose",
                    title: "Compose the accent with the character it modifies",
                };
            }
            return item;
        });

        this.cache = items;
        return items;
    }
}

module.exports = { LatexCompletionProvider };
