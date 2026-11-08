// Tests run git in temporary repositories. Started from a git hook (for example a pre-push hook in a
// linked worktree), git exports the hook's repository in these variables, and they override cwd: every
// test commit would land in the real repository. Same list as `git rev-parse --local-env-vars`.
const local = new Set([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
])

for (const key of Object.keys(process.env)) {
  const name = process.platform === "win32" ? key.toUpperCase() : key
  if (local.has(name) || /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(name)) delete process.env[key]
}
