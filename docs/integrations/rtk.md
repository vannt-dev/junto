# Optional RTK integration

[RTK](https://github.com/rtk-ai/rtk) is a separate CLI proxy that filters verbose development-command output before it reaches an AI
session. It complements Junto during implementation but is not a Junto runtime dependency.

Install RTK and its Claude Code hook using the RTK project's instructions. Junto does not install the
binary or edit user-level Claude Code settings, preserving its project-only write and no-runtime-
download guarantees.

## Quality gates stay raw

Do not prefix Junto gate commands with RTK by default:

```json
{
  "gates": {
    "tests": {
      "argv": ["npm", "test"],
      "required": true
    }
  }
}
```

Junto already returns a terse success message and a bounded failure tail to the model while storing
the full command output under the task's `verdicts/` directory. Gate commands are spawned directly,
so Claude Code's Bash rewrite hook does not intercept them. Keeping the raw command preserves useful
evidence when a failure needs investigation.

RTK remains useful for shell commands Claude Code runs while exploring, implementing, and reviewing
the project. Its savings are reductions in shell-output context, not an equivalent reduction in the
session's total tokens or cost.
