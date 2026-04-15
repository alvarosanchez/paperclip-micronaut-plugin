#!/usr/bin/env node

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import net from "node:net";

const __dirname = dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const pluginRoot = resolve(__dirname, "..", "..");
const stateRoot = await mkdtemp(join(tmpdir(), "paperclip-micronaut-plugin-e2e-"));
const paperclipHome = join(stateRoot, "paperclip-home");
const dataDir = join(stateRoot, "paperclip-data");
const instanceId = "paperclip-micronaut-plugin-e2e";
const pluginKey = "paperclip-micronaut-plugin";
const pluginDisplayName = "Micronaut Plugin";
const pluginDetailTabId = "micronaut-project-overview";
const micronautTabLabel = "Micronaut branches";
const settingsIndexPath = "/instance/settings/plugins";
const requestedPort = process.env.PAPERCLIP_E2E_PORT ? Number(process.env.PAPERCLIP_E2E_PORT) : 3100;
const requestedDbPort = process.env.PAPERCLIP_E2E_DB_PORT
  ? Number(process.env.PAPERCLIP_E2E_DB_PORT)
  : 54329;
const defaultTimeoutMs = 30000;
const githubOwner = "micronaut-projects";
const githubRepo = "micronaut-core";
const micronautCoreRepoUrl = `https://github.com/${githubOwner}/${githubRepo}`;
const projectName = "Micronaut Core";
const seededCeoAgentName = "Micronaut CEO";
const seededEngineerAgentName = "Micronaut Software Engineer";
const seededCeoAgentPayload = {
  name: seededCeoAgentName,
  role: "ceo",
  title: "Chief Executive Officer",
  icon: "crown",
  adapterType: "codex_local",
  adapterConfig: {
    model: "gpt-5.4"
  },
  permissions: {
    canCreateAgents: true
  }
};
const seededEngineerAgentPayload = {
  name: seededEngineerAgentName,
  role: "engineer",
  title: "Software Engineer",
  icon: "wrench",
  adapterType: "codex_local",
  adapterConfig: {
    model: "gpt-5.4"
  },
  permissions: {
    canCreateAgents: false
  }
};
const githubApiHeaders = {
  accept: "application/vnd.github+json",
  "user-agent": "paperclip-micronaut-plugin"
};
const releaseBranchPattern = /^(?<major>\d+)\.(?<minor>\d+)\.x$/;
const relativeTimeFormatter = new Intl.RelativeTimeFormat("en", {
  numeric: "always"
});
const env = {
  ...process.env,
  CI: "true",
  BROWSER: "none",
  DO_NOT_TRACK: "1",
  PAPERCLIP_OPEN_ON_LISTEN: "false",
  PAPERCLIP_TELEMETRY_DISABLED: "1",
  PAPERCLIP_HOME: paperclipHome,
  PAPERCLIP_INSTANCE_ID: instanceId,
  FORCE_COLOR: "0"
};

let serverProcess;
let cleanedUp = false;
let baseUrl;
let serverPort;
let embeddedDbPort;

function log(message) {
  console.log(`[paperclip-micronaut-plugin:e2e] ${message}`);
}

function matchesSeededAgent(agent, payload) {
  return (
    agent?.name === payload.name &&
    agent?.role === payload.role &&
    agent?.title === payload.title &&
    agent?.adapterType === payload.adapterType &&
    agent?.adapterConfig?.model === payload.adapterConfig.model
  );
}

function getPaperclipCommandArgs(args) {
  return ["-p", "node@20", "-p", "paperclipai", "paperclipai", ...args];
}

function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: pluginRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      ...options
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }

      rejectPromise(new Error(`${command} ${args.join(" ")} exited with code ${code}\n${stdout}\n${stderr}`));
    });
  });
}

function tryListen(port) {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = net.createServer();
    server.unref();
    server.on("error", rejectPromise);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => rejectPromise(new Error("Could not resolve a free TCP port.")));
        return;
      }

      const selectedPort = address.port;
      server.close((error) => {
        if (error) {
          rejectPromise(error);
          return;
        }

        resolvePromise(selectedPort);
      });
    });
  });
}

async function findAvailablePort(startPort) {
  try {
    return await tryListen(startPort);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("EADDRINUSE")) {
      throw error;
    }

    return tryListen(0);
  }
}

async function readConfiguredBaseUrl(configPath) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const port = Number(config?.server?.port ?? serverPort);
  return `http://127.0.0.1:${port}`;
}

async function fetchText(url, init = {}) {
  const response = await fetch(url, init);
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText} ${body}`);
  }

  return body;
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {})
    },
    ...init
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText} ${text}`);
  }

  return parseJsonResponseBody(response, text);
}

