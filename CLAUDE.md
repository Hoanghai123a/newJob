# Claude Code Mandatory Rules

- Sử dụng tiếng việt để trả lời
  These rules are mandatory for every task in this repository.

## Before editing

Claude must not scan the whole repository by default.

For every task, Claude must follow this order:

1. Use CodeGraph first to locate the smallest relevant code area.
2. Read `PROJECT_MAP.md` if CodeGraph is insufficient.
3. Identify the smallest set of files related to the task.
4. Read only those files.
5. Edit only directly related files.
6. Do not refactor unrelated code.
7. Do not rewrite formatting-only changes across unrelated files.

## Required workflow

Before making changes, Claude must briefly state:

- the likely files to inspect
- why those files are relevant
- whether the change has a wider blast radius

Then Claude may edit.

## Non-negotiable behavior

If a task requires code changes, Claude must not begin by using broad grep, glob, or reading many files.

Claude must first use CodeGraph or `PROJECT_MAP.md`.

If Claude cannot access CodeGraph, it must say so and then use `PROJECT_MAP.md` before reading source files.

## Validation

After editing, Claude should run the smallest useful validation command:

```bash
npm run build
npm run lint
npm test
```
