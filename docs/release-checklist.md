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
3. Wait for CI to pass on the exact release commit.
4. Run `claude plugin tag --dry-run .`, then `claude plugin tag --push .` to create and push the
   marketplace tag `{plugin}--v{version}`.
5. Create and push the annotated tag `v<version>` at the same commit for the GitHub release.
6. Create the GitHub release from `v<version>` using the matching changelog section.
7. Re-run installation from the public marketplace source and repeat the smoke workflow.