async function fetchJsonAllowNotFound(url, init = {}) {
  const response = await fetch(url, {
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {})
    },
    ...init
  });

  const text = await response.text();
  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText} ${text}`);
  }

  return parseJsonResponseBody(response, text);
}

function parseJsonResponseBody(response, text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    const preview = text.replace(/\s+/g, " ").trim().slice(0, 200);
    throw new Error(
      `Request failed: expected JSON but received ${response.status} ${response.statusText} ${preview}`
    );
  }
}

function isGitHubApiFallbackError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /rate limit exceeded/i.test(message) ||
    /secondary rate limit/i.test(message) ||
    /expected JSON/i.test(message) ||
    /<!doctype/i.test(message) ||
    /<html/i.test(message)
  );
}

async function fetchGitHubApiJson(endpoint) {
  try {
    return await fetchJson(`https://api.github.com/${endpoint}`, {
      headers: githubApiHeaders
    });
  } catch (error) {
    if (!isGitHubApiFallbackError(error)) {
      throw error;
    }

    log(`GitHub REST request for ${endpoint} failed; retrying expectation fetch through gh CLI.`);
    const result = await execFileAsync("gh", ["api", endpoint], {
      cwd: pluginRoot,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 1024 * 1024
    });

    return result.stdout ? JSON.parse(result.stdout) : null;
  }
}

async function fetchGitHubApiJsonAllowNotFound(endpoint) {
  try {
    return await fetchJsonAllowNotFound(`https://api.github.com/${endpoint}`, {
      headers: githubApiHeaders
    });
  } catch (error) {
    if (!isGitHubApiFallbackError(error)) {
      throw error;
    }

    log(`GitHub REST request for ${endpoint} failed; retrying not-found-tolerant expectation fetch through gh CLI.`);

    try {
      const result = await execFileAsync("gh", ["api", endpoint], {
        cwd: pluginRoot,
        encoding: "utf8",
        env: process.env,
        maxBuffer: 1024 * 1024
      });

      return result.stdout ? JSON.parse(result.stdout) : null;
    } catch (ghError) {
      const message = ghError instanceof Error ? ghError.message : String(ghError);
      if (/404/i.test(message)) {
        return null;
      }

      throw ghError;
    }
  }
}

function normalizeReleaseVersion(tagName) {
  if (typeof tagName !== "string") {
    return null;
  }

  const trimmed = tagName.trim();
  if (!trimmed) {
    return null;
  }

  return /^v\d/i.test(trimmed) ? trimmed.slice(1) : trimmed;
}

function parseProjectVersion(propertiesText) {
  const match = propertiesText.match(/^\s*projectVersion\s*=\s*(.+?)\s*$/m);
  return match?.[1]?.trim() || null;
}

function deriveNextVersion(projectVersion) {
  if (!projectVersion) {
    return null;
  }

  return projectVersion.endsWith("-SNAPSHOT")
    ? projectVersion.slice(0, -"-SNAPSHOT".length)
    : projectVersion;
}

function parseReleaseBranchName(branchName) {
  if (typeof branchName !== "string") {
    return null;
  }

  const trimmed = branchName.trim();
  if (!trimmed) {
    return null;
  }

  const match = releaseBranchPattern.exec(trimmed);
  if (!match?.groups) {
    return null;
  }

  const major = Number.parseInt(match.groups.major, 10);
  const minor = Number.parseInt(match.groups.minor, 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) {
    return null;
  }

  return { major, minor };
}

function buildReleaseBranchName(major, minor) {
  return `${major}.${minor}.x`;
}

function deriveNextMinorBranchName(branchName) {
  const parsed = parseReleaseBranchName(branchName);
  if (!parsed) {
    return null;
  }

  return buildReleaseBranchName(parsed.major, parsed.minor + 1);
}

function deriveNextMajorBranchName(branchName) {
  const parsed = parseReleaseBranchName(branchName);
  if (!parsed) {
    return null;
  }

  return buildReleaseBranchName(parsed.major + 1, 0);
}

function buildGradlePropertiesUrl(owner, repo, ref) {
  return `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(ref)}/gradle.properties`;
}

function formatRelativeTime(value, referenceTime = Date.now()) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const differenceInMilliseconds = parsed.getTime() - referenceTime;
  const differenceInSeconds = differenceInMilliseconds / 1000;
  if (Math.abs(differenceInSeconds) < 45) {
    return "just now";
  }

  const divisions = [
    { amount: 60, unit: "second" },
    { amount: 60, unit: "minute" },
    { amount: 24, unit: "hour" },
    { amount: 7, unit: "day" },
    { amount: 4.34524, unit: "week" },
    { amount: 12, unit: "month" },
    { amount: Number.POSITIVE_INFINITY, unit: "year" }
  ];

  let duration = differenceInSeconds;
  for (const division of divisions) {
    if (Math.abs(duration) < division.amount) {
      return relativeTimeFormatter.format(Math.round(duration), division.unit);
    }

    duration /= division.amount;
  }

  return null;
}

