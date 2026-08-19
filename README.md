# jupyter-unicode-vscode-ext

Type `\beta`, press `<Tab>`, get `β` — the way a Jupyter notebook in the browser does,
but in VS Code.

```
\beta   <Tab>  →  β
y\tilde <Tab>  →  ỹ
\bbR    <Tab>  →  ℝ
```

VS Code's notebook editor has no equivalent of IPython's LaTeX tab-completion, so the
habit breaks the moment a notebook is opened here instead of in a browser tab. This puts
it back, in notebook cells (code and markdown), the Interactive Window, and `.py` files.

## Install

```sh
./tools/package
code --install-extension jupyter-unicode-vscode-ext-0.1.0.vsix
```

For development, skip the install and run `code --extensionDevelopmentPath="$PWD"`, which
loads the checkout into a second window.

There is no build step: no npm, no TypeScript, no dependency beyond the `vscode` API.
`tools/package` is tar and zip — a `.vsix` is a zip holding the source under `extension/`
beside two metadata files, and the installer reads those.

## How the `<Tab>` binding works

A backslash is not a word character, so the editor will not treat `\beta` as one token by
itself and the suggest widget would filter on `beta`, leaving the `\` behind on accept.
Three pieces get around that:

1. The completion provider sets an explicit `range` spanning the backslash, and a
   `filterText` of `\beta` so typing narrows the list.
2. A context key, `jupyterUnicode.atLatexToken`, is refreshed on every cursor move by
   scanning left for a `\` followed by name characters.
3. `<Tab>` is bound to `jupyterUnicode.complete` **only** when that key is set, and only
   when the suggest widget is closed, no snippet is active, and Tab is not in
   move-focus mode.

That last part is the whole safety story: outside a `\name`, `<Tab>` never reaches this
extension and keeps indenting exactly as before.

## Why `\sum` does not work by default

IPython's table is not a curated shortlist. Its generator applies one filter:

```python
def test_ident(i):
    """Is the unicode string valid in a Python 3 identifier."""
    return ("a" + i).isidentifier()
```

IPython drives a *code* completer, so it keeps only characters that can legally sit inside
a Python name. `∑` `∈` `→` `₁` `²` are symbol and punctuation categories, and fail. The
rule looks at the character and never at the context, so Jupyter also refuses `\sum` in a
markdown cell, where `∑` is ordinary prose.

Both tables ship here, and `jupyterUnicode.symbolSet` picks between them:

| value | entries | behaviour |
|---|---|---|
| `jupyter` *(default)* | 1300 | identifier-safe only — what the browser notebook does |
| `full` | 2548 | everything Julia's REPL offers, including `\sum` `\in` `\to` `\_1` `\^2` |

## Settings

| setting | default | meaning |
|---|---|---|
| `jupyterUnicode.symbolSet` | `jupyter` | which table to complete from, as above |
| `jupyterUnicode.triggerOnBackslash` | `false` | pop the list on `\` rather than waiting for `<Tab>` |
| `jupyterUnicode.composeAccents` | `true` | fold a combining mark into its base, so `y\tilde` gives one codepoint `ỹ` (U+1EF9) rather than `y` + U+0303. Jupyter leaves the two standing; NFC renders more dependably, and Python normalises identifiers to NFKC anyway, so both spellings are one name to the interpreter |
| `jupyterUnicode.languages` | `["python"]` | languages to complete in outside notebook cells |

## The symbol table

`data/symbols.json` and `data/jupyter.json` are **generated — do not edit them by hand.**
Both come from Julia's [`latex_symbols.jl`][julia], the upstream source IPython derives its
own table from, so one parse gives both sets:

```sh
python3 tools/gen-symbols   # → 2548 symbols, 1300 identifier-safe
```

The subset is computed with the `isidentifier` rule above rather than by copying IPython's
output. That yields 1300 entries against IPython's 1290, containing all of theirs with no
disagreement in any value; the ten extra (`\bbpi` ℼ, `\^C` ꟲ, `\underrightarrow` ⃯, …) are
ones IPython's own line-based parser drops as an artefact rather than by intent.

[julia]: https://github.com/JuliaLang/julia/blob/master/stdlib/REPL/src/latex_symbols.jl

## Tests

```sh
./tools/test
```

`src/symbols.js` imports nothing from `vscode`, so the fiddly part — scanning back for the
name, refusing an escaped `\\`, the combining-mark preview — is covered by real unit tests.
They need a node, and if none is installed the script borrows the one inside VS Code's own
app bundle, so there is still nothing to install.

Alongside them `tools/check` validates the data (subset relation, the `isidentifier` rule,
spot values, every combining mark falling inside the ranges `src/symbols.js` tests) and
lints the `when` clause on the `<Tab>` binding for its five guards. A lost guard does not
throw, it just quietly stops `<Tab>` from indenting, so it is worth a check.

What is *not* covered is the keybinding actually firing, which would need
`@vscode/test-electron` and a real extension host. Open `test/scratch.ipynb` under
`code --extensionDevelopmentPath="$PWD"` and work through its five sections. Section 4 is
the `<Tab>` regression sweep and is the one not to skip.

## Licence

MIT. The symbol table is derived from Julia, also MIT.
