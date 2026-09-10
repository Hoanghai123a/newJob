# AGENTS.md

## Primary rule

Before editing code, do not explore the whole repository.

Always start with:

1. Use CodeGraph if available.
2. Read `PROJECT_MAP.md` if CodeGraph is insufficient.
3. Identify the smallest set of files related to the request.
4. Read only those files.
5. Modify only directly related files.

## Minimal edit policy

- Do not refactor unrelated code.
- Do not rewrite files only for formatting.
- Do not introduce new libraries unless necessary.
- Preserve existing naming, folder structure, and coding style.
- Prefer small, safe patches.

## Code navigation workflow

For every task:

1. Locate relevant files with CodeGraph.
2. Confirm the flow using `PROJECT_MAP.md`.
3. Explain which files will be changed and why.
4. Edit the smallest safe set of files.
5. Run the smallest useful validation command.

## Validation

After changes, run one of these if relevant:

```bash
npm run build
npm run lint
npm test
```