function buildRelativeTimeCandidates(value) {
  if (!value) {
    return ["Unavailable"];
  }

  const candidates = new Set();
  for (const offset of [-120000, -60000, 0, 60000, 120000]) {
    const candidate = formatRelativeTime(value, Date.now() + offset);
    if (candidate) {
      candidates.add(candidate);
    }
  }

  return candidates.size > 0 ? [...candidates] : ["Unavailable"];
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildBranchStatusPills(branch) {
  if (branch.exists === false) {
    return [];
  }

  if (branch.role === "default") {
    return branch.name ? ["Default"] : ["Unavailable"];
  }

  if (branch.aheadBy === 0 && branch.behindBy === 0) {
    return ["Up to date"];
  }

  const pills = [];
  if (typeof branch.aheadBy === "number" && branch.aheadBy > 0) {
    pills.push(`${branch.aheadBy} ahead`);
  }
  if (typeof branch.behindBy === "number" && branch.behindBy > 0) {
    pills.push(`${branch.behindBy} behind`);
  }

  return pills.length > 0 ? pills : ["Unavailable"];
}

function getBranchLastUpdatedCandidates(branch) {
  if (branch.exists === false) {
    return ["Not created yet"];
  }

  return buildRelativeTimeCandidates(branch.lastUpdatedAt);
}

async function fetchBranchExpectation(role, branchName, defaultBranch) {
  if (!branchName) {
    return {
      role,
      name: null,
      exists: null,
      aheadBy: null,
      behindBy: null,
      lastUpdatedAt: null,
      lastUpdatedCandidates: ["Unavailable"],
      statusPills: ["Unavailable"]
    };
  }

  const branch = await fetchGitHubApiJsonAllowNotFound(
    `repos/${githubOwner}/${githubRepo}/branches/${encodeURIComponent(branchName)}`
  );

  if (!branch) {
    return {
      role,
      name: branchName,
      exists: false,
      aheadBy: null,
      behindBy: null,
      lastUpdatedAt: null,
      lastUpdatedCandidates: ["Not created yet"],
      statusPills: [],
      createButtonLabel: "Create branch"
    };
  }

  const resolvedBranchName = branch?.name?.trim() || branchName;
  const commitSha = branch?.commit?.sha?.trim();
  const commit = commitSha
    ? await fetchGitHubApiJson(
        `repos/${githubOwner}/${githubRepo}/commits/${encodeURIComponent(commitSha)}`
      )
    : null;
  const lastUpdatedAt =
    commit?.commit?.committer?.date?.trim() || commit?.commit?.author?.date?.trim() || null;

  let aheadBy = null;
  let behindBy = null;
  if (role !== "default" && defaultBranch) {
    const compare = await fetchGitHubApiJsonAllowNotFound(
      `repos/${githubOwner}/${githubRepo}/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(resolvedBranchName)}`
    );
    if (compare) {
      aheadBy = numberOrNull(compare?.ahead_by);
      behindBy = numberOrNull(compare?.behind_by);
    }
  }

  const expectation = {
    role,
    name: resolvedBranchName,
    exists: true,
    aheadBy,
    behindBy,
    lastUpdatedAt
  };

  return {
    ...expectation,
    lastUpdatedCandidates: getBranchLastUpdatedCandidates(expectation),
    statusPills: buildBranchStatusPills(expectation),
    createButtonLabel: null
  };
}

function resolveProjectRepositoryUrl(project) {
  return (
    project?.codebase?.repoUrl ??
    project?.primaryWorkspace?.repoUrl ??
    project?.workspaces?.find((workspace) => workspace?.isPrimary)?.repoUrl ??
    project?.workspaces?.find((workspace) => workspace?.repoUrl)?.repoUrl ??
    null
  );
}

async function ensureConfigFile(configPath) {
  await mkdir(dirname(configPath), { recursive: true });
  await mkdir(join(dataDir, "logs"), { recursive: true });
  await mkdir(join(dataDir, "storage"), { recursive: true });
  await mkdir(join(dataDir, "backups"), { recursive: true });

  const config = {
    $meta: {
      version: 1,
      updatedAt: new Date().toISOString(),
      source: "doctor"
    },
    database: {
      mode: "embedded-postgres",
      embeddedPostgresDataDir: join(dataDir, "db"),
      embeddedPostgresPort: embeddedDbPort,
      backup: {
        enabled: true,
        intervalMinutes: 60,
        retentionDays: 30,
        dir: join(dataDir, "backups")
      }
    },
    logging: {
      mode: "file",
      logDir: join(dataDir, "logs")
    },
    server: {
      deploymentMode: "local_trusted",
      exposure: "private",
      host: "127.0.0.1",
      port: serverPort,
      serveUi: true,
      allowedHostnames: []
    },
    telemetry: {
      enabled: false
    },
    auth: {
      baseUrlMode: "auto",
      disableSignUp: false
    },
    storage: {
      provider: "local_disk",
      localDisk: {
        baseDir: join(dataDir, "storage")
      },
      s3: {
        bucket: "paperclip-e2e-placeholder",
        region: "us-east-1",
        prefix: "paperclip-e2e",
        forcePathStyle: false
      }
    },
    secrets: {
      provider: "local_encrypted",
      strictMode: false,
      localEncrypted: {
        keyFilePath: join(dataDir, "secrets", "master.key")
      }
    }
  };

  await writeFile(configPath, JSON.stringify(config, null, 2));
}

async function waitForReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const healthUrl = new URL("/api/health", url).toString();

  while (Date.now() < deadline) {
    if (serverProcess?.exitCode !== null && serverProcess?.exitCode !== undefined) {
      throw new Error(`Paperclip exited early with code ${serverProcess.exitCode}.`);
    }

    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // keep polling until timeout
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }

  throw new Error(`Timed out waiting for Paperclip at ${healthUrl}`);
}

