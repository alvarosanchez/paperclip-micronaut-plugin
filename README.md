# Micronaut Plugin

[![CI](https://img.shields.io/github/actions/workflow/status/alvarosanchez/paperclip-micronaut-plugin/ci.yml?branch=main&label=ci)](https://github.com/alvarosanchez/paperclip-micronaut-plugin/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/actions/workflow/status/alvarosanchez/paperclip-micronaut-plugin/release.yml?label=release)](https://github.com/alvarosanchez/paperclip-micronaut-plugin/actions/workflows/release.yml)
[![Node >=24.11](https://img.shields.io/badge/node-%3E%3D24.11-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
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
- A **Merge up** workflow that creates a real Paperclip issue, assigns it to a selected agent, and requests a Paperclip-managed assignment wakeup
- Cached project snapshots with a **Last checked** indicator and manual refresh

## Requirements

- Node.js 24.11 or newer (the Paperclip plugin SDK baseline)
- A Paperclip instance with plugin support, version `2026.831.1` or newer
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
- **Merge up** creates a real Paperclip issue in `todo`, stamps it with Micronaut plugin origin and billing metadata, remembers the preferred assignee per company, and keeps the row linked to the issue until it closes.
- **Assignment wakeups** use Paperclip's issue wakeup API so scheduler, blocker, budget, and liveness checks stay in the host workflow instead of bypassing it with a direct agent invocation.
- **PR chips** appear when the assigned agent comments on that issue with a GitHub pull request URL.

For unsupported repositories, the hosted tab stays out of the way instead of rendering misleading fallback chrome.

## Security And Privacy

- The plugin only requests the capabilities it needs for project reads, agent reads, issue reads/creation/wakeups, plugin state, outbound HTTP, and the hosted detail tab registration.
- Repository metadata is fetched from GitHub and cached in Paperclip plugin state to avoid unnecessary repeat requests.
- The plugin shells out to `gh` with explicit argv arguments instead of a shell command string, which reduces command-injection risk.
- `gh` is only needed for host-side branch creation and recoverable GitHub API fallback calls.
- Merge-up tracking stores lightweight operational metadata in plugin state and uses native Paperclip issues plus host-owned assignment wakeups for the actual work item.

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

Both verification harnesses explicitly enable board approval for the disposable company, seed their test agents through Paperclip's board-governed hire flow, and approve pending hires before installing the local plugin. They also create the disposable Git-backed project with isolated issue workspaces enabled so merge-up issues exercise the current Paperclip project defaults.

Set `PAPERCLIP_E2E_PAPERCLIPAI_PACKAGE=<package>` to test a different `paperclipai` package; by default both harnesses run against `paperclipai@2026.831.1` under `node@24`, matching the release's Docker baseline and this package's Node 24.11+ requirement (`node:sqlite` is not available on older runtimes).

## Release

### Paperclip 2026.831 adoption boundary

Paperclip 2026.831.1 makes plugin configuration company-scoped: `ctx.config.get(companyId)` requires a company context, workers start with an empty config and receive one `configChanged` replay per configured company, and workers that serve several companies with differing config must declare `multiCompanyConfig: true`. Plugin secret refs, which 2026.626 rejected at save time, are re-enabled as company-scoped `{ type: "secret_ref" }` bindings resolved through `ctx.secrets.resolve(ref, { companyId, configPath })`. Agent tool execution now goes through the host tool gateway and is subject to each company's tool-access policy. The release also adds optional plugin capabilities for issue interactions (`issue.interactions.read`, `issue.interactions.respond`), issue attachments (`issue.attachments.read`), approvals (`approvals.read`, `approvals.respond`), and human-attributed comments (`issue.comments.create_human_attributed`).

The Micronaut release cockpit uses none of these surfaces, so this release-adoption PR keeps the plugin on the new SDK/runtime baseline without worker or manifest code changes. The worker declares no config schema, never calls `ctx.config.get` or `ctx.secrets.resolve`, registers no agent tools, jobs, or event subscriptions, and implements neither `onConfigChanged` nor `onHealth`, so the empty startup config, per-company replay, and `multiCompanyConfig` rules do not apply. Per-company settings (the preferred merge-up assignee) live in company-scoped plugin state, and every worker-to-host call happens inside a company-scoped data or action invocation, which satisfies the 2026.831 "company context is required" gate. The plugin does not request the new issue interaction, attachment, approval, or human-attributed comment capabilities.

As in 2026.626, the plugin does not create agents, routines, issue work modes, or external object providers, and does not use plugin entity mappings, environment drivers, or host-managed Skills Store APIs directly; those host/company-package capabilities stay with Paperclip and the live Micronaut Agent Company workflow.

- Pull requests and pushes to `main` run GitHub Actions CI for typecheck, tests, build, and `npm pack --dry-run`.
- Published GitHub releases trigger the npm publish workflow.
- The release workflow derives the package version from the GitHub tag, writes that version into `package.json`, verifies the publish surface, and then publishes with provenance enabled.

## License

[MIT](./LICENSE)
