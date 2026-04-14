import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { Project } from "@paperclipai/plugin-sdk";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import manifest from "../src/manifest.js";
import {
  MICRONAUT_CREATE_BRANCH_ACTION_KEY,
  MICRONAUT_PROJECT_DETAIL_TAB_ID,
  MICRONAUT_PROJECT_OVERVIEW_DATA_KEY,
  MICRONAUT_REFRESH_PROJECT_OVERVIEW_ACTION_KEY,
  type MicronautCreateBranchResult,
  type MicronautProjectOverview
} from "../src/micronaut.js";
import plugin from "../src/worker.js";

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function textResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8"
    }
  });
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

      if (
        url ===
        "https://raw.githubusercontent.com/micronaut-projects/micronaut-test-resources/4.0.x/gradle.properties"
      ) {
        return textResponse("projectVersion=4.0.0-SNAPSHOT\n");
      }

      return new Response("Not found", { status: 404 });
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
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

    expect(manifest.capabilities).toEqual([
      "projects.read",
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
        displayName: "Micronaut",
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
            "https://github.com/micronaut-projects/micronaut-test-resources/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
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
            "https://github.com/micronaut-projects/micronaut-test-resources/commit/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
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
          lastCommitUrl: null
        }
      ],
      warnings: []
    });
  });

  it("falls back to gh for GitHub metadata when GitHub API rate limits", async () => {
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

      if (
        url ===
        "https://raw.githubusercontent.com/micronaut-projects/micronaut-test-resources/4.0.x/gradle.properties"
      ) {
        return textResponse("projectVersion=4.0.0-SNAPSHOT\n");
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
                "https://github.com/micronaut-projects/micronaut-test-resources/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
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
                "https://github.com/micronaut-projects/micronaut-test-resources/commit/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
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
              lastCommitUrl: null
            }
          ],
          warnings: []
        });

        const commandLog = await readFile(logPath, "utf8");
        expect(commandLog).toContain("api repos/micronaut-projects/micronaut-test-resources");
        expect(commandLog).toContain("api repos/micronaut-projects/micronaut-test-resources/releases/latest");
        expect(commandLog).toContain("api repos/micronaut-projects/micronaut-test-resources/branches/4.0.x");
        expect(commandLog).toContain("api repos/micronaut-projects/micronaut-test-resources/compare/4.0.x...4.1.x");
      }
    );
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

      if (
        url ===
        "https://raw.githubusercontent.com/micronaut-projects/micronaut-test-resources/4.0.x/gradle.properties"
      ) {
        return textResponse("projectVersion=4.0.0-SNAPSHOT\n");
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

  it("creates a missing Micronaut branch from the default branch", async () => {
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

  it("reports when gh is installed but not authenticated", async () => {
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
