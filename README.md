# Micronaut Plugin

Paperclip plugin that adds a Micronaut-focused project `detailTab`.

The tab is meant for Paperclip projects backed by repositories in the
`micronaut-projects` GitHub organization. It renders Micronaut branding and
shows release-oriented signals for the active project:

- Current version: the latest GitHub release tag, normalized to a plain version
  string such as `3.0.0`
- Next version: derived from `projectVersion` in the repository root
  `gradle.properties` on the repository default branch, with `-SNAPSHOT`
  removed
- Branches: the repository default branch plus the next minor and next major
  release branches derived from it, including last-updated timestamps and
  ahead/behind status relative to the default branch when those branches exist,
  or a `Create branch` action when an upcoming branch has not been created yet
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
  `Micronaut`
- `src/worker.ts` registers one read model,
  `micronaut.project-overview`, caches supported project snapshots in
  project-scoped plugin state, and exposes the
  `micronaut.refresh-project-overview` and `micronaut.create-branch` actions
  for explicit refreshes and host-side GitHub CLI branch creation
- `src/ui/index.tsx` renders a compact hosted Paperclip tab with the Micronaut
  logo, a host-scoped Micronaut tab icon, Paperclip-native sections for version
  and branch data, a cached `Last checked ...` indicator, a refresh control,
  GitHub-style ahead/behind pills, partial-failure warnings, and inline
  create-branch mutations backed by the worker without replacing the whole tab
  with a loading screen
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
  creates a disposable `Micronaut Core` project backed by
  `https://github.com/micronaut-projects/micronaut-core`, verifies the
  Micronaut tab icon is visible before the first tab open, opens the Micronaut
  project tab headlessly, and verifies the rendered current version, next
  version, branch rows, last-updated labels, the cached `Last checked ...`
  status, the manual refresh control, ahead/behind status pills or `Create`
  branch actions for missing upcoming branches, and tab icon against live host
  and GitHub data. This smoke flow stays read-only against `micronaut-core`.
- `pnpm verify:manual`
  Builds the plugin, boots a local Paperclip instance, installs the plugin,
  creates or reuses a `Micronaut Core` project, and opens the Micronaut project
  tab in your browser. Confirm the Micronaut tab already shows its icon before
  you select it, then confirm the tab content shows the Micronaut logo, the
  latest GitHub release version, the next version derived from
  `gradle.properties`, a `Last checked ...` status with a refresh button, and
  branch rows for the default, next minor, and next major branches with
  last-updated values and ahead/behind-style status pills. If an upcoming
  branch does not exist yet, the row should show a `Create branch` action
  instead, and creating it should update the tab in place rather than replacing
  the whole surface with a loading state. To exercise the mutation path, make
  sure `gh` is installed and authenticated on the Paperclip host with access to
  the target repository. The script also prints the installed-plugins settings
  URL for a quick manifest check.

The smoke test writes the latest screenshot and metadata snapshot to
`tests/e2e/results/`.
