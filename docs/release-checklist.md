# Release checklist

## Repository checks

1. Confirm `main` is clean and synchronized with `origin/main`.
2. Run `corepack pnpm install --frozen-lockfile`.
3. Run `corepack pnpm typecheck` and `corepack pnpm test`.
4. Run `corepack pnpm build`, then confirm `git diff --exit-code -- plugin/hooks plugin/mcp`.
5. Run `claude plugin validate .`.
6. Confirm plugin, marketplace, core, MCP, runner, and server versions agree.

## Manual acceptance

1. Add this repository as a local Claude Code marketplace.
2. Install the plugin from that marketplace.
3. In a disposable Git repository, exercise one small task through `build -> verify -> done`.
4. Exercise one deep task through `brief -> plan -> panel -> build -> review -> verify -> done`.
5. Confirm an edit after verification marks gate evidence stale.
6. Confirm `/junto:finish` archives only a task in `done`.

Installing the plugin changes user-level Claude Code state, so these steps are intentionally not
part of automated CI.

## Publish

1. Update `CHANGELOG.md` and all version surfaces.
2. Commit and push the release preparation.
3. Create the annotated tag `v<version>` at the reviewed commit and push the tag.
4. Create the GitHub release from that tag using the matching changelog section.
5. Re-run installation from the public marketplace source and repeat the smoke workflow.
