"use strict";

// Activates the extension against a stub of the `vscode` API.
//
// This cannot tell you whether Tab is bound correctly -- only a real extension host can,
// so that part is checked by hand against test/scratch.ipynb --
// but it does catch the errors that otherwise surface as a silent failure to activate: a
// misspelt API, a provider registered against nothing, a command declared in package.json
// with no handler behind it.

const assert = require("assert");
const Module = require("module");

const calls = {
    providers: [],
    commands: new Map(),
    context: new Map(),
    /** Every setContext write in order, so a redundant one is visible. */
    contextWrites: [],
    /** Every executeCommand name in order. */
    executed: [],
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

const manifest = require("../package.json");
const defaults = manifest.contributes.configuration.properties;

const settings = new Map([
    ["triggerOnBackslash", false],
    ["composeAccents", true],
    ["languages", defaults["jupyterUnicode.languages"].default],
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
    CompletionTriggerKind: { Invoke: 0, TriggerCharacter: 1, TriggerForIncompleteCompletions: 2 },
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
            calls.executed.push(name);
            if (name === "setContext") {
                calls.context.set(key, value);
                calls.contextWrites.push(value);
            }
            return Promise.resolve();
        },
    },
    window: {
        activeTextEditor: undefined,
        onDidChangeActiveTextEditor: listener("activeEditor"),
        onDidChangeTextEditorSelection: listener("selection"),
    },
    workspace: {
        getConfiguration: () => ({ get: (key, fallback) => (settings.has(key) ? settings.get(key) : fallback) }),
        onDidChangeConfiguration: listener("configuration"),
    },
};

// Hand our stub to `require('vscode')`, which only exists inside the extension host.
const load = Module._load;
Module._load = (request, ...rest) => (request === "vscode" ? vscode : load(request, ...rest));

const extension = require("../src/extension");

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

/** The members of TextEditor that the context-key update touches. */
function editorOf(line, character, { language = "python", isEmpty = true } = {}) {
    return {
        document: { lineAt: () => ({ text: line }), languageId: language },
        selection: { active: new Position(0, character), isEmpty },
    };
}

/** The members of TextDocument that the completion provider touches. */
function documentOf(line, language = "python") {
    return { lineAt: () => ({ text: line }), languageId: language };
}

const context = { subscriptions: [] };
extension.activate(context);

test("registers for notebook cells and for every configured language, exactly once", () => {
    // A python notebook cell matches both selectors. Registering once per selector offered
    // every symbol twice, which is what the popup actually showed.
    assert.strictEqual(calls.providers.length, 1, "one registration, or items come doubled");
    const selectors = calls.providers[0].selector.map((s) => JSON.stringify(s));
    assert.ok(selectors.includes('{"scheme":"vscode-notebook-cell"}'), "notebook cells");
    for (const language of settings.get("languages")) {
        assert.ok(selectors.includes(`{"language":"${language}"}`), language);
    }
});

test("the shipped defaults cover python, markdown and plain text", () => {
    assert.deepStrictEqual(defaults["jupyterUnicode.languages"].default, ["python", "markdown", "plaintext"]);
});

test("activates without depending on the configured languages", () => {
    // `activationEvents` cannot name a language the user has yet to add to the setting, so
    // adding julia there must not leave the extension asleep on a .jl file.
    assert.ok(manifest.activationEvents.includes("onStartupFinished"), "onStartupFinished");
});

test("does not claim the backslash trigger by default", () => {
    assert.deepStrictEqual(calls.providers[0].triggers, []);
});

test("every command in package.json has a handler", () => {
    for (const { command } of manifest.contributes.commands) {
        assert.ok(calls.commands.has(command), `${command} is declared but not registered`);
    }
    // The compose command is internal -- referenced by completion items, not the palette.
    assert.ok(calls.commands.has("jupyterUnicode.compose"), "compose is registered");
});

test("the keybinding command is the one that is registered", () => {
    assert.ok(calls.commands.has(manifest.contributes.keybindings[0].command));
});

test("arms the context key only just after a name", () => {
    const armed = (line, character, options) => {
        calls.listeners.selection({ textEditor: editorOf(line, character, options) });
        return calls.context.get("jupyterUnicode.atLatexToken");
    };
    assert.strictEqual(armed("\\beta", 5), true);
    assert.strictEqual(armed("beta", 4), false);
    assert.strictEqual(armed("    ", 4), false, "plain indentation must leave Tab alone");
    assert.strictEqual(armed("def f():", 8), false);
});

