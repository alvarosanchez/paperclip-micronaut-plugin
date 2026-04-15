import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Agent, Project } from "@paperclipai/plugin-sdk";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import manifest, { normalizeManifestVersion } from "../src/manifest.js";
import {
  MICRONAUT_CREATE_BRANCH_ACTION_KEY,
  MICRONAUT_MERGE_UP_STATE_DATA_KEY,
  MICRONAUT_PROJECT_DETAIL_TAB_ID,
  MICRONAUT_PROJECT_OVERVIEW_DATA_KEY,
  MICRONAUT_REFRESH_PROJECT_OVERVIEW_ACTION_KEY,
  MICRONAUT_SET_MERGE_UP_AGENT_ACTION_KEY,
  MICRONAUT_START_MERGE_UP_ACTION_KEY,
  type MicronautCreateBranchResult,
  type MicronautMergeUpState,
  type MicronautStartMergeUpResult,
  type MicronautProjectOverview
} from "../src/micronaut.js";
import * as workerModule from "../src/worker.js";
import plugin from "../src/worker.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version?: unknown };
const itWithFakeGh = process.platform === "win32" ? it.skip : it;

function createProject(repoUrl: string): Project {
  return {
    id: "project-1",
    companyId: "company-1",
    urlKey: "micronaut-test-resources",
    goalId: null,
    goalIds: [],
    goals: [],
    name: "Micronaut Test Resources",
    description: null,
    status: "planned",
    leadAgentId: null,
    targetDate: null,
    color: null,
    pauseReason: null,
    pausedAt: null,
    executionWorkspacePolicy: null,
    codebase: {
      workspaceId: null,
      repoUrl,
      repoRef: null,
      defaultRef: null,
      repoName: "micronaut-test-resources",
      localFolder: null,
      managedFolder: "/tmp/micronaut-test-resources",
      effectiveLocalFolder: "/tmp/micronaut-test-resources",
      origin: "managed_checkout"
    },
    workspaces: [],
    primaryWorkspace: null,
    archivedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z")
  };
}

