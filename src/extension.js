'use strict';

const vscode = require('vscode');
const symbols = require('./symbols');
const { LatexCompletionProvider } = require('./complete');

/**
 * Armed when the cursor sits just after a `\name`. The Tab binding in package.json hangs
 * off this, which is what keeps Tab meaning indent everywhere else.
 */
const AT_TOKEN = 'jupyterUnicode.atLatexToken';

/** Notebook cells of any language, code and markdown alike. */
const NOTEBOOK_CELL = { scheme: 'vscode-notebook-cell' };

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  const provider = new LatexCompletionProvider();

  /** Providers are re-registered when settings change, so they own their own disposables. */
  let registrations = [];
  const register = () => {
    for (const registration of registrations) {
      registration.dispose();
    }
    const settings = vscode.workspace.getConfiguration('jupyterUnicode');
    const languages = settings.get('languages', ['python']);
    // Trigger characters are fixed at registration time, hence the re-registration.
    const triggers = settings.get('triggerOnBackslash', false) ? ['\\'] : [];
    // One registration against every selector, not one per selector: a Python notebook
    // cell matches both, and registering twice offers every symbol twice.
    const selector = [NOTEBOOK_CELL, ...languages.map((language) => ({ language }))];

    registrations = [
      vscode.languages.registerCompletionItemProvider(selector, provider, ...triggers),
    ];
  };
  register();
  context.subscriptions.push({
    dispose: () => registrations.forEach((registration) => registration.dispose()),
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('jupyterUnicode')) {
        return;
      }
      register();
    }),
  );

  const updateContext = (editor) => {
    const armed = Boolean(
      editor && symbols.tokenAt(editor.document, editor.selection.active),
    );
    vscode.commands.executeCommand('setContext', AT_TOKEN, armed);
  };
  updateContext(vscode.window.activeTextEditor);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateContext),
    vscode.window.onDidChangeTextEditorSelection((event) => updateContext(event.textEditor)),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('jupyterUnicode.complete', () =>
      vscode.commands.executeCommand('editor.action.triggerSuggest'),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('jupyterUnicode.compose', compose),
  );
}

/**
 * Fold a just-inserted combining mark into the character it modifies, so `y` + U+0303
 * becomes the single codepoint ỹ.
 *
 * Attached to the completion item rather than done in the edit itself, because the mark
 * has to meet its base before there is anything to normalise. Jupyter leaves the two
 * codepoints standing; NFC renders more dependably across fonts, and Python normalises
 * identifiers to NFKC anyway, so the two spellings are one name to the interpreter.
 */
async function compose() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const settings = vscode.workspace.getConfiguration('jupyterUnicode', editor.document);
  if (!settings.get('composeAccents', true)) {
    return;
  }

  const position = editor.selection.active;
  const before = editor.document.lineAt(position.line).text.slice(0, position.character);

  // Walk back over the run of marks, then take the base character under them.
  const points = [...before];
  let taken = 0;
  while (taken < points.length && symbols.isCombining(points[points.length - 1 - taken])) {
    taken += 1;
  }
  if (taken === 0 || taken === points.length) {
    return;
  }
  taken += 1;

  const span = points.slice(points.length - taken).join('');
  const composed = span.normalize('NFC');
  if (composed === span) {
    return;
  }

  const start = position.character - span.length;
  await editor.edit(
    (builder) =>
      builder.replace(
        new vscode.Range(position.line, start, position.line, position.character),
        composed,
      ),
    { undoStopBefore: false, undoStopAfter: true },
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
