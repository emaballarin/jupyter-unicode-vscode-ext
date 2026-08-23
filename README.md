# Jupyter Unicode input for VS Code

Type `\beta`, press `<Tab>`, get `β` — the way a Jupyter notebook in the browser does, but in VS Code.

```
\beta   <Tab>  →  β
y\tilde <Tab>  →  ỹ
\bbR    <Tab>  →  ℝ
```

Works in notebook cells, code and markdown alike, in the Interactive Window, and in `.py`, `.md` and `.txt` files. Outside a `\name`, `<Tab>` still indents exactly as before.

Code gets the table Jupyter offers: names whose character is legal in a Python identifier, so `\sum` stays uncompleted where `∑` would only be a syntax error. Markdown and plain text get the whole table, `\sum` → `∑` included, since prose has no such rule. The cell's own language decides, so a markdown cell and the code cell beneath it behave differently.

## Install

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

`.github/workflows/release.yml` runs the first two on every push: it regenerates the tables and fails if they drift from what is committed, runs the suite, then packages and publishes. Edge builds carry a `+ci.<run>.g<sha>` suffix; tagged builds carry the bare version, and the tag must agree with `package.json`.

## Licence

MIT — see [LICENSE](LICENSE). The symbol table is derived from Julia, also MIT.