function createAgent(id: string, overrides: Partial<Agent> = {}): Agent {
  const now = new Date("2026-01-01T00:00:00.000Z");

  return {
    id,
    companyId: "company-1",
    name: `Agent ${id}`,
    urlKey: id,
    role: "engineer",
    title: "Software Engineer",
    icon: null,
    status: "idle",
    reportsTo: null,
    capabilities: null,
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    pauseReason: null,
    pausedAt: null,
    permissions: {
      canCreateAgents: false
    },
    lastHeartbeatAt: now,
    metadata: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function buildCompanySettingsScope(companyId: string) {
  return {
    scopeKind: "company" as const,
    scopeId: companyId,
    namespace: "micronaut",
    stateKey: "company-settings"
  };
}

function buildProjectMergeUpIssuesScope(projectId: string) {
  return {
    scopeKind: "project" as const,
    scopeId: projectId,
    namespace: "micronaut",
    stateKey: "merge-up-issues"
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function gitHubContentsResponse(body: string): Response {
  return jsonResponse({
    type: "file",
    encoding: "base64",
    content: Buffer.from(body, "utf8").toString("base64")
  });
}

function gradlePropertiesContentsUrl(ref: string): string {
  return `https://api.github.com/repos/micronaut-projects/micronaut-test-resources/contents/gradle.properties?ref=${encodeURIComponent(ref)}`;
}

async function withPathOverride(pathValue: string, run: () => Promise<void>): Promise<void> {
  const previousPath = process.env.PATH;

  process.env.PATH = pathValue;
  try {
    await run();
  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
  }
}

async function withFakeGh(scriptBody: string, run: (logPath: string) => Promise<void>): Promise<void> {
  if (process.platform === "win32") {
    throw new Error("withFakeGh is not supported on win32.");
  }

  const tempDir = await mkdtemp(join(tmpdir(), "paperclip-micronaut-plugin-gh-"));
  const ghPath = join(tempDir, "gh");
  const logPath = join(tempDir, "gh.log");
  const previousLogPath = process.env.MICRONAUT_TEST_GH_LOG;
  const previousGhBin = process.env.PAPERCLIP_MICRONAUT_GH_BIN;

  try {
    await writeFile(ghPath, scriptBody, "utf8");
    await chmod(ghPath, 0o755);
    process.env.MICRONAUT_TEST_GH_LOG = logPath;
    process.env.PAPERCLIP_MICRONAUT_GH_BIN = ghPath;

    await withPathOverride(
      [tempDir, process.env.PATH ?? ""].filter(Boolean).join(delimiter),
      async () => {
        await run(logPath);
      }
    );
  } finally {
    if (previousLogPath === undefined) {
      delete process.env.MICRONAUT_TEST_GH_LOG;
    } else {
      process.env.MICRONAUT_TEST_GH_LOG = previousLogPath;
    }

    if (previousGhBin === undefined) {
      delete process.env.PAPERCLIP_MICRONAUT_GH_BIN;
    } else {
      process.env.PAPERCLIP_MICRONAUT_GH_BIN = previousGhBin;
    }

    await rm(tempDir, { force: true, recursive: true });
  }
}

describe("micronaut project detail tab", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn(async (input) => {
      const url = String(input);

      if (url === "https://api.github.com/repos/micronaut-projects/micronaut-test-resources") {
        return jsonResponse({
          default_branch: "4.0.x"
        });
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/branches/4.0.x"
      ) {
        return jsonResponse({
          name: "4.0.x",
          commit: {
            sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
          }
        });
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      ) {
        return jsonResponse({
          html_url:
            "https://github.com/micronaut-projects/micronaut-test-resources/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          commit: {
            committer: {
              date: "2026-03-18T10:15:00.000Z"
            }
          }
        });
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/branches/4.1.x"
      ) {
        return jsonResponse({
          name: "4.1.x",
          commit: {
            sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
          }
        });
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/commits/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      ) {
        return jsonResponse({
          html_url:
            "https://github.com/micronaut-projects/micronaut-test-resources/commit/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          commit: {
            committer: {
              date: "2026-03-20T12:30:00.000Z"
            }
          }
        });
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/compare/4.0.x...4.1.x"
      ) {
        return jsonResponse({
          html_url:
            "https://github.com/micronaut-projects/micronaut-test-resources/compare/4.0.x...4.1.x",
          ahead_by: 3,
          behind_by: 1
        });
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/branches/5.0.x"
      ) {
        return jsonResponse(
          {
            message: "Branch not found"
          },
          404
        );
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/releases/latest"
      ) {
        return jsonResponse({
          tag_name: "v3.0.0",
          html_url:
            "https://github.com/micronaut-projects/micronaut-test-resources/releases/tag/v3.0.0"
        });
      }

      if (url === gradlePropertiesContentsUrl("4.0.x")) {
        return gitHubContentsResponse("projectVersion=4.0.0-SNAPSHOT\n");
      }

      if (url === gradlePropertiesContentsUrl("4.1.x")) {
        return gitHubContentsResponse("projectVersion=4.0.0-SNAPSHOT\n");
      }

      return new Response("Not found", { status: 404 });
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("declares a project detail tab and resolves Micronaut version data", async () => {
    const harness = createTestHarness({
      manifest,
      capabilities: [...manifest.capabilities]
    });
    harness.seed({
      projects: [createProject("https://github.com/micronaut-projects/micronaut-test-resources")]
    });

    await expect(plugin.definition.setup(harness.ctx)).resolves.toBeUndefined();

    expect(manifest.version).toBe(packageJson.version);
    expect(manifest.capabilities).toEqual([
      "projects.read",
      "agents.read",
      "agents.invoke",
      "issues.read",
      "issues.create",
      "issues.update",
      "plugin.state.read",
      "plugin.state.write",
      "http.outbound",
      "ui.detailTab.register"
    ]);
    expect(manifest.entrypoints.ui).toBe("./dist/ui");
    expect(manifest.ui?.slots).toEqual([
      expect.objectContaining({
        type: "detailTab",
        id: MICRONAUT_PROJECT_DETAIL_TAB_ID,
        displayName: "Micronaut branches",
        exportName: "MicronautProjectDetailTab",
        entityTypes: ["project"]
      })
    ]);

    const data = await harness.getData<MicronautProjectOverview>(
      MICRONAUT_PROJECT_OVERVIEW_DATA_KEY,
      {
        companyId: "company-1",
        projectId: "project-1"
      }
    );

    expect(data).toEqual({
      kind: "ready",
      repoUrl: "https://github.com/micronaut-projects/micronaut-test-resources",
      repoFullName: "micronaut-projects/micronaut-test-resources",
      defaultBranch: "4.0.x",
      currentVersion: "3.0.0",
      currentVersionUrl:
        "https://github.com/micronaut-projects/micronaut-test-resources/releases/tag/v3.0.0",
      nextVersion: "4.0.0",
      gradlePropertiesUrl:
        "https://github.com/micronaut-projects/micronaut-test-resources/blob/4.0.x/gradle.properties",
      lastCheckedAt: expect.any(String),
      branches: [
        {
          role: "default",
          label: "Default branch",
          name: "4.0.x",
          url: "https://github.com/micronaut-projects/micronaut-test-resources/tree/4.0.x",
          compareUrl: null,
          exists: true,
          syncStatus: "default",
          aheadBy: 0,
          behindBy: 0,
          lastUpdatedAt: "2026-03-18T10:15:00.000Z",
          lastCommitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          lastCommitUrl:
            "https://github.com/micronaut-projects/micronaut-test-resources/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          projectVersion: "4.0.0-SNAPSHOT",
          projectVersionUrl:
            "https://github.com/micronaut-projects/micronaut-test-resources/blob/4.0.x/gradle.properties",
          expectedProjectVersion: "4.0.0-SNAPSHOT",
          versionStatus: "default",
          canCreateBranch: false,
          canMergeUp: false,
          canSetDefault: false
        },
        {
          role: "nextMinor",
          label: "Next minor branch",
          name: "4.1.x",
          url: "https://github.com/micronaut-projects/micronaut-test-resources/tree/4.1.x",
          compareUrl:
            "https://github.com/micronaut-projects/micronaut-test-resources/compare/4.0.x...4.1.x",
          exists: true,
          syncStatus: "diverged",
          aheadBy: 3,
          behindBy: 1,
          lastUpdatedAt: "2026-03-20T12:30:00.000Z",
          lastCommitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          lastCommitUrl:
            "https://github.com/micronaut-projects/micronaut-test-resources/commit/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          projectVersion: "4.0.0-SNAPSHOT",
          projectVersionUrl:
            "https://github.com/micronaut-projects/micronaut-test-resources/blob/4.1.x/gradle.properties",
          expectedProjectVersion: "4.1.0-SNAPSHOT",
          versionStatus: "behind",
          canCreateBranch: false,
          canMergeUp: true,
          canSetDefault: false
        },
        {
          role: "nextMajor",
          label: "Next major branch",
          name: "5.0.x",
          url: "https://github.com/micronaut-projects/micronaut-test-resources/tree/5.0.x",
          compareUrl:
            "https://github.com/micronaut-projects/micronaut-test-resources/compare/4.0.x...5.0.x",
          exists: false,
          syncStatus: "missing",
          aheadBy: null,
          behindBy: null,
          lastUpdatedAt: null,
          lastCommitSha: null,
          lastCommitUrl: null,
          projectVersion: null,
          projectVersionUrl: null,
          expectedProjectVersion: "5.0.0-SNAPSHOT",
          versionStatus: "missing",
          canCreateBranch: true,
          canMergeUp: false,
          canSetDefault: false
        }
      ],
      warnings: []
    });
  });

  it("normalizes manifest versions from release-style environment variables", () => {
    expect(normalizeManifestVersion("v1.2.3")).toBe("1.2.3");
  });

  it("rejects invalid manifest versions so callers can fall back safely", () => {
    expect(normalizeManifestVersion("not-a-version")).toBeNull();
    expect(normalizeManifestVersion("")).toBeNull();
    expect(normalizeManifestVersion(packageJson.version)).toBe(packageJson.version);
  });

  it("matches symlinked worker entrypoints to the real worker file", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "paperclip-micronaut-plugin-worker-path-"));
    const realWorkerPath = join(tempDir, "worker.js");
    const symlinkWorkerPath = join(tempDir, "worker-symlink.js");

    try {
      await writeFile(realWorkerPath, "// test worker entrypoint\n");
      await symlink(realWorkerPath, symlinkWorkerPath);

      expect(
        workerModule.shouldStartWorkerHost(pathToFileURL(realWorkerPath).href, symlinkWorkerPath)
      ).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects unrelated worker entrypoints", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "paperclip-micronaut-plugin-worker-path-"));
    const realWorkerPath = join(tempDir, "worker.js");
    const unrelatedWorkerPath = join(tempDir, "other-worker.js");

    try {
      await writeFile(realWorkerPath, "// test worker entrypoint\n");
      await writeFile(unrelatedWorkerPath, "// different worker entrypoint\n");

      expect(
        workerModule.shouldStartWorkerHost(pathToFileURL(realWorkerPath).href, unrelatedWorkerPath)
      ).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  itWithFakeGh("surfaces gh remediation when rate-limited GitHub metadata cannot fall back to gh", async () => {
    global.fetch = vi.fn(async (input) => {
      const url = String(input);

      if (url.startsWith("https://api.github.com/repos/micronaut-projects/micronaut-test-resources")) {
        return jsonResponse(
          {
            message: "API rate limit exceeded"
          },
          403
        );
      }

      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    await withFakeGh(
      `#!/bin/sh
echo "$@" >> "$MICRONAUT_TEST_GH_LOG"
if [ "$1" = "api" ] && [ "$2" = "repos/micronaut-projects/micronaut-test-resources" ]; then
  printf '%s\\n' '{"default_branch":"4.0.x"}'
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "repos/micronaut-projects/micronaut-test-resources/releases/latest" ]; then
  printf '%s\\n' '{"tag_name":"v3.0.0","html_url":"https://github.com/micronaut-projects/micronaut-test-resources/releases/tag/v3.0.0"}'
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "repos/micronaut-projects/micronaut-test-resources/branches/4.0.x" ]; then
  printf '%s\\n' '{"name":"4.0.x","commit":{"sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}'
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "repos/micronaut-projects/micronaut-test-resources/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" ]; then
  printf '%s\\n' '{"html_url":"https://github.com/micronaut-projects/micronaut-test-resources/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","commit":{"committer":{"date":"2026-03-18T10:15:00.000Z"}}}'
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "repos/micronaut-projects/micronaut-test-resources/branches/4.1.x" ]; then
  printf '%s\\n' '{"name":"4.1.x","commit":{"sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}'
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "repos/micronaut-projects/micronaut-test-resources/commits/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" ]; then
  printf '%s\\n' '{"html_url":"https://github.com/micronaut-projects/micronaut-test-resources/commit/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","commit":{"committer":{"date":"2026-03-20T12:30:00.000Z"}}}'
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "repos/micronaut-projects/micronaut-test-resources/compare/4.0.x...4.1.x" ]; then
  printf '%s\\n' '{"html_url":"https://github.com/micronaut-projects/micronaut-test-resources/compare/4.0.x...4.1.x","ahead_by":3,"behind_by":1}'
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "repos/micronaut-projects/micronaut-test-resources/contents/gradle.properties?ref=4.0.x" ]; then
  printf '%s\\n' '{"type":"file","encoding":"base64","content":"${Buffer.from("projectVersion=4.0.0-SNAPSHOT\n", "utf8").toString("base64")}"}'
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "repos/micronaut-projects/micronaut-test-resources/contents/gradle.properties?ref=4.1.x" ]; then
  printf '%s\\n' '{"type":"file","encoding":"base64","content":"${Buffer.from("projectVersion=4.0.0-SNAPSHOT\n", "utf8").toString("base64")}"}'
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "repos/micronaut-projects/micronaut-test-resources/branches/5.0.x" ]; then
  echo 'gh: Not Found (HTTP 404)' >&2
  exit 1
fi
echo "unexpected gh invocation: $@" >&2
exit 1
`,
      async (logPath) => {
        const harness = createTestHarness({
          manifest,
          capabilities: [...manifest.capabilities]
        });
        harness.seed({
          projects: [createProject("https://github.com/micronaut-projects/micronaut-test-resources")]
        });

        await plugin.definition.setup(harness.ctx);

        const data = await harness.getData<MicronautProjectOverview>(
          MICRONAUT_PROJECT_OVERVIEW_DATA_KEY,
          {
            companyId: "company-1",
            projectId: "project-1"
          }
        );

        expect(data).toEqual({
          kind: "ready",
          repoUrl: "https://github.com/micronaut-projects/micronaut-test-resources",
          repoFullName: "micronaut-projects/micronaut-test-resources",
          defaultBranch: "4.0.x",
          currentVersion: "3.0.0",
          currentVersionUrl:
            "https://github.com/micronaut-projects/micronaut-test-resources/releases/tag/v3.0.0",
          nextVersion: "4.0.0",
          gradlePropertiesUrl:
            "https://github.com/micronaut-projects/micronaut-test-resources/blob/4.0.x/gradle.properties",
          lastCheckedAt: expect.any(String),
          branches: [
            {
              role: "default",
              label: "Default branch",
              name: "4.0.x",
              url: "https://github.com/micronaut-projects/micronaut-test-resources/tree/4.0.x",
              compareUrl: null,
              exists: true,
              syncStatus: "default",
              aheadBy: 0,
              behindBy: 0,
              lastUpdatedAt: "2026-03-18T10:15:00.000Z",
              lastCommitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              lastCommitUrl:
                "https://github.com/micronaut-projects/micronaut-test-resources/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              projectVersion: "4.0.0-SNAPSHOT",
              projectVersionUrl:
                "https://github.com/micronaut-projects/micronaut-test-resources/blob/4.0.x/gradle.properties",
              expectedProjectVersion: "4.0.0-SNAPSHOT",
              versionStatus: "default",
              canCreateBranch: false,
              canMergeUp: false,
              canSetDefault: false
            },
            {
              role: "nextMinor",
              label: "Next minor branch",
              name: "4.1.x",
              url: "https://github.com/micronaut-projects/micronaut-test-resources/tree/4.1.x",
              compareUrl:
                "https://github.com/micronaut-projects/micronaut-test-resources/compare/4.0.x...4.1.x",
              exists: true,
              syncStatus: "diverged",
              aheadBy: 3,
              behindBy: 1,
              lastUpdatedAt: "2026-03-20T12:30:00.000Z",
              lastCommitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              lastCommitUrl:
                "https://github.com/micronaut-projects/micronaut-test-resources/commit/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              projectVersion: "4.0.0-SNAPSHOT",
              projectVersionUrl:
                "https://github.com/micronaut-projects/micronaut-test-resources/blob/4.1.x/gradle.properties",
              expectedProjectVersion: "4.1.0-SNAPSHOT",
              versionStatus: "behind",
              canCreateBranch: false,
              canMergeUp: true,
              canSetDefault: false
            },
            {
              role: "nextMajor",
              label: "Next major branch",
              name: "5.0.x",
              url: "https://github.com/micronaut-projects/micronaut-test-resources/tree/5.0.x",
              compareUrl:
                "https://github.com/micronaut-projects/micronaut-test-resources/compare/4.0.x...5.0.x",
              exists: false,
              syncStatus: "missing",
              aheadBy: null,
              behindBy: null,
              lastUpdatedAt: null,
              lastCommitSha: null,
              lastCommitUrl: null,
              projectVersion: null,
              projectVersionUrl: null,
              expectedProjectVersion: "5.0.0-SNAPSHOT",
              versionStatus: "missing",
              canCreateBranch: true,
              canMergeUp: false,
              canSetDefault: false
            }
          ],
          warnings: []
        });

        const commandLog = await readFile(logPath, "utf8");
        expect(commandLog).toContain("api repos/micronaut-projects/micronaut-test-resources");
        expect(commandLog).toContain("api repos/micronaut-projects/micronaut-test-resources/releases/latest");
        expect(commandLog).toContain("api repos/micronaut-projects/micronaut-test-resources/branches/4.0.x");
        expect(commandLog).toContain("api repos/micronaut-projects/micronaut-test-resources/compare/4.0.x...4.1.x");
        expect(commandLog).toContain(
          "api repos/micronaut-projects/micronaut-test-resources/contents/gradle.properties?ref=4.0.x"
        );
      }
    );
  });

  itWithFakeGh("falls back to gh for gradle.properties when GitHub contents reads abort", async () => {
    global.fetch = vi.fn(async (input) => {
      const url = String(input);

      if (url === "https://api.github.com/repos/micronaut-projects/micronaut-test-resources") {
        return jsonResponse({
          default_branch: "4.0.x"
        });
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/branches/4.0.x"
      ) {
        return jsonResponse({
          name: "4.0.x",
          commit: {
            sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
          }
        });
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      ) {
        return jsonResponse({
          html_url:
            "https://github.com/micronaut-projects/micronaut-test-resources/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          commit: {
            committer: {
              date: "2026-03-18T10:15:00.000Z"
            }
          }
        });
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/branches/4.1.x"
      ) {
        return jsonResponse({
          name: "4.1.x",
          commit: {
            sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
          }
        });
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/commits/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      ) {
        return jsonResponse({
          html_url:
            "https://github.com/micronaut-projects/micronaut-test-resources/commit/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          commit: {
            committer: {
              date: "2026-03-20T12:30:00.000Z"
            }
          }
        });
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/compare/4.0.x...4.1.x"
      ) {
        return jsonResponse({
          html_url:
            "https://github.com/micronaut-projects/micronaut-test-resources/compare/4.0.x...4.1.x",
          ahead_by: 3,
          behind_by: 1
        });
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/branches/5.0.x"
      ) {
        return jsonResponse(
          {
            message: "Branch not found"
          },
          404
        );
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/releases/latest"
      ) {
        return jsonResponse({
          tag_name: "v3.0.0",
          html_url:
            "https://github.com/micronaut-projects/micronaut-test-resources/releases/tag/v3.0.0"
        });
      }

      if (url === gradlePropertiesContentsUrl("4.0.x") || url === gradlePropertiesContentsUrl("4.1.x")) {
        throw new Error("The operation was aborted");
      }

      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    await withFakeGh(
      `#!/bin/sh
echo "$@" >> "$MICRONAUT_TEST_GH_LOG"
if [ "$1" = "api" ] && [ "$2" = "repos/micronaut-projects/micronaut-test-resources/contents/gradle.properties?ref=4.0.x" ]; then
  printf '%s\\n' '{"type":"file","encoding":"base64","content":"${Buffer.from("projectVersion=4.0.0-SNAPSHOT\n", "utf8").toString("base64")}"}'
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "repos/micronaut-projects/micronaut-test-resources/contents/gradle.properties?ref=4.1.x" ]; then
  printf '%s\\n' '{"type":"file","encoding":"base64","content":"${Buffer.from("projectVersion=4.0.0-SNAPSHOT\n", "utf8").toString("base64")}"}'
  exit 0
fi
echo "unexpected gh invocation: $@" >&2
exit 1
`,
      async (logPath) => {
        const harness = createTestHarness({
          manifest,
          capabilities: [...manifest.capabilities]
        });
        harness.seed({
          projects: [createProject("https://github.com/micronaut-projects/micronaut-test-resources")]
        });

        await plugin.definition.setup(harness.ctx);

        const data = await harness.getData<MicronautProjectOverview>(
          MICRONAUT_PROJECT_OVERVIEW_DATA_KEY,
          {
            companyId: "company-1",
            projectId: "project-1"
          }
        );

        expect(data).toEqual(
          expect.objectContaining({
            kind: "ready",
            nextVersion: "4.0.0",
            warnings: []
          })
        );
        if (data.kind !== "ready") {
          return;
        }

        expect(data.branches).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role: "default",
              projectVersion: "4.0.0-SNAPSHOT"
            }),
            expect.objectContaining({
              role: "nextMinor",
              projectVersion: "4.0.0-SNAPSHOT"
            })
          ])
        );

        const commandLog = await readFile(logPath, "utf8");
        expect(commandLog).toContain(
          "api repos/micronaut-projects/micronaut-test-resources/contents/gradle.properties?ref=4.0.x"
        );
        expect(commandLog).toContain(
          "api repos/micronaut-projects/micronaut-test-resources/contents/gradle.properties?ref=4.1.x"
        );
      }
    );
  });

  it("surfaces gh remediation when rate-limited GitHub metadata cannot fall back to gh", async () => {
    global.fetch = vi.fn(async (input) => {
      const url = String(input);

      if (url.startsWith("https://api.github.com/repos/micronaut-projects/micronaut-test-resources")) {
        return jsonResponse(
          {
            message: "API rate limit exceeded"
          },
          403
        );
      }

      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const tempDir = await mkdtemp(join(tmpdir(), "paperclip-micronaut-plugin-rate-limit-no-gh-"));
    const previousGhBin = process.env.PAPERCLIP_MICRONAUT_GH_BIN;

    try {
      process.env.PAPERCLIP_MICRONAUT_GH_BIN = join(
        tempDir,
        process.platform === "win32" ? "gh.exe" : "gh"
      );

      await withPathOverride(tempDir, async () => {
        const harness = createTestHarness({
          manifest,
          capabilities: [...manifest.capabilities]
        });
        harness.seed({
          projects: [createProject("https://github.com/micronaut-projects/micronaut-test-resources")]
        });

        await plugin.definition.setup(harness.ctx);

        const data = await harness.getData<MicronautProjectOverview>(
          MICRONAUT_PROJECT_OVERVIEW_DATA_KEY,
          {
            companyId: "company-1",
            projectId: "project-1"
          }
        );

        expect(data.kind).toBe("ready");
        if (data.kind !== "ready") {
          return;
        }

        expect(data.warnings).toEqual(
          expect.arrayContaining([
            expect.stringContaining(
              "GitHub CLI (`gh`) is not installed on the Paperclip host. Install it to create branches from this tab."
            )
          ])
        );
      });
    } finally {
      if (previousGhBin === undefined) {
        delete process.env.PAPERCLIP_MICRONAUT_GH_BIN;
      } else {
        process.env.PAPERCLIP_MICRONAUT_GH_BIN = previousGhBin;
      }

      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("returns cached Micronaut data until an explicit refresh is requested", async () => {
    let releaseTag = "v3.0.0";
    const releaseEndpoint =
      "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/releases/latest";

    global.fetch = vi.fn(async (input) => {
      const url = String(input);

      if (url === "https://api.github.com/repos/micronaut-projects/micronaut-test-resources") {
        return jsonResponse({
          default_branch: "4.0.x"
        });
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/branches/4.0.x"
      ) {
        return jsonResponse({
          name: "4.0.x",
          commit: {
            sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
          }
        });
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      ) {
        return jsonResponse({
          html_url:
            "https://github.com/micronaut-projects/micronaut-test-resources/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          commit: {
            committer: {
              date: "2026-03-18T10:15:00.000Z"
            }
          }
        });
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/branches/4.1.x"
      ) {
        return jsonResponse({
          name: "4.1.x",
          commit: {
            sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
          }
        });
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/commits/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      ) {
        return jsonResponse({
          html_url:
            "https://github.com/micronaut-projects/micronaut-test-resources/commit/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          commit: {
            committer: {
              date: "2026-03-20T12:30:00.000Z"
            }
          }
        });
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/compare/4.0.x...4.1.x"
      ) {
        return jsonResponse({
          html_url:
            "https://github.com/micronaut-projects/micronaut-test-resources/compare/4.0.x...4.1.x",
          ahead_by: 3,
          behind_by: 1
        });
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/branches/5.0.x"
      ) {
        return jsonResponse(
          {
            message: "Branch not found"
          },
          404
        );
      }

      if (url === releaseEndpoint) {
        return jsonResponse({
          tag_name: releaseTag,
          html_url:
            `https://github.com/micronaut-projects/micronaut-test-resources/releases/tag/${releaseTag}`
        });
      }

      if (url === gradlePropertiesContentsUrl("4.0.x")) {
        return gitHubContentsResponse("projectVersion=4.0.0-SNAPSHOT\n");
      }

      if (url === gradlePropertiesContentsUrl("4.1.x")) {
        return gitHubContentsResponse("projectVersion=4.0.0-SNAPSHOT\n");
      }

      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const harness = createTestHarness({
      manifest,
      capabilities: [...manifest.capabilities]
    });
    harness.seed({
      projects: [createProject("https://github.com/micronaut-projects/micronaut-test-resources")]
    });

    await plugin.definition.setup(harness.ctx);

    const params = {
      companyId: "company-1",
      projectId: "project-1"
    };
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const releaseFetchCount = () =>
      fetchMock.mock.calls.filter(([input]) => String(input) === releaseEndpoint).length;

    const first = await harness.getData<MicronautProjectOverview>(
      MICRONAUT_PROJECT_OVERVIEW_DATA_KEY,
      params
    );
    expect(first).toEqual(
      expect.objectContaining({
        kind: "ready",
        currentVersion: "3.0.0",
        lastCheckedAt: expect.any(String)
      })
    );

    const releaseCallsAfterFirstRead = releaseFetchCount();

    releaseTag = "v3.1.0";

    const second = await harness.getData<MicronautProjectOverview>(
      MICRONAUT_PROJECT_OVERVIEW_DATA_KEY,
      params
    );
    expect(second).toEqual(
      expect.objectContaining({
        kind: "ready",
        currentVersion: "3.0.0",
        lastCheckedAt: expect.any(String)
      })
    );
    expect(releaseFetchCount()).toBe(releaseCallsAfterFirstRead);

    const refreshed = await harness.performAction<MicronautProjectOverview>(
      MICRONAUT_REFRESH_PROJECT_OVERVIEW_ACTION_KEY,
      params
    );
    expect(refreshed).toEqual(
      expect.objectContaining({
        kind: "ready",
        currentVersion: "3.1.0",
        lastCheckedAt: expect.any(String)
      })
    );
    expect(releaseFetchCount()).toBe(releaseCallsAfterFirstRead + 1);

    const third = await harness.getData<MicronautProjectOverview>(
      MICRONAUT_PROJECT_OVERVIEW_DATA_KEY,
      params
    );
    expect(third).toEqual(
      expect.objectContaining({
        kind: "ready",
        currentVersion: "3.1.0",
        lastCheckedAt: expect.any(String)
      })
    );
    expect(releaseFetchCount()).toBe(releaseCallsAfterFirstRead + 1);
  });

  it("marks an ahead branch as set-default eligible even when its projectVersion is behind", async () => {
    global.fetch = vi.fn(async (input) => {
      const url = String(input);

      if (url === "https://api.github.com/repos/micronaut-projects/micronaut-test-resources") {
        return jsonResponse({
          default_branch: "4.0.x"
        });
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/branches/4.0.x"
      ) {
        return jsonResponse({
          name: "4.0.x",
          commit: {
            sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
          }
        });
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      ) {
        return jsonResponse({
          html_url:
            "https://github.com/micronaut-projects/micronaut-test-resources/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          commit: {
            committer: {
              date: "2026-03-18T10:15:00.000Z"
            }
          }
        });
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/branches/4.1.x"
      ) {
        return jsonResponse({
          name: "4.1.x",
          commit: {
            sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
          }
        });
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/commits/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      ) {
        return jsonResponse({
          html_url:
            "https://github.com/micronaut-projects/micronaut-test-resources/commit/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          commit: {
            committer: {
              date: "2026-03-20T12:30:00.000Z"
            }
          }
        });
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/compare/4.0.x...4.1.x"
      ) {
        return jsonResponse({
          html_url:
            "https://github.com/micronaut-projects/micronaut-test-resources/compare/4.0.x...4.1.x",
          ahead_by: 2,
          behind_by: 0
        });
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/branches/5.0.x"
      ) {
        return jsonResponse(
          {
            message: "Branch not found"
          },
          404
        );
      }

      if (
        url ===
        "https://api.github.com/repos/micronaut-projects/micronaut-test-resources/releases/latest"
      ) {
        return jsonResponse({
          tag_name: "v3.0.0",
          html_url:
            "https://github.com/micronaut-projects/micronaut-test-resources/releases/tag/v3.0.0"
        });
      }

      if (url === gradlePropertiesContentsUrl("4.0.x")) {
        return gitHubContentsResponse("projectVersion=4.0.0-SNAPSHOT\n");
      }

      if (url === gradlePropertiesContentsUrl("4.1.x")) {
        return gitHubContentsResponse("projectVersion=4.0.0-SNAPSHOT\n");
      }

      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const harness = createTestHarness({
      manifest,
      capabilities: [...manifest.capabilities]
    });
    harness.seed({
      projects: [createProject("https://github.com/micronaut-projects/micronaut-test-resources")]
    });

    await plugin.definition.setup(harness.ctx);

    const data = await harness.getData<MicronautProjectOverview>(
      MICRONAUT_PROJECT_OVERVIEW_DATA_KEY,
      {
        companyId: "company-1",
        projectId: "project-1"
      }
    );

    expect(data.kind).toBe("ready");
    if (data.kind !== "ready") {
      return;
    }

    expect(data.branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "nextMinor",
          name: "4.1.x",
          syncStatus: "ahead",
          aheadBy: 2,
          behindBy: 0,
          projectVersion: "4.0.0-SNAPSHOT",
          expectedProjectVersion: "4.1.0-SNAPSHOT",
          versionStatus: "behind",
          canMergeUp: false,
          canSetDefault: true
        })
      ])
    );
  });

  it("reads merge-up state, lists available agents, and clears deleted preferences", async () => {
    const harness = createTestHarness({
      manifest,
      capabilities: [...manifest.capabilities]
    });
    harness.seed({
      projects: [createProject("https://github.com/micronaut-projects/micronaut-test-resources")],
      agents: [
        createAgent("agent-b", { name: "Beta Engineer", icon: "rocket" }),
        createAgent("agent-a", { name: "Alpha Engineer", icon: "crown" }),
        createAgent("agent-paused", {
          name: "Paused Engineer",
          icon: "shield",
          status: "paused"
        }),
        createAgent("agent-pending", {
          name: "Pending Engineer",
          status: "pending_approval"
        }),
        createAgent("agent-terminated", {
          name: "Terminated Engineer",
          status: "terminated"
        })
      ]
    });

    await plugin.definition.setup(harness.ctx);
    await harness.ctx.state.set(buildCompanySettingsScope("company-1"), {
      version: 1,
      preferredMergeUpAgentId: "deleted-agent"
    });

    const state = await harness.getData<MicronautMergeUpState>(MICRONAUT_MERGE_UP_STATE_DATA_KEY, {
      companyId: "company-1",
      projectId: "project-1"
    });

    expect(state).toEqual({
      kind: "ready",
      preferredAgentId: null,
      preferredAgentName: null,
      agents: [
        {
          id: "agent-a",
          name: "Alpha Engineer",
          urlKey: "agent-a",
          title: "Software Engineer",
          icon: "crown",
          status: "idle"
        },
        {
          id: "agent-b",
          name: "Beta Engineer",
          urlKey: "agent-b",
          title: "Software Engineer",
          icon: "rocket",
          status: "idle"
        },
        {
          id: "agent-paused",
          name: "Paused Engineer",
          urlKey: "agent-paused",
          title: "Software Engineer",
          icon: "shield",
          status: "paused"
        }
      ],
      issues: []
    });
    expect(harness.getState(buildCompanySettingsScope("company-1"))).toEqual({
      version: 1,
      preferredMergeUpAgentId: null
    });
  });

  it("stores the preferred merge-up agent for the company", async () => {
    const harness = createTestHarness({
      manifest,
      capabilities: [...manifest.capabilities]
    });
    harness.seed({
      projects: [createProject("https://github.com/micronaut-projects/micronaut-test-resources")],
      agents: [
        createAgent("agent-a", { name: "Alpha Engineer" }),
        createAgent("agent-b", { name: "Beta Engineer", icon: "rocket" })
      ]
    });

    await plugin.definition.setup(harness.ctx);

    const selectedAgent = await harness.performAction(MICRONAUT_SET_MERGE_UP_AGENT_ACTION_KEY, {
      companyId: "company-1",
      agentId: "agent-b"
    });

    expect(selectedAgent).toEqual({
      id: "agent-b",
      name: "Beta Engineer",
      urlKey: "agent-b",
      title: "Software Engineer",
      icon: "rocket",
      status: "idle"
    });

    const state = await harness.getData<MicronautMergeUpState>(MICRONAUT_MERGE_UP_STATE_DATA_KEY, {
      companyId: "company-1",
      projectId: "project-1"
    });

    expect(state.preferredAgentId).toBe("agent-b");
    expect(state.preferredAgentName).toBe("Beta Engineer");
    expect(harness.getState(buildCompanySettingsScope("company-1"))).toEqual({
      version: 1,
      preferredMergeUpAgentId: "agent-b"
    });
  });

  it("starts a merge-up issue, remembers the selected agent, and persists tracked state", async () => {
    const harness = createTestHarness({
      manifest,
      capabilities: [...manifest.capabilities]
    });
    harness.seed({
      projects: [createProject("https://github.com/micronaut-projects/micronaut-test-resources")],
      agents: [createAgent("agent-merge", { name: "Merge Bot" })]
    });
    const invokeAgentSpy = vi.spyOn(harness.ctx.agents, "invoke");
    const createIssueSpy = vi.spyOn(harness.ctx.issues, "create");
    const updateIssueSpy = vi.spyOn(harness.ctx.issues, "update");

    await plugin.definition.setup(harness.ctx);

    const result = await harness.performAction<MicronautStartMergeUpResult>(
      MICRONAUT_START_MERGE_UP_ACTION_KEY,
      {
        companyId: "company-1",
        projectId: "project-1",
        targetBranch: "4.1.x",
        agentId: "agent-merge"
      }
    );

    expect(result).toEqual({
      status: "created",
      issue: expect.objectContaining({
        targetBranch: "4.1.x",
        sourceBranch: "4.0.x",
        issueId: expect.any(String),
        issueIdentifier: expect.any(String),
        issueTitle: "Merge up 4.0.x into 4.1.x",
        pullRequestUrl: null,
        status: "todo",
        agentId: "agent-merge",
        agentName: "Merge Bot",
        agentUrlKey: "agent-merge",
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        closedAt: null
      })
    });
    expect(harness.getState(buildCompanySettingsScope("company-1"))).toEqual({
      version: 1,
      preferredMergeUpAgentId: "agent-merge"
    });
    expect(createIssueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        projectId: "project-1",
        title: "Merge up 4.0.x into 4.1.x",
        assigneeAgentId: "agent-merge",
        priority: "medium"
      })
    );
    const issueCreateRequest = createIssueSpy.mock.lastCall?.[0];
    expect(issueCreateRequest?.description).toContain("Project: Micronaut Test Resources");
    expect(issueCreateRequest?.description).toContain(
      "Repository: micronaut-projects/micronaut-test-resources"
    );
    expect(issueCreateRequest?.description).toContain(
      "Never push directly to `4.0.x` or `4.1.x`."
    );
    expect(issueCreateRequest?.description).toContain(
      "projectVersion=4.0.0-SNAPSHOT` becomes `projectVersion=4.1.0-SNAPSHOT`"
    );
    expect(updateIssueSpy).toHaveBeenCalledWith(
      result.issue.issueId,
      { status: "todo" },
      "company-1",
    );
    expect(invokeAgentSpy).toHaveBeenCalledWith(
      "agent-merge",
      "company-1",
      expect.objectContaining({
        reason: "issue_assigned",
        prompt: expect.stringContaining("Open your assigned issue queue, pick up that issue immediately")
      })
    );
    const invokeRequest = invokeAgentSpy.mock.lastCall?.[2];
    expect(invokeRequest?.prompt).toContain("Merge up 4.0.x into 4.1.x");
    expect(invokeRequest?.prompt).toContain("micronaut-projects/micronaut-test-resources");
    expect(harness.getState(buildProjectMergeUpIssuesScope("project-1"))).toEqual({
      version: 1,
      issues: [
        expect.objectContaining({
          issueId: result.issue.issueId,
          targetBranch: "4.1.x",
          sourceBranch: "4.0.x",
          issueTitle: "Merge up 4.0.x into 4.1.x",
          agentId: "agent-merge",
          agentName: "Merge Bot",
          agentUrlKey: "agent-merge",
          createdAt: expect.any(String)
        })
      ]
    });

    const state = await harness.getData<MicronautMergeUpState>(MICRONAUT_MERGE_UP_STATE_DATA_KEY, {
      companyId: "company-1",
      projectId: "project-1"
    });

    expect(state.preferredAgentId).toBe("agent-merge");
    expect(state.preferredAgentName).toBe("Merge Bot");
    expect(state.issues).toEqual([
      expect.objectContaining({
        issueId: result.issue.issueId,
        targetBranch: "4.1.x",
        sourceBranch: "4.0.x",
        issueTitle: "Merge up 4.0.x into 4.1.x",
        pullRequestUrl: null,
        status: "todo",
        agentUrlKey: "agent-merge",
        closedAt: null
      })
    ]);
  });

  it("hydrates the latest pull request URL from merge-up issue comments after the issue closes", async () => {
    const harness = createTestHarness({
      manifest,
      capabilities: [...manifest.capabilities]
    });
    harness.seed({
      projects: [createProject("https://github.com/micronaut-projects/micronaut-test-resources")],
      agents: [createAgent("agent-merge", { name: "Merge Bot" })]
    });

    await plugin.definition.setup(harness.ctx);

    const result = await harness.performAction<MicronautStartMergeUpResult>(
      MICRONAUT_START_MERGE_UP_ACTION_KEY,
      {
        companyId: "company-1",
        projectId: "project-1",
        targetBranch: "4.1.x",
        agentId: "agent-merge"
      }
    );

    vi.spyOn(harness.ctx.issues, "listComments").mockResolvedValue([
      {
        companyId: "company-1",
        id: "comment-1",
        issueId: result.issue.issueId,
        authorAgentId: "agent-merge",
        authorUserId: null,
        body: "Older PR https://github.com/micronaut-projects/micronaut-test-resources/pull/321",
        createdAt: new Date("2026-04-15T08:35:00.000Z"),
        updatedAt: new Date("2026-04-15T08:35:00.000Z")
      },
      {
        companyId: "company-1",
        id: "comment-2",
        issueId: result.issue.issueId,
        authorAgentId: "agent-merge",
        authorUserId: null,
        body: "Ready for review: https://github.com/micronaut-projects/micronaut-test-resources/pull/654",
        createdAt: new Date("2026-04-15T08:40:00.000Z"),
        updatedAt: new Date("2026-04-15T08:40:00.000Z")
      }
    ]);
    await harness.ctx.issues.update(result.issue.issueId, { status: "done" }, "company-1");

    const state = await harness.getData<MicronautMergeUpState>(MICRONAUT_MERGE_UP_STATE_DATA_KEY, {
      companyId: "company-1",
      projectId: "project-1"
    });

    expect(state.issues).toEqual([
      expect.objectContaining({
        issueId: result.issue.issueId,
        pullRequestUrl: "https://github.com/micronaut-projects/micronaut-test-resources/pull/654"
      })
    ]);
  });

  it("falls back to the Paperclip issue comments API when SDK comments do not include the PR link", async () => {
    vi.stubEnv("PAPERCLIP_API_URL", "http://127.0.0.1:3100");

    const harness = createTestHarness({
      manifest,
      capabilities: [...manifest.capabilities]
    });
    harness.seed({
      projects: [createProject("https://github.com/micronaut-projects/micronaut-test-resources")],
      agents: [createAgent("agent-merge", { name: "Merge Bot" })]
    });

    await plugin.definition.setup(harness.ctx);

    const result = await harness.performAction<MicronautStartMergeUpResult>(
      MICRONAUT_START_MERGE_UP_ACTION_KEY,
      {
        companyId: "company-1",
        projectId: "project-1",
        targetBranch: "4.1.x",
        agentId: "agent-merge"
      }
    );

    vi.spyOn(harness.ctx.issues, "listComments").mockResolvedValue([]);
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `http://127.0.0.1:3100/api/issues/${encodeURIComponent(result.issue.issueIdentifier)}/comments`) {
        return jsonResponse([
          {
            id: "comment-3",
            body: "Ready for review: https://github.com/micronaut-projects/micronaut-test-resources/pull/777",
            createdAt: "2026-04-15T08:45:00.000Z",
            updatedAt: "2026-04-15T08:45:00.000Z"
          }
        ]);
      }

      return new Response("Not found", { status: 404 });
    });
    await harness.ctx.issues.update(result.issue.issueId, { status: "done" }, "company-1");

    const state = await harness.getData<MicronautMergeUpState>(MICRONAUT_MERGE_UP_STATE_DATA_KEY, {
      companyId: "company-1",
      projectId: "project-1"
    });

    expect(state.issues).toEqual([
      expect.objectContaining({
        issueId: result.issue.issueId,
        pullRequestUrl: "https://github.com/micronaut-projects/micronaut-test-resources/pull/777"
      })
    ]);
  });

  it("returns already_exists when a merge-up issue is already open for the target branch", async () => {
    const harness = createTestHarness({
      manifest,
      capabilities: [...manifest.capabilities]
    });
    harness.seed({
      projects: [createProject("https://github.com/micronaut-projects/micronaut-test-resources")],
      agents: [createAgent("agent-merge", { name: "Merge Bot" })]
    });
    const createIssueSpy = vi.spyOn(harness.ctx.issues, "create");

    await plugin.definition.setup(harness.ctx);

    const first = await harness.performAction<MicronautStartMergeUpResult>(
      MICRONAUT_START_MERGE_UP_ACTION_KEY,
      {
        companyId: "company-1",
        projectId: "project-1",
        targetBranch: "4.1.x",
        agentId: "agent-merge"
      }
    );
    const second = await harness.performAction<MicronautStartMergeUpResult>(
      MICRONAUT_START_MERGE_UP_ACTION_KEY,
      {
        companyId: "company-1",
        projectId: "project-1",
        targetBranch: "4.1.x"
      }
    );

    expect(first.status).toBe("created");
    expect(createIssueSpy).toHaveBeenCalledTimes(1);
    expect(second).toEqual({
      status: "already_exists",
      issue: expect.objectContaining({
        issueId: first.issue.issueId,
        targetBranch: "4.1.x",
        sourceBranch: "4.0.x",
        issueTitle: "Merge up 4.0.x into 4.1.x",
        agentUrlKey: "agent-merge",
        status: "todo"
      })
    });
  });

  it("returns unsupported for non-Micronaut repositories", async () => {
    const harness = createTestHarness({
      manifest,
      capabilities: [...manifest.capabilities]
    });
    harness.seed({
      projects: [createProject("https://github.com/example/not-micronaut")]
    });

    await plugin.definition.setup(harness.ctx);

    const data = await harness.getData<MicronautProjectOverview>(
      MICRONAUT_PROJECT_OVERVIEW_DATA_KEY,
      {
        companyId: "company-1",
        projectId: "project-1"
      }
    );

    expect(data).toEqual({
      kind: "unsupported",
      reason:
        "This detail tab is only available for repositories in the micronaut-projects organization.",
      repoUrl: "https://github.com/example/not-micronaut"
    });
  });

  it("treats Micronaut GitHub organization matching case-insensitively", async () => {
    const harness = createTestHarness({
      manifest,
      capabilities: [...manifest.capabilities]
    });
    harness.seed({
      projects: [createProject("https://github.com/Micronaut-Projects/MICRONAUT-test-resources")]
    });

    await plugin.definition.setup(harness.ctx);

    const data = await harness.getData<MicronautProjectOverview>(
      MICRONAUT_PROJECT_OVERVIEW_DATA_KEY,
      {
        companyId: "company-1",
        projectId: "project-1"
      }
    );

    expect(data).toEqual(
      expect.objectContaining({
        kind: "ready",
        repoUrl: "https://github.com/micronaut-projects/micronaut-test-resources",
        repoFullName: "micronaut-projects/micronaut-test-resources"
      })
    );
  });

  itWithFakeGh("creates a missing Micronaut branch from the default branch", async () => {
    await withFakeGh(
      `#!/bin/sh
echo "$@" >> "$MICRONAUT_TEST_GH_LOG"
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  exit 0
fi
if [ "$1" = "api" ]; then
  printf 'refs/heads/5.0.x\\n'
  exit 0
fi
echo "unexpected gh invocation: $@" >&2
exit 1
`,
      async (logPath) => {
        const harness = createTestHarness({
          manifest,
          capabilities: [...manifest.capabilities]
        });
        harness.seed({
          projects: [createProject("https://github.com/micronaut-projects/micronaut-test-resources")]
        });

        await plugin.definition.setup(harness.ctx);

        const result = await harness.performAction<MicronautCreateBranchResult>(
          MICRONAUT_CREATE_BRANCH_ACTION_KEY,
          {
            companyId: "company-1",
            projectId: "project-1",
            branchName: "5.0.x"
          }
        );

        expect(result).toEqual({
          status: "created",
          branchName: "5.0.x",
          branchUrl: "https://github.com/micronaut-projects/micronaut-test-resources/tree/5.0.x",
          baseBranch: "4.0.x"
        });

        const commandLog = await readFile(logPath, "utf8");
        expect(commandLog).toContain("auth status --hostname github.com");
        expect(commandLog).toContain("api --method POST repos/micronaut-projects/micronaut-test-resources/git/refs");
        expect(commandLog).toContain("--field ref=refs/heads/5.0.x");
        expect(commandLog).toContain("--field sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      }
    );
  });

  it("reports when gh is not installed on the host", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "paperclip-micronaut-plugin-no-gh-"));
    const previousGhBin = process.env.PAPERCLIP_MICRONAUT_GH_BIN;

    try {
      process.env.PAPERCLIP_MICRONAUT_GH_BIN = join(tempDir, "gh");

      await withPathOverride(tempDir, async () => {
        const harness = createTestHarness({
          manifest,
          capabilities: [...manifest.capabilities]
        });
        harness.seed({
          projects: [createProject("https://github.com/micronaut-projects/micronaut-test-resources")]
        });

        await plugin.definition.setup(harness.ctx);

        await expect(
          harness.performAction(MICRONAUT_CREATE_BRANCH_ACTION_KEY, {
            companyId: "company-1",
            projectId: "project-1",
            branchName: "5.0.x"
          })
        ).rejects.toThrow("GitHub CLI (`gh`) is not installed on the Paperclip host.");
      });
    } finally {
      if (previousGhBin === undefined) {
        delete process.env.PAPERCLIP_MICRONAUT_GH_BIN;
      } else {
        process.env.PAPERCLIP_MICRONAUT_GH_BIN = previousGhBin;
      }

      await rm(tempDir, { force: true, recursive: true });
    }
  });

  itWithFakeGh("reports when gh is installed but not authenticated", async () => {
    await withFakeGh(
      `#!/bin/sh
echo "$@" >> "$MICRONAUT_TEST_GH_LOG"
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  echo "not logged in" >&2
  exit 1
fi
exit 1
`,
      async () => {
        const harness = createTestHarness({
          manifest,
          capabilities: [...manifest.capabilities]
        });
        harness.seed({
          projects: [createProject("https://github.com/micronaut-projects/micronaut-test-resources")]
        });

        await plugin.definition.setup(harness.ctx);

        await expect(
          harness.performAction(MICRONAUT_CREATE_BRANCH_ACTION_KEY, {
            companyId: "company-1",
            projectId: "project-1",
            branchName: "5.0.x"
          })
        ).rejects.toThrow(
          "GitHub CLI is installed but not authenticated for github.com. Run `gh auth login` on the Paperclip host and try again."
        );
      }
    );
  });
});
