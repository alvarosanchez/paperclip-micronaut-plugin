# Micronaut Plugin

Paperclip plugin that adds a Micronaut-focused project `detailTab`.

The tab is meant for Paperclip projects backed by repositories in the
`micronaut-projects` GitHub organization and shows release-oriented signals for
the active project:

- Current version: the latest GitHub release tag, normalized to a plain version
  string such as `3.0.0`
- Next version: derived from `projectVersion` in the repository root
  `gradle.properties` on the repository default branch, with `-SNAPSHOT`
  removed
- Branches: the repository default branch plus the next minor and next major
  release branches derived from it, including last-updated timestamps and
  ahead/behind status relative to the default branch when those branches exist,
  branch-local `projectVersion` checks against the expected `X.Y.0-SNAPSHOT`
  release version, a live `Create branch` action for missing upcoming branches,
  a live AI-assisted `Merge up` action for behind branches with a remembered
  company-wide agent choice that creates a real Paperclip issue in `todo`,
  keeps the row linked to that issue with its native status icon until it
  closes, and shows the GitHub PR once the assigned agent comments with that PR
  URL on the issue,
  and a preview-only `Set default` action for eligible branches so maintainers
  can still verify the exact GitHub and version workflow before the
  destructive default-branch switch ships
- Cache: the project overview is cached in Paperclip plugin state and shows a
  `Last checked ...` timestamp plus a manual refresh control so reopening the
  tab does not re-fetch GitHub data every time

The `Create branch` button creates the missing branch directly from the
Paperclip host by using the
local GitHub CLI, `gh`, against the repository default branch. If `gh` is not
installed or not authenticated on the host, the tab reports that clearly when
you click the button.

## Development

```bash
pnpm install
pnpm dev
pnpm dev:ui
pnpm typecheck
pnpm test
pnpm build
```

## Install Into Paperclip

```bash
curl -X POST http://127.0.0.1:3100/api/plugins/install \
  -H "Content-Type: application/json" \
  -d '{"packageName":"/Users/alvaro/Dev/alvarosanchez/paperclip-micronaut-plugin","isLocalPath":true}'
```

## Plugin Contract

- `src/manifest.ts` declares a single project-scoped `detailTab` named
  `Micronaut branches`
- `src/worker.ts` registers one read model,
  `micronaut.project-overview`, caches supported project snapshots in
  project-scoped plugin state, and exposes the
  `micronaut.refresh-project-overview`, `micronaut.create-branch`,
  `micronaut.merge-up-state`, `micronaut.set-merge-up-agent`, and
  `micronaut.start-merge-up` contracts for explicit refreshes, host-side GitHub
  CLI branch creation, company-scoped merge-up agent preferences, and
  project-scoped tracked merge-up issue persistence; it also derives
  branch-local `projectVersion` expectations from the GitHub contents API with
  `gh api` fallback for recoverable transport failures, creates a real
  Paperclip issue assigned to the selected agent and immediately moves it to
  `todo`, then hydrates the tracked issue ids back into the merge-up read
  model, plus merge-up and set-default eligibility for the hosted UI
- `src/ui/index.tsx` renders a compact hosted Paperclip tab with Paperclip-native
  sections for version and branch data, a cached `Last checked ...` indicator,
  a refresh control, GitHub-style ahead/behind pills, project-version status
  notes, partial-failure warnings, inline create-branch mutations backed by the
  worker without replacing the whole tab with a loading screen, a merge-up
  picker that mirrors Paperclip's native assignee chooser, active merge-up rows
  that link to the Paperclip issue plus status icon, and GitHub PR chips when
  the assigned agent comments with a PR URL on that issue
- `src/micronaut.ts` contains the shared repo/version parsing helpers used by
  the worker and tests

For non-Micronaut repositories, the hosted tab returns `null` instead of
rendering fallback chrome.

## Verification

Run the smallest relevant scope first:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Use these when the hosted Paperclip flow changes:

- `pnpm test:e2e`
  Builds the plugin, boots an isolated Paperclip instance, installs the plugin,
  creates a disposable `Dummy Company` with seeded `Micronaut CEO` and
  `Micronaut Software Engineer` agents using `codex_local` + `gpt-5.4`,
  creates a disposable `Micronaut Core` project backed by
  `https://github.com/micronaut-projects/micronaut-core`, opens the
  `Micronaut branches` tab headlessly, and verifies the rendered current
  version, next version, branch rows, last-updated labels, the cached
  `Last checked ...` status, the manual refresh control, ahead/behind status
  pills or `Create` branch actions for missing upcoming branches, native
  merge-up issue chips, and readable title-to-surface contrast against live
  host and GitHub data. This smoke flow stays read-only against
  `micronaut-core`.
- `pnpm verify:manual`
  Builds the plugin, boots a local Paperclip instance, installs the plugin,
  creates or reuses a `Micronaut Core` project plus company-scoped
  `Micronaut CEO` and `Micronaut Software Engineer` agents configured with
  `codex_local` + `gpt-5.4`, and opens the `Micronaut branches` tab in your
  browser. Confirm the tab content shows the latest GitHub release version, the
  next version derived from `gradle.properties`, a `Last checked ...` status
  with a refresh button, and branch rows for the default, next minor, and next
  major branches with last-updated values, ahead/behind-style status pills, and
  project-version notes. If an upcoming branch does not exist yet, the row
  should show a `Create branch` action instead, and creating it should update
  the tab in place rather than replacing the whole surface with a loading
  state. When a branch is behind the default branch, the row should show a live
  `Merge up` action with the same assignee-picker style as native Paperclip
  issues: on first use it should ask you to choose an agent, then it should
  remember that agent for the company, create a real Paperclip issue in `todo`
  assigned to that agent, and replace the button with a link to that issue plus
  its Paperclip status icon until the issue is closed. If the agent comments on
  that issue with a GitHub PR URL, the branch row should also surface a `PR #...`
  chip that opens the PR. When a branch is not behind, the row should show a
  preview-only `Set default` action with exact branch and version text in the
  dialog. Verify both light and dark themes for readability. To exercise the live
  create-branch and merge-up flows, make sure `gh` is installed and
  authenticated on the Paperclip host with access to the target repository. The
  script also prints the installed-plugins settings URL for a quick manifest
  check.

The smoke test writes light-theme, dark-theme, and latest screenshots plus a
metadata snapshot to `tests/e2e/results/`.
