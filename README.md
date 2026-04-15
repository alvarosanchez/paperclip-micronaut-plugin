# Micronaut Plugin

[![CI](https://img.shields.io/github/actions/workflow/status/alvarosanchez/paperclip-micronaut-plugin/ci.yml?branch=main&label=ci)](https://github.com/alvarosanchez/paperclip-micronaut-plugin/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/actions/workflow/status/alvarosanchez/paperclip-micronaut-plugin/release.yml?label=release)](https://github.com/alvarosanchez/paperclip-micronaut-plugin/actions/workflows/release.yml)
[![Node >=20](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm 10](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Micronaut-focused Paperclip plugin that turns a project detail tab into a release cockpit: see the current and next version at a glance, inspect the default and upcoming release branches, create missing branches, and kick off merge-up work from inside Paperclip.

## What You Get

- A project-scoped **Micronaut branches** detail tab for repositories in the `micronaut-projects` GitHub organization
- Current version from the latest GitHub release tag, normalized to plain semver
- Next version derived from `projectVersion` in the repository's `gradle.properties`
- Branch rows for the default branch plus the next minor and next major release lines
- Ahead/behind, diverged, missing, and version-alignment signals for each tracked branch
- A one-click **Create branch** action for missing upcoming branches
- A **Merge up** workflow that creates a real Paperclip issue and assigns it to a selected agent
- Cached project snapshots with a **Last checked** indicator and manual refresh

## Requirements

- Node.js 20 or newer
- A Paperclip instance with plugin support
- A Paperclip project backed by a GitHub repository in the `micronaut-projects` organization
- Outbound access to the GitHub API from the plugin worker
- `gh` installed and authenticated on the Paperclip host if you want host-side branch creation and the GitHub CLI fallback path

## Install

Install the published package into Paperclip:

```bash
paperclipai plugin install paperclip-micronaut-plugin
```

Pin a specific npm version if needed:

```bash
paperclipai plugin install paperclip-micronaut-plugin --version <version>
```

Install from a local checkout during development:

```bash
paperclipai plugin install --local .
```

## Quick Start

1. Install the plugin in Paperclip.
2. Open a Paperclip project whose repository lives under `micronaut-projects`.
3. Open the **Micronaut branches** detail tab on that project.
4. Review the current version, next version, and branch health for the default, next minor, and next major lines.
5. Use **Refresh** to pull a fresh snapshot when needed.
6. Use **Create branch** when an expected future line does not exist yet.
7. Use **Merge up** to create and assign a Paperclip issue that tracks the merge from one branch into the next.

## How It Works

The tab combines GitHub repository metadata with Paperclip-native workflow state:

- **Current version** comes from the latest GitHub release tag.
- **Next version** comes from `projectVersion` in the repository root `gradle.properties` on the default branch.
- **Branch cards** show last-updated data, ahead/behind status, and whether `projectVersion` matches the expected release-line value such as `4.2.0-SNAPSHOT`.
- **Create branch** uses the GitHub CLI on the Paperclip host so branch creation happens with the operator's existing GitHub auth.
- **Merge up** creates a real Paperclip issue in `todo`, remembers the preferred assignee per company, and keeps the row linked to the issue until it closes.
- **PR chips** appear when the assigned agent comments on that issue with a GitHub pull request URL.

For unsupported repositories, the hosted tab stays out of the way instead of rendering misleading fallback chrome.

## Security And Privacy

- The plugin only requests the capabilities it needs for project reads, agent reads/invocation, issue reads/writes, plugin state, outbound HTTP, and the hosted detail tab registration.
- Repository metadata is fetched from GitHub and cached in Paperclip plugin state to avoid unnecessary repeat requests.
- The plugin shells out to `gh` with explicit argv arguments instead of a shell command string, which reduces command-injection risk.
- `gh` is only needed for host-side branch creation and recoverable GitHub API fallback calls.
- Merge-up tracking stores lightweight operational metadata in plugin state and uses native Paperclip issues for the actual work item.

## Development

From the repository root:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Additional verification commands:

- `pnpm test:e2e` for the headless Paperclip smoke flow
- `pnpm verify:manual` for an interactive local verification run

## Release

- Pull requests and pushes to `main` run GitHub Actions CI for typecheck, tests, build, and `npm pack --dry-run`.
- Published GitHub releases trigger the npm publish workflow.
- The release workflow derives the package version from the GitHub tag, writes that version into `package.json`, verifies the publish surface, and then publishes with provenance enabled.

## License

[MIT](./LICENSE)
