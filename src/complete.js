"use strict";

const vscode = require("vscode");
const symbols = require("./symbols");

/** Separates the name from its character in the popup row. */
const GAP = "  ";

/**
 * Offers the Unicode character for the `\name` under the cursor.
 *
 * Nothing is cached here. An earlier version handed out one shared `CompletionItem` per
 * name and reassigned its `range` per request, which is a data race the moment two lists
 * are alive at once: the range the widget applies on accept is whichever request wrote it
 * last, and that need not be the request the visible list came from. The table itself is
 * cached in `symbols`, which is where the parsing cost actually is; building the widget's
 * objects for the handful of names a prefix admits is not worth sharing.
 */
class LatexCompletionProvider {
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
        // `symbols.matches` binary-searches the sorted table, so a narrow prefix costs
        // nothing near the size of the table.
        const matches = symbols.matches(document.languageId, token.text);
        const items = matches.map((entry) => this.item(entry, range, token.preceding));

        // Incomplete, so the next keystroke comes back here for a narrower prefix instead of
        // being fuzzy-filtered against this list.
        return new vscode.CompletionList(items, true);
    }

    /**
     * @param {{ name: string, character: string, combining: boolean }} entry
     * @param {vscode.Range} range
     * @param {string} preceding the character before the backslash, if any
     * @returns {vscode.CompletionItem}
     */
    item(entry, range, preceding) {
        // The character rides alongside the name, so the popup shows what you are about to
        // get -- which is the whole point of it appearing. For a combining mark the preview
        // depends on what sits before the backslash, so it shows as it will actually land.
        const detail = GAP + (entry.combining ? symbols.preview(entry.character, preceding) : entry.character);
        const item = new vscode.CompletionItem({ label: entry.name, detail }, vscode.CompletionItemKind.Text);
        item.insertText = entry.character;
        item.name = entry.name;
        // The widget filters on the word it finds itself, which stops at the backslash.
        // Saying so explicitly is what makes typing `\be` narrow to `\beta`.
        item.filterText = entry.name;
        // Shorter names first, so `\to` outranks `\toea` on the same prefix.
        item.sortText = String(entry.name.length).padStart(3, "0") + entry.name;
        item.character = entry.character;
        item.combining = entry.combining;
        item.range = range;
        if (entry.combining) {
            // The mark can only be folded into its base once both are in the document.
            item.command = {
                command: "jupyterUnicode.compose",
                title: "Compose the accent with the character it modifies",
            };
        }
        return item;
    }
}

module.exports = { LatexCompletionProvider };
