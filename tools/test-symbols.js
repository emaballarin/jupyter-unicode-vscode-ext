"use strict";

// Exercises src/symbols.js, which is the part with the fiddly logic and, happily, the
// part that imports nothing from `vscode` -- so it runs under a bare node with no
// extension host. tools/test finds a node; there does not have to be one installed.

const assert = require("assert");
const symbols = require("../src/symbols");

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

/** The two members of TextDocument that tokenAt touches. */
function documentOf(line) {
    return { lineAt: () => ({ text: line }) };
}

/** Scan `line` at the cursor marked by `|`. */
function scan(marked) {
    const line = marked.replace("|", "");
    return symbols.tokenAt(documentOf(line), {
        line: 0,
        character: marked.indexOf("|"),
    });
}

test("finds a plain name", () => {
    assert.strictEqual(scan("\\beta|").text, "\\beta");
    assert.strictEqual(scan("\\beta|").start, 0);
});

test("finds a name after other text", () => {
    const token = scan("x = \\alpha|");
    assert.strictEqual(token.text, "\\alpha");
    assert.strictEqual(token.start, 4);
});

test("reports the character before the backslash", () => {
    assert.strictEqual(scan("y\\tilde|").preceding, "y");
    assert.strictEqual(scan("\\tilde|").preceding, "");
    // A whole codepoint, not the low half of one: the base here is two UTF-16 units.
    assert.strictEqual(scan("\uD835\uDC66\\tilde|").preceding, "\uD835\uDC66");
    assert.strictEqual([...scan("\uD835\uDC66\\tilde|").preceding].length, 1);
});

test("handles a partial name", () => {
    assert.strictEqual(scan("\\bet|a").text, "\\bet");
});

test("takes the digits and marks in \\_1 and \\^2", () => {
    // Both are full-table names, offered in prose and withheld from code -- but the scan
    // itself is about the shape of the text and does not know the difference.
    assert.strictEqual(scan("\\_1|").text, "\\_1");
    assert.strictEqual(scan("\\^2|").text, "\\^2");
});

test("is silent with no backslash", () => {
    assert.strictEqual(scan("beta|"), null);
    assert.strictEqual(scan("|"), null);
});

test("is silent mid-word before the backslash", () => {
    // `x\beta` is a name after `x`, but `xbeta` is not one at all.
    assert.strictEqual(scan("xbeta|"), null);
});

test("is silent after an escaped backslash", () => {
    // In "a\\beta" the user wrote a literal backslash; completing would be wrong.
    assert.strictEqual(scan('"a\\\\beta|"'), null);
    // ...but three backslashes is an escaped one plus the start of a name.
    assert.ok(scan('"a\\\\\\beta|"'));
});

test("stops at the bound rather than scanning the whole line", () => {
    assert.strictEqual(scan(`\\${"a".repeat(60)}|`), null);
});

test("recognises combining marks and enclosing ones", () => {
    const table = symbols.all();
    assert.ok(symbols.isCombining(table["\\tilde"]), "\\tilde combines");
    assert.ok(symbols.isCombining(table["\\enclosecircle"]), "\\enclosecircle combines");
    assert.ok(!symbols.isCombining(table["\\beta"]), "\\beta does not");
});

test("previews a combining mark on its base", () => {
    const tilde = symbols.all()["\\tilde"];
    assert.strictEqual(symbols.preview(tilde, "y"), "y" + tilde);
    assert.strictEqual(symbols.preview(tilde, ""), symbols.DOTTED_CIRCLE + tilde);
    assert.strictEqual(symbols.preview("β", "y"), "β");
});

test("y + \\tilde composes to one codepoint", () => {
    const composed = ("y" + symbols.all()["\\tilde"]).normalize("NFC");
    assert.strictEqual(composed, "ỹ");
    assert.strictEqual([...composed].length, 1);
});

test("the two tables agree", () => {
    const all = symbols.all();
    const jupyter = symbols.jupyter();
    assert.ok(Object.keys(all).length > 2500);
    assert.ok(Object.keys(jupyter).length > 1250);
    for (const [name, char] of Object.entries(jupyter)) {
        assert.strictEqual(char, all[name], `${name} disagrees between the tables`);
    }
    assert.ok(!("\\sum" in jupyter), "\\sum is not identifier-safe");
    assert.strictEqual(all["\\sum"], "∑");
});

test("knows whether a prefix can complete at all", () => {
    // What arms the Tab binding. Answering "yes" on shape alone swallowed Tab after a
    // windows path or a mistyped name, where there is nothing to offer.
    assert.ok(symbols.hasMatch("python", "\\bet"));
    assert.ok(symbols.hasMatch("python", "\\"), "a bare backslash matches everything");
    assert.ok(!symbols.hasMatch("python", "\\zzz"));
    assert.ok(!symbols.hasMatch("python", "\\Users"));
});

test("prose draws on the whole table, code on the identifier-safe subset", () => {
    assert.ok(!symbols.hasMatch("python", "\\sum"), "\\sum cannot sit in a python name");
    for (const language of [...symbols.PROSE_LANGUAGES]) {
        assert.ok(symbols.hasMatch(language, "\\sum"), `\\sum completes in ${language}`);
    }
    assert.strictEqual(symbols.matches("markdown", "\\").length, Object.keys(symbols.all()).length);
    assert.strictEqual(symbols.matches("python", "\\").length, Object.keys(symbols.jupyter()).length);
});

test("matches returns exactly the prefix run", () => {
    const names = symbols.matches("python", "\\pi").map((entry) => entry.name);
    assert.ok(names.includes("\\pi"));
    assert.ok(names.every((name) => name.startsWith("\\pi")), "nothing outside the prefix");
    assert.deepStrictEqual(names, [...names].sort(), "sorted, as the binary search assumes");
    assert.deepStrictEqual(symbols.matches("python", "\\zzz"), []);

    const [tilde] = symbols.matches("python", "\\tilde");
    assert.strictEqual(tilde.character, symbols.all()["\\tilde"]);
    assert.strictEqual(tilde.combining, true);
});

if (!process.exitCode) {
    console.log(`ok: ${run} symbol tests`);
}