async function ensureCompanySeeded() {
  const companiesUrl = new URL("/api/companies", baseUrl).toString();
  const existingCompanies = await fetchJson(companiesUrl);
  if (Array.isArray(existingCompanies) && existingCompanies.length > 0) {
    log(`Found ${existingCompanies.length} existing companies; onboarding should be skipped.`);
    return existingCompanies[0];
  }

  const createdCompany = await fetchJson(companiesUrl, {
    method: "POST",
    body: JSON.stringify({
      name: "Dummy Company",
      description: "Seed company for paperclip-micronaut-plugin e2e verification."
    })
  });

  const postCreateCompanies = await fetchJson(companiesUrl);
  if (!Array.isArray(postCreateCompanies) || postCreateCompanies.length === 0) {
    throw new Error("Expected at least one company after seeding, but Paperclip still reports none.");
  }

  log(`Seeded company ${createdCompany?.name ?? postCreateCompanies[0]?.name ?? "unknown"}.`);
  return postCreateCompanies[0];
}

async function ensureAgentSeeded(company, payload, fallbackName) {
  const agentsUrl = new URL(`/api/companies/${company.id}/agents`, baseUrl).toString();
  const existingAgents = await fetchJson(agentsUrl);
  const reusableAgent = Array.isArray(existingAgents)
    ? existingAgents.find((agent) => matchesSeededAgent(agent, payload))
    : null;

  if (reusableAgent?.id) {
    log(`Reusing ${payload.title ?? "agent"} ${reusableAgent.name ?? fallbackName} (${reusableAgent.id}).`);
    return reusableAgent;
  }

  const createdAgent = await fetchJson(agentsUrl, {
    method: "POST",
    body: JSON.stringify(payload)
  });

  if (!createdAgent?.id) {
    throw new Error(`${payload.title ?? "Agent"} creation succeeded but did not return an agent id.`);
  }

  log(`Seeded ${payload.title ?? "agent"} ${createdAgent.name ?? fallbackName} (${createdAgent.id}).`);
  return createdAgent;
}

async function ensurePluginRegistered() {
  const pluginsUrl = new URL("/api/plugins", baseUrl).toString();
  const plugins = await fetchJson(pluginsUrl);
  if (!Array.isArray(plugins)) {
    throw new Error("Expected /api/plugins to return an array.");
  }

  const plugin = plugins.find((candidate) => {
    const manifestId = candidate?.manifestJson?.id;
    return candidate?.pluginKey === pluginKey || manifestId === pluginKey;
  });

  if (!plugin) {
    throw new Error(`Expected ${pluginKey} to be present in /api/plugins.`);
  }

  const detailTab = plugin?.manifestJson?.ui?.slots?.find(
    (slot) => slot?.type === "detailTab" && slot?.id === pluginDetailTabId
  );
  if (!detailTab) {
    throw new Error(`Expected ${pluginKey} to expose detail tab ${pluginDetailTabId}.`);
  }

  return {
    pluginsUrl,
    detailTab
  };
}

async function fetchMicronautCoreExpectation() {
  const repository = await fetchGitHubApiJson(`repos/${githubOwner}/${githubRepo}`);
  const release = await fetchGitHubApiJson(`repos/${githubOwner}/${githubRepo}/releases/latest`);

  const defaultBranch = repository?.default_branch?.trim();
  if (!defaultBranch) {
    throw new Error(`GitHub did not report a default branch for ${githubOwner}/${githubRepo}.`);
  }

  const currentVersion = normalizeReleaseVersion(release?.tag_name);
  if (!currentVersion) {
    throw new Error(`GitHub did not expose a readable release tag for ${githubOwner}/${githubRepo}.`);
  }

  const gradlePropertiesText = await fetchText(
    `https://raw.githubusercontent.com/${githubOwner}/${githubRepo}/${encodeURIComponent(defaultBranch)}/gradle.properties`,
    {
      headers: {
        "user-agent": githubApiHeaders["user-agent"]
      }
    }
  );
  const nextVersion = deriveNextVersion(parseProjectVersion(gradlePropertiesText));
  if (!nextVersion) {
    throw new Error(`Could not derive the next version from ${githubOwner}/${githubRepo} gradle.properties.`);
  }

  const nextMinorBranch = deriveNextMinorBranchName(defaultBranch);
  const nextMajorBranch = deriveNextMajorBranchName(defaultBranch);
  const branches = await Promise.all([
    fetchBranchExpectation("default", defaultBranch, defaultBranch),
    fetchBranchExpectation("nextMinor", nextMinorBranch, defaultBranch),
    fetchBranchExpectation("nextMajor", nextMajorBranch, defaultBranch)
  ]);

  return {
    branches,
    currentVersion,
    currentVersionUrl:
      release?.html_url?.trim() ||
      `${micronautCoreRepoUrl}/releases/tag/${encodeURIComponent(release?.tag_name ?? currentVersion)}`,
    defaultBranch,
    gradlePropertiesUrl: buildGradlePropertiesUrl(githubOwner, githubRepo, defaultBranch),
    nextVersion
  };
}

