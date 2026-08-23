# Jupyter Unicode input for VS Code

Type `\beta`, press `<Tab>`, get `β` — the way a Jupyter notebook in the browser does, but in VS Code.

```
\beta   <Tab>  →  β
y\tilde <Tab>  →  ỹ
\bbR    <Tab>  →  ℝ
```

Works in notebook cells, code and markdown alike, in the Interactive Window, and in `.py`, `.md` and `.txt` files. Outside a `\name`, `<Tab>` still indents exactly as before.

`<Ctrl+Space>` works too, and always has: this is an ordinary completion provider, and `<Ctrl+Space>` is VS Code's own binding for the suggestion list. The two differ only in when they fire. `<Tab>` stands down wherever it would otherwise indent — with a selection open, or after text like `C:\Users` that merely looks like a name — whereas `<Ctrl+Space>` asks unconditionally. In a `.txt` file it is this extension's registration that makes `<Ctrl+Space>` do anything at all, since VS Code gates that binding on there being a provider.

Code gets the table Jupyter offers: names whose character is legal in a Python identifier, so `\sum` stays uncompleted where `∑` would only be a syntax error. Markdown and plain text get the whole table, `\sum` → `∑` included, since prose has no such rule. The cell's own language decides, so a markdown cell and the code cell beneath it behave differently.

## Install

Take a build from [Releases](../../releases): `edge` is rebuilt on every push and always holds the newest commit, while `v*` tags cut fixed versions.

```sh
code --install-extension jupyter-unicode-vscode-ext-edge.vsix
```

Or build it yourself — no npm, no vsce, just `tar`, `zip` and `python3`:

```sh
./tools/package
code --install-extension jupyter-unicode-vscode-ext-0.1.0.vsix
```

## Settings

| setting                             | default                               | meaning                                            |
| ----------------------------------- | ------------------------------------- | -------------------------------------------------- |
| `jupyterUnicode.triggerOnBackslash` | `false`                               | pop the list on `\` instead of waiting for `<Tab>` |
| `jupyterUnicode.composeAccents`     | `true`                                | fold `y` + `\tilde` into the single codepoint `ỹ`  |
| `jupyterUnicode.languages`          | `["python", "markdown", "plaintext"]` | languages to complete in outside notebook cells    |

## Development

```sh
./tools/test          # data checks, symbol tests, activation tests, tool tests
./tools/gen-symbols   # refresh data/ from Julia's REPL table
./tools/package       # build the .vsix
```

`.github/workflows/release.yml` runs the first two on every push: it regenerates the tables and fails if they drift from what is committed, runs the suite, then packages and publishes. Edge builds carry a `+ci.<run>.g<sha>` suffix; tagged builds carry the bare version, and the tag must agree with `package.json`.

## Licence

MIT — see [LICENSE](LICENSE). The symbol table is derived from Julia, also MIT.