test("does not arm where the name has nothing to complete", () => {
    // Arming on the shape of the text alone swallowed Tab entirely here: the binding fired,
    // the provider returned an empty list, and the line was neither completed nor indented.
    const armed = (line, character, options) => {
        calls.listeners.selection({ textEditor: editorOf(line, character, options) });
        return calls.context.get("jupyterUnicode.atLatexToken");
    };
    assert.strictEqual(armed("C:\\Users", 8), false, "a windows path must still indent");
    assert.strictEqual(armed("a\\zzzz", 6), false, "a mistyped name must still indent");
    assert.strictEqual(armed("\\bet", 4), true, "a real prefix still arms");
    // \sum is outside the identifier-safe subset, so it arms in prose and not in code.
    assert.strictEqual(armed("\\sum", 4), false, "code draws on the identifier-safe subset");
    assert.strictEqual(armed("\\sum", 4, { language: "markdown" }), true, "prose draws on all of it");
});

test("does not arm while a selection is waiting to be indented", () => {
    const armed = (line, character, options) => {
        calls.listeners.selection({ textEditor: editorOf(line, character, options) });
        return calls.context.get("jupyterUnicode.atLatexToken");
    };
    assert.strictEqual(armed("    y = \\beta", 13), true, "the cursor alone arms");
    assert.strictEqual(
        armed("    y = \\beta", 13, { isEmpty: false }),
        false,
        "Tab must indent the block, not complete at one end of it"
    );
});

test("writes the context key only when it changes", () => {
    // This runs on every cursor move, and each write is a round trip to the context service.
    calls.listeners.selection({ textEditor: editorOf("beta", 4) });
    const before = calls.contextWrites.length;
    for (let i = 0; i < 5; i += 1) {
        calls.listeners.selection({ textEditor: editorOf("beta", 4) });
    }
    assert.strictEqual(calls.contextWrites.length, before, "five identical moves, no writes");
    calls.listeners.selection({ textEditor: editorOf("\\beta", 5) });
    assert.strictEqual(calls.contextWrites.length, before + 1, "the change itself is written");
});

test("offers items covering the whole name, backslash included", () => {
    const { provider } = calls.providers[0];
    const { items } = provider.provideCompletionItems(documentOf("y\\tilde"), new Position(0, 7));

    const tilde = items.find((item) => item.name === "\\tilde");
    assert.strictEqual(tilde.range.start.character, 1, "the range takes the backslash");
    assert.strictEqual(tilde.range.end.character, 7);
    assert.strictEqual(tilde.filterText, "\\tilde");
    assert.ok(tilde.label.detail.endsWith("y" + tilde.insertText), "previewed on its base");
    assert.strictEqual(tilde.command.command, "jupyterUnicode.compose");
});

test("hands each request its own items", () => {
    // Sharing one item per name and reassigning its range per request meant a second list
    // rewrote the first one's ranges and previews under it, and the widget applies the range
    // it finds at accept time.
    const { provider } = calls.providers[0];
    const first = provider
        .provideCompletionItems(documentOf("y\\tilde"), new Position(0, 7))
        .items.find((item) => item.name === "\\tilde");
    const detail = first.label.detail;

    const second = provider
        .provideCompletionItems(documentOf("\\tilde"), new Position(0, 6))
        .items.find((item) => item.name === "\\tilde");

    assert.notStrictEqual(first, second, "two requests, two objects");
    assert.strictEqual(first.range.start.character, 1, "the first range survives the second request");
    assert.strictEqual(second.range.start.character, 0);
    assert.strictEqual(first.label.detail, detail, "the first preview survives too");
    assert.notStrictEqual(second.label.detail, detail, "and the second gets its own");
});

test("matches on the prefix, not fuzzily", () => {
    const { provider } = calls.providers[0];
    const list = provider.provideCompletionItems(documentOf("\\pi"), new Position(0, 3));
    const names = list.items.map((item) => item.name);

    assert.ok(names.includes("\\pi"), "the exact name is there");
    // What the widget's own fuzzy matcher dragged in when handed the whole table.
    for (const noise of ["\\phi", "\\psi", "\\Pi", "\\bbPi", "\\bfPi"]) {
        assert.ok(!names.includes(noise), `${noise} is not a prefix of \\pi`);
    }
    assert.ok(list.isIncomplete, "the next keystroke must re-query, not re-filter this list");

    const beta = provider
        .provideCompletionItems(documentOf("\\bet"), new Position(0, 4))
        .items.find((item) => item.name === "\\beta");
    assert.strictEqual(beta.insertText, "β");
    assert.strictEqual(beta.command, undefined, "no composition for a standalone glyph");
});

