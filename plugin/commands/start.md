---
description: Create a new junto task and choose its size
argument-hint: <work description>
allowed-tools: Read, Glob, Write, mcp__plugin_junto_junto__junto__task, mcp__junto__junto__task, mcp__plugin_junto_junto__junto__status, mcp__junto__junto__status
---

The user wants to start this work: $ARGUMENTS

Do every step below in this same turn. The junto tools are allowed only while this command runs, so
stopping to ask a question here would move the start into a turn where they are not allowed.

1. If `.junto/config.json` does not exist, write it with the gates this project already has.
   Inspect `package.json`, `Cargo.toml`, `go.mod`, or `Makefile` for familiar scripts (`test`,
   `typecheck`, `lint`, `build`). For a Python project (`pyproject.toml`, `setup.cfg`,
   `requirements*.txt`, `tox.ini`), look for the tools it already uses: a `tests/` folder or pytest
   settings (`pytest`), `ruff`, `mypy`. Run them as modules (`python -m pytest`) with the project's
   virtual environment interpreter when one exists (`.venv/Scripts/python.exe` on Windows,
   `.venv/bin/python` elsewhere), so the gate uses the project's dependencies. Match only scripts and
   tools that actually exist. Mark security gates (`npm audit`, `pip-audit`, `gosec`, `semgrep`) as
   `required: false` and explain which tools must be installed. Use this format (the plugin's
   `examples/config.basic.json`); `argv` is an array, never one command string:

   ```json
   {
     "schemaVersion": 1,
     "gates": {
       "tests": { "argv": ["npm", "test"], "required": true, "timeoutMs": 120000 }
     }
   }
   ```

   Gates run only at `/junto:verify`, so the user can still change the file before then. Show the
   gates you wrote in your report and say that.
2. Choose a size and explain why:
   - `small`: one-file or fully understood work; starts directly in build.
   - `standard`: a feature or multi-file change; requires a brief, plan, and user approval.
   - `deep`: an architectural or high-risk change.
   When uncertain, choose the larger size. Size may increase but never decrease: if the work grows,
   raise it later with `/junto:escalate <standard|deep> <reason>`.
3. Call `junto__task` with `action: "start"`, a concise title, and the selected size.
4. For `standard`/`deep`, write `.junto/tasks/<id>/brief.md` with clarified requirements and
   exclusions. Put open questions for the user at the end of the brief; they are answered before
   `/junto:plan`, not by stopping here.

Then stop and report: the gates written, the size and why, and any open questions. Do not write
implementation code yet.
