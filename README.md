# Jupyter Unicode input for VS Code

Type `\beta`, press `<Tab>`, get `β` — the way a Jupyter notebook in the browser does, but in VS Code.

```
\beta   <Tab>  →  β
y\tilde <Tab>  →  ỹ
\bbR    <Tab>  →  ℝ
```

Works in notebook cells, code and markdown alike, in the Interactive Window, and in `.py` files. Outside a `\name`, `<Tab>` still indents exactly as before.

## Install

```sh
./tools/package
code --install-extension jupyter-unicode-vscode-ext-0.1.0.vsix
```

## Settings

| setting | default | meaning |
|---|---|---|
| `jupyterUnicode.triggerOnBackslash` | `false` | pop the list on `\` instead of waiting for `<Tab>` |
| `jupyterUnicode.composeAccents` | `true` | fold `y` + `\tilde` into the single codepoint `ỹ` |
| `jupyterUnicode.languages` | `["python"]` | languages to complete in outside notebook cells |

## Licence

MIT. The symbol table is derived from Julia, also MIT.