test("stays silent where there is no name", () => {
    const { provider } = calls.providers[0];
    assert.strictEqual(provider.provideCompletionItems(documentOf("    pass"), new Position(0, 4)), undefined);
});

test("offers only what can sit in a python name, in code", () => {
    const { provider } = calls.providers[0];
    // Python's identifier rules are why IPython drops these, and this follows IPython.
    for (const name of ["\\sum", "\\in", "\\to"]) {
        const { items } = provider.provideCompletionItems(documentOf(name), new Position(0, name.length));
        assert.ok(!items.some((item) => item.name === name), `${name} is not identifier-safe`);
    }
});

test("offers the whole table in prose", () => {
    const { provider } = calls.providers[0];
    // ∑ cannot sit in a Python name, but a markdown cell is not a Python name.
    for (const [name, character] of [
        ["\\sum", "∑"],
        ["\\in", "∈"],
        ["\\to", "→"],
    ]) {
        for (const language of ["markdown", "plaintext"]) {
            const { items } = provider.provideCompletionItems(
                documentOf(name, language),
                new Position(0, name.length)
            );
            const match = items.find((item) => item.name === name);
            assert.ok(match, `${name} should be offered in ${language}`);
            assert.strictEqual(match.insertText, character);
        }
    }
});

test("Tab and Ctrl+Space converge on the same trigger", () => {
    // Ctrl+Space is VS Code's own binding for `editor.action.triggerSuggest`, gated on
    // `editorHasCompletionItemProvider` -- which our registration is what satisfies, in a
    // plain text file where nothing else would. The Tab command dispatches that same
    // action, so the two paths reach this provider through identical code.
    const before = calls.executed.length;
    calls.commands.get("jupyterUnicode.complete")();
    assert.deepStrictEqual(calls.executed.slice(before), ["editor.action.triggerSuggest"]);
});

test("answers an explicit invocation, not only a typed trigger character", () => {
    // Trigger characters govern automatic popups only; an explicit invoke reaches every
    // registered provider regardless, which is why the default empty list costs nothing.
    assert.deepStrictEqual(calls.providers[0].triggers, [], "no trigger characters by default");
    const { provider } = calls.providers[0];
    for (const kind of Object.values(vscode.CompletionTriggerKind)) {
        const list = provider.provideCompletionItems(documentOf("\\bet"), new Position(0, 4), undefined, {
            triggerKind: kind,
            triggerCharacter: kind === vscode.CompletionTriggerKind.TriggerCharacter ? "\\" : undefined,
        });
        assert.ok(
            list.items.some((item) => item.name === "\\beta"),
            `triggerKind ${kind} should still be answered`
        );
    }
});

test("Ctrl+Space is not gated by the Tab context key", () => {
    // The context key exists only to keep Tab meaning indent; it must not narrow what an
    // explicit request can complete. With a selection open Tab stands down, and Ctrl+Space
    // still has to work.
    calls.listeners.selection({ textEditor: editorOf("    y = \\bet", 12, { isEmpty: false }) });
    assert.strictEqual(calls.context.get("jupyterUnicode.atLatexToken"), false, "Tab stands down");

    const { provider } = calls.providers[0];
    const list = provider.provideCompletionItems(documentOf("    y = \\bet"), new Position(0, 12));
    assert.ok(
        list.items.some((item) => item.name === "\\beta"),
        "Ctrl+Space completes anyway"
    );
});

test("registers for plain text, so Ctrl+Space has a provider to find there", () => {
    // `editorHasCompletionItemProvider` is false in a .txt file with nothing registered, and
    // VS Code's ctrl+space binding is gated on it -- so this registration is load-bearing.
    const selectors = calls.providers[0].selector.map((s) => JSON.stringify(s));
    assert.ok(selectors.includes('{"language":"plaintext"}'));
});

if (!process.exitCode) {
    console.log(`ok: ${run} activation tests`);
}