async function createMicronautCoreProject(company) {
  const projectsUrl = new URL(`/api/companies/${company.id}/projects`, baseUrl).toString();
  const createdProject = await fetchJson(projectsUrl, {
    method: "POST",
    body: JSON.stringify({
      name: projectName,
      description: "Disposable Micronaut Core project for Paperclip plugin smoke verification.",
      workspace: {
        name: "origin",
        isPrimary: true,
        sourceType: "git_repo",
        repoUrl: micronautCoreRepoUrl
      }
    })
  });

  if (!createdProject?.id) {
    throw new Error("Project creation succeeded but did not return a project id.");
  }

  log(`Created project ${createdProject.name ?? projectName} (${createdProject.id}).`);
  return waitForProjectRepository(createdProject.id, micronautCoreRepoUrl);
}

async function waitForProjectRepository(projectId, expectedRepoUrl, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  const projectUrl = new URL(`/api/projects/${projectId}`, baseUrl).toString();

  while (Date.now() < deadline) {
    const project = await fetchJson(projectUrl);
    if (resolveProjectRepositoryUrl(project) === expectedRepoUrl) {
      return project;
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }

  throw new Error(`Timed out waiting for project ${projectId} to report repo ${expectedRepoUrl}.`);
}

function buildProjectUrlCandidates(company, project, { includeTab = false } = {}) {
  const candidates = [];
  const seen = new Set();
  const companyRefs = [company?.urlKey].filter(Boolean);
  const projectRefs = [project?.urlKey, project?.id].filter(Boolean);

  function pushCandidate(pathname, includeCompanyId = false) {
    const url = new URL(pathname, baseUrl);
    if (includeTab) {
      url.searchParams.set("tab", `plugin:${pluginKey}:${pluginDetailTabId}`);
    }
    if (includeCompanyId) {
      url.searchParams.set("companyId", company.id);
    }

    const href = url.toString();
    if (!seen.has(href)) {
      seen.add(href);
      candidates.push(href);
    }
  }

  for (const projectRef of projectRefs) {
    for (const companyRef of companyRefs) {
      pushCandidate(`/${companyRef}/projects/${projectRef}`);
    }

    pushCandidate(`/projects/${projectRef}`, true);
    pushCandidate(`/projects/${projectRef}`);
  }

  return candidates;
}

function buildProjectPageUrlCandidates(company, project) {
  return buildProjectUrlCandidates(company, project);
}

function buildProjectTabUrlCandidates(company, project) {
  return buildProjectUrlCandidates(company, project, { includeTab: true });
}

async function waitForLocatorText(locator, expectedValue, timeoutMs = 60000) {
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  const deadline = Date.now() + timeoutMs;
  let lastValue = null;

  while (Date.now() < deadline) {
    lastValue = (await locator.textContent())?.trim() ?? "";
    if (lastValue === expectedValue) {
      return lastValue;
    }

    await locator.page().waitForTimeout(1000);
  }

  throw new Error(`Timed out waiting for "${expectedValue}". Last value was "${lastValue}".`);
}

async function waitForLocatorTextMatch(locator, expectedValues, timeoutMs = 60000) {
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  const deadline = Date.now() + timeoutMs;
  let lastValue = null;

  while (Date.now() < deadline) {
    lastValue = (await locator.textContent())?.trim() ?? "";
    if (expectedValues.includes(lastValue)) {
      return lastValue;
    }

    await locator.page().waitForTimeout(1000);
  }

  throw new Error(
    `Timed out waiting for one of ${JSON.stringify(expectedValues)}. Last value was "${lastValue}".`
  );
}

async function waitForLocatorTexts(locator, expectedValues, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let lastValues = [];

  while (Date.now() < deadline) {
    const count = await locator.count();
    if (count === 0 && expectedValues.length === 0) {
      return [];
    }

    if (count > 0) {
      await locator.first().waitFor({ state: "visible", timeout: timeoutMs });
    }

    lastValues = await locator.evaluateAll((nodes) =>
      nodes
        .map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? "")
        .filter(Boolean)
    );

    if (JSON.stringify(lastValues) === JSON.stringify(expectedValues)) {
      return lastValues;
    }

    await locator.page().waitForTimeout(1000);
  }

  throw new Error(
    `Timed out waiting for ${JSON.stringify(expectedValues)}. Last values were ${JSON.stringify(lastValues)}.`
  );
}

async function waitForLocatorTextsOneOf(locator, expectedValueSets, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let lastValues = [];

  while (Date.now() < deadline) {
    const count = await locator.count();
    if (
      count === 0 &&
      expectedValueSets.some((expectedValues) => expectedValues.length === 0)
    ) {
      return [];
    }

    if (count > 0) {
      await locator.first().waitFor({ state: "visible", timeout: timeoutMs });
    }

    lastValues = await locator.evaluateAll((nodes) =>
      nodes
        .map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? "")
        .filter(Boolean)
    );

    if (
      expectedValueSets.some(
        (expectedValues) => JSON.stringify(lastValues) === JSON.stringify(expectedValues)
      )
    ) {
      return lastValues;
    }

    await locator.page().waitForTimeout(1000);
  }

  throw new Error(
    `Timed out waiting for one of ${JSON.stringify(expectedValueSets)}. Last values were ${JSON.stringify(lastValues)}.`
  );
}

