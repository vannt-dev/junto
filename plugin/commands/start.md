---
description: Create a new junto task and choose its size
argument-hint: <work description>
allowed-tools: Read, Glob, Write, mcp__plugin_junto_junto__junto__task, mcp__junto__junto__task
---

The user wants to start this work: $ARGUMENTS

Follow these steps in order:

1. If `.junto/config.json` does not exist, inspect `package.json`, `Cargo.toml`, `go.mod`, or `Makefile`
   for familiar scripts (`test`, `typecheck`, `lint`, `build`). For a Python project (`pyproject.toml`,
   `setup.cfg`, `requirements*.txt`, `tox.ini`), look for the tools it already uses: a `tests/` folder or
   pytest settings (`pytest`), `ruff`, `mypy`. Run them as modules (`python -m pytest`) with the project's
   virtual environment interpreter when one exists (`.venv/Scripts/python.exe` on Windows,
   `.venv/bin/python` elsewhere), so the gate uses the project's dependencies. Propose gates and ask the
   user to confirm before writing. Match only scripts and tools that actually exist. Mark security gates
   (`npm audit`, `pip-audit`, `gosec`, `semgrep`) as `required: false` and explain which tools must be
   installed.
2. Choose a size and explain why:
   - `small`: one-file or fully understood work; starts directly in build.
   - `standard`: a feature or multi-file change; requires a brief, plan, and user approval.
   - `deep`: an architectural or high-risk change.
   When uncertain, choose the larger size. Size may increase but never decrease: if the work grows,
   raise it later with `/junto:escalate <standard|deep> <reason>`.
3. Call `junto__task` with `action: "start"`, a concise title, and the selected size.
4. For `standard`/`deep`, write `.junto/tasks/<id>/brief.md` with clarified requirements and exclusions.

Then stop and report. Do not write implementation code yet.