function getBranchNameTestId(role) {
  return role === "default" ? "default-branch-value" : `branch-name-${role}`;
}

async function openMicronautProjectTab(page, company, project) {
  const candidates = buildProjectTabUrlCandidates(company, project);
  let lastError = null;

  for (const projectTabUrl of candidates) {
    try {
      await gotoWithTimeout(page, projectTabUrl);
      const tab = page
        .getByRole("tab", { name: new RegExp(`^${micronautTabLabel}$`) })
        .first();

      if (await tab.count()) {
        await tab.waitFor({ state: "visible", timeout: defaultTimeoutMs });
        await tab.click();
      }

      const root = page.getByTestId("micronaut-project-overview").first();
      await root.waitFor({ state: "visible", timeout: 60000 });
      log(`Opened ${micronautTabLabel} detail tab: ${projectTabUrl}`);
      return {
        candidates,
        projectTabUrl
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Could not open the ${micronautTabLabel} detail tab for ${project.id}. ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

async function openProjectPage(page, company, project) {
  const candidates = buildProjectPageUrlCandidates(company, project);
  let lastError = null;

  for (const projectUrl of candidates) {
    try {
      await gotoWithTimeout(page, projectUrl);
      const micronautTab = page
        .getByRole("tab", { name: new RegExp(`^${micronautTabLabel}$`) })
        .first();
      await micronautTab.waitFor({ state: "visible", timeout: 60000 });
      log(`Opened project detail page before selecting ${micronautTabLabel}: ${projectUrl}`);
      return {
        candidates,
        projectUrl
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Could not open the project detail page for ${project.id}. ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

async function applySmokeTheme(page, theme) {
  const backgroundColor = theme === "dark" ? "rgb(2, 6, 23)" : "rgb(248, 250, 252)";
  const foregroundColor = theme === "dark" ? "rgb(248, 250, 252)" : "rgb(15, 23, 42)";

  await page.evaluate(
    ({ backgroundColor, foregroundColor, theme }) => {
      for (const element of [document.documentElement, document.body]) {
        if (!(element instanceof HTMLElement)) {
          continue;
        }

        element.setAttribute("data-theme", theme);
        element.setAttribute("data-color-scheme", theme);
        element.classList.remove("dark", "light");
        element.classList.add(theme);
        element.style.backgroundColor = backgroundColor;
        element.style.color = foregroundColor;
      }

      try {
        window.localStorage.setItem("theme", theme);
        window.localStorage.setItem("color-theme", theme);
      } catch {
        // Ignore localStorage access in disposable smoke environments.
      }
    },
    { backgroundColor, foregroundColor, theme }
  );

  await page.waitForTimeout(250);
}

async function waitForThemeMode(page, expectedTheme, timeoutMs = 30000) {
  await page.waitForFunction(
    (theme) =>
      document.querySelector('[data-testid="micronaut-project-overview"]')?.getAttribute(
        "data-theme-mode"
      ) === theme,
    expectedTheme,
    { timeout: timeoutMs }
  );
}

async function auditMicronautTheme(page, expectedTheme) {
  await waitForThemeMode(page, expectedTheme);

  const audit = await page.evaluate(
    ({ expectedTheme }) => {
      function parseColor(value) {
        if (!value) {
          return null;
        }

        const match = value.match(
          /rgba?\\(\\s*(\\d{1,3})\\s*,\\s*(\\d{1,3})\\s*,\\s*(\\d{1,3})(?:\\s*,\\s*([\\d.]+))?\\s*\\)/i
        );
        if (!match) {
          return null;
        }

        return {
          r: Number.parseInt(match[1], 10),
          g: Number.parseInt(match[2], 10),
          b: Number.parseInt(match[3], 10),
          a: match[4] === undefined ? 1 : Number.parseFloat(match[4])
        };
      }

      function compositeColor(foreground, background) {
        const alpha = Number.isFinite(foreground?.a) ? foreground.a : 1;
        const inverse = 1 - alpha;

        return {
          r: Math.round(foreground.r * alpha + background.r * inverse),
          g: Math.round(foreground.g * alpha + background.g * inverse),
          b: Math.round(foreground.b * alpha + background.b * inverse),
          a: 1
        };
      }

      function toLuminance(color) {
        const channels = [color.r, color.g, color.b].map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.03928
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        });

        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      }

      function getContrastRatio(foreground, background) {
        const lighter = Math.max(toLuminance(foreground), toLuminance(background));
        const darker = Math.min(toLuminance(foreground), toLuminance(background));
        return (lighter + 0.05) / (darker + 0.05);
      }

      const root = document.querySelector('[data-testid="micronaut-project-overview"]');
      const panel = root?.querySelector(".micronaut-project-tab__panel");
      const title = root?.querySelector(".micronaut-project-tab__title");

      if (
        !(root instanceof HTMLElement) ||
        !(panel instanceof HTMLElement) ||
        !(title instanceof HTMLElement)
      ) {
        return {
          ok: false,
          reason: "Missing the Micronaut root, panel, or title."
        };
      }

      const documentBackground =
        parseColor(window.getComputedStyle(document.body).backgroundColor) ??
        parseColor(window.getComputedStyle(document.documentElement).backgroundColor) ?? {
          r: 255,
          g: 255,
          b: 255,
          a: 1
        };
      const panelBackgroundRaw =
        parseColor(window.getComputedStyle(panel).backgroundColor) ?? documentBackground;
      const titleColorRaw =
        parseColor(window.getComputedStyle(title).color) ?? {
          r: 15,
          g: 23,
          b: 42,
          a: 1
        };
      const effectivePanelBackground = compositeColor(panelBackgroundRaw, documentBackground);
      const effectiveTitleColor = compositeColor(titleColorRaw, effectivePanelBackground);
      const contrastRatio = getContrastRatio(effectiveTitleColor, effectivePanelBackground);
      const themeMode = root.getAttribute("data-theme-mode");

      return {
        ok: themeMode === expectedTheme && contrastRatio >= 4.5,
        themeMode,
        contrastRatio
      };
    },
    { expectedTheme }
  );

  if (!audit?.ok) {
    throw new Error(
      `Expected the ${expectedTheme} theme audit to pass, but saw ${JSON.stringify(audit)}.`
    );
  }

  return audit;
}

async function waitForServerExit(timeoutMs) {
  if (!serverProcess) {
    return;
  }

  if (serverProcess.exitCode !== null) {
    return;
  }

  await new Promise((resolvePromise) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolvePromise(undefined);
      }
    };

    serverProcess.once("close", finish);
    setTimeout(finish, timeoutMs);
  });
}

async function cleanup() {
  if (cleanedUp) {
    return;
  }

  cleanedUp = true;

  if (serverProcess) {
    if (serverProcess.exitCode === null && !serverProcess.killed) {
      serverProcess.kill("SIGINT");
      await waitForServerExit(5000);
    }

    if (serverProcess.exitCode === null && !serverProcess.killed) {
      serverProcess.kill("SIGKILL");
      await waitForServerExit(5000);
    }
  }

  await rm(stateRoot, { recursive: true, force: true });
}

async function gotoWithTimeout(page, url) {
  return page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: defaultTimeoutMs
  });
}

async function main() {
  process.on("SIGINT", () => {
    void cleanup().finally(() => process.exit(130));
  });
  process.on("SIGTERM", () => {
    void cleanup().finally(() => process.exit(143));
  });

  log(`Working directory ${stateRoot}`);

  serverPort = await findAvailablePort(requestedPort);
  embeddedDbPort = await findAvailablePort(requestedDbPort);
  const configPath = join(paperclipHome, "instances", instanceId, "config.json");
  env.PAPERCLIP_CONFIG_PATH = configPath;
  await ensureConfigFile(configPath);
  baseUrl = await readConfiguredBaseUrl(configPath);

  serverProcess = spawn(
    "npx",
    getPaperclipCommandArgs(["run", "--config", configPath, "--data-dir", dataDir]),
    {
      cwd: pluginRoot,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  serverProcess.unref();

  serverProcess.stdout?.on("data", (chunk) => {
    process.stdout.write(chunk.toString());
  });
  serverProcess.stderr?.on("data", (chunk) => {
    process.stderr.write(chunk.toString());
  });
  serverProcess.on("error", (error) => {
    console.error(error);
  });

  await waitForReady(baseUrl, 180000);
  log(`Paperclip server is ready at ${baseUrl}.`);

  const company = await ensureCompanySeeded();
  const ceoAgent = await ensureAgentSeeded(company, seededCeoAgentPayload, seededCeoAgentName);
  const engineerAgent = await ensureAgentSeeded(
    company,
    seededEngineerAgentPayload,
    seededEngineerAgentName
  );
  const expectedOverview = await fetchMicronautCoreExpectation();

  await runCommand(
    "npx",
    getPaperclipCommandArgs([
      "plugin",
      "install",
      "--local",
      pluginRoot,
      "--data-dir",
      dataDir,
      "--config",
      configPath
    ])
  );
  log("Installed local paperclip-micronaut-plugin plugin.");

  const pluginRegistration = await ensurePluginRegistered();
  log(`Verified ${pluginDetailTabId} detail tab in ${pluginRegistration.pluginsUrl}.`);

  const project = await createMicronautCoreProject(company);
  const settingsIndexUrl = new URL(settingsIndexPath, baseUrl).toString();

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(defaultTimeoutMs);
  await page.emulateMedia({ colorScheme: "light" });

  try {
    await gotoWithTimeout(page, settingsIndexUrl);
    log(`Opened installed plugins page: ${settingsIndexUrl}`);
    await page.getByText(pluginDisplayName, { exact: true }).first().waitFor({ timeout: 120000 });

    const projectNavigation = await openProjectPage(page, company, project);
    await applySmokeTheme(page, "light");
    const tabNavigation = await openMicronautProjectTab(page, company, project);
    await applySmokeTheme(page, "light");

    const currentVersion = await waitForLocatorText(
      page.getByTestId("current-version-value"),
      expectedOverview.currentVersion
    );
    const nextVersion = await waitForLocatorText(
      page.getByTestId("next-version-value"),
      expectedOverview.nextVersion
    );
    const defaultBranch = await waitForLocatorText(
      page.getByTestId("default-branch-value"),
      expectedOverview.defaultBranch
    );
    const lastCheckedLocator = page.getByTestId("last-checked-at-value");
    await lastCheckedLocator.waitFor({ state: "visible", timeout: 30000 });
    const lastChecked = ((await lastCheckedLocator.textContent()) ?? "").replace(/\s+/g, " ").trim();
    if (!lastChecked.startsWith("Last checked")) {
      throw new Error(`Expected a cached last-checked label, but saw "${lastChecked}".`);
    }

    const refreshButton = page.getByTestId("refresh-overview-button");
    await refreshButton.waitFor({ state: "visible", timeout: 30000 });
    const refreshButtonLabel = ((await refreshButton.textContent()) ?? "").replace(/\s+/g, " ").trim();
    if (!refreshButtonLabel.includes("Refresh")) {
      throw new Error(`Expected the Micronaut refresh control to expose a Refresh label, but saw "${refreshButtonLabel}".`);
    }

    await refreshButton.click();
    await page.waitForTimeout(200);

    const currentVersionStillVisible = await page.getByTestId("current-version-value").isVisible();
    if (!currentVersionStillVisible) {
      throw new Error(
        "Refreshing Micronaut data should keep the existing overview visible instead of replacing the tab with a loading state."
      );
    }

    if ((await page.getByText("Loading Micronaut project metadata").count()) > 0) {
      throw new Error(
        "Refreshing Micronaut data should not render the full-page loading state while a cached overview is already visible."
      );
    }

    const actualBranches = [];

    for (const branch of expectedOverview.branches) {
      const branchName = await waitForLocatorText(
        page.getByTestId(getBranchNameTestId(branch.role)),
        branch.name ?? "Unavailable"
      );
      const lastUpdatedCandidates = branch.createButtonLabel
        ? [...new Set([...branch.lastUpdatedCandidates, "Unavailable"])]
        : branch.lastUpdatedCandidates;
      const branchLastUpdated = await waitForLocatorTextMatch(
        page.getByTestId(`branch-last-updated-${branch.role}`),
        lastUpdatedCandidates
      );
      const branchStatusPills = branch.createButtonLabel
        ? await waitForLocatorTextsOneOf(
            page.locator(`[data-testid^="branch-pill-${branch.role}-"]`),
            [branch.statusPills, ["Unavailable"]]
          )
        : await waitForLocatorTexts(
            page.locator(`[data-testid^="branch-pill-${branch.role}-"]`),
            branch.statusPills
          );
      const branchCreateLocator = page.getByTestId(`branch-create-${branch.role}`);
      const branchCreateLabel =
        branch.createButtonLabel && (await branchCreateLocator.count()) > 0
          ? await waitForLocatorText(branchCreateLocator, branch.createButtonLabel)
          : null;

      actualBranches.push({
        role: branch.role,
        createButtonLabel: branchCreateLabel,
        name: branchName,
        lastUpdated: branchLastUpdated,
        statusPills: branchStatusPills
      });
    }

    const lightThemeAudit = await auditMicronautTheme(page, "light");

    await mkdir(join(pluginRoot, "tests/e2e/results"), { recursive: true });
    await page.screenshot({
      path: join(pluginRoot, "tests/e2e/results/last-run-light.png"),
      fullPage: true
    });

    await page.emulateMedia({ colorScheme: "dark" });
    await applySmokeTheme(page, "dark");
    await page.waitForTimeout(500);
    const darkThemeAudit = await auditMicronautTheme(page, "dark");
    await page.screenshot({
      path: join(pluginRoot, "tests/e2e/results/last-run-dark.png"),
      fullPage: true
    });
    await page.screenshot({
      path: join(pluginRoot, "tests/e2e/results/last-run.png"),
      fullPage: true
    });

    const bodyText = (await page.locator("body").textContent()) ?? "";
    await writeFile(
      join(pluginRoot, "tests/e2e/results/last-run.json"),
      JSON.stringify(
        {
          actualOverview: {
            branches: actualBranches,
            currentVersion,
            defaultBranch,
            lastChecked,
            nextVersion
          },
          baseUrl,
          bodyText,
          ceoAgent: {
            adapterType: ceoAgent?.adapterType ?? null,
            id: ceoAgent?.id ?? null,
            model: ceoAgent?.adapterConfig?.model ?? null,
            name: ceoAgent?.name ?? null,
            role: ceoAgent?.role ?? null
          },
          engineerAgent: {
            adapterType: engineerAgent?.adapterType ?? null,
            id: engineerAgent?.id ?? null,
            model: engineerAgent?.adapterConfig?.model ?? null,
            name: engineerAgent?.name ?? null,
            role: engineerAgent?.role ?? null
          },
          company,
          expectedOverview,
          plugin: {
            detailTab: pluginRegistration.detailTab,
            displayName: pluginDisplayName,
            key: pluginKey,
            pluginsUrl: pluginRegistration.pluginsUrl
          },
          project,
          projectNavigation,
          settingsIndexUrl,
          tabNavigation,
          themeAudits: {
            dark: darkThemeAudit,
            light: lightThemeAudit
          }
        },
        null,
        2
      )
    );
  } finally {
    await browser.close();
  }

  await cleanup();
}

try {
  await main();
} catch (error) {
  await cleanup();
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
}
