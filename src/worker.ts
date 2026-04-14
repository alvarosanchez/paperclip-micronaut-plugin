import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";
import {
  MICRONAUT_CREATE_BRANCH_ACTION_KEY,
  MICRONAUT_GITHUB_ORGANIZATION,
  MICRONAUT_PROJECT_OVERVIEW_DATA_KEY,
  MICRONAUT_REFRESH_PROJECT_OVERVIEW_ACTION_KEY,
  type MicronautBranchRole,
  type MicronautBranchSyncStatus,
  type MicronautCreateBranchResult,
  type MicronautProjectBranch,
  type MicronautProjectOverview,
  type MicronautProjectOverviewReady,
  buildGitHubBranchUrl,
  buildGitHubCompareUrl,
  buildGradlePropertiesUrl,
  buildRawGradlePropertiesUrl,
  deriveNextMajorBranchName,
  deriveNextMinorBranchName,
  deriveNextVersion,
  getMicronautBranchLabel,
  normalizeReleaseVersion,
  parseGitHubRepository,
  parseProjectVersion,
  resolveProjectRepositoryUrl
} from "./micronaut.js";

const execFileAsync = promisify(execFile);
const GH_REFERENCE_ALREADY_EXISTS_ERROR = "GH_REFERENCE_ALREADY_EXISTS";
const GITHUB_HEADERS = {
  accept: "application/vnd.github+json",
  "user-agent": "paperclip-micronaut-plugin"
};
const GH_ENV_BIN_KEY = "PAPERCLIP_MICRONAUT_GH_BIN";
const MICRONAUT_STATE_NAMESPACE = "micronaut";
const MICRONAUT_PROJECT_OVERVIEW_CACHE_STATE_KEY = "project-overview-cache";
const MICRONAUT_PROJECT_OVERVIEW_CACHE_TTL_MS = 10 * 60 * 1000;
const GH_EXECUTABLE_CANDIDATES =
  process.platform === "win32"
    ? [
        "gh.exe",
        "C:\\Program Files\\GitHub CLI\\gh.exe",
        "C:\\Program Files (x86)\\GitHub CLI\\gh.exe"
      ]
    : ["gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"];

interface GitHubRepositoryResponse {
  default_branch?: string;
}

interface GitHubReleaseResponse {
  html_url?: string;
  tag_name?: string;
}

interface GitHubBranchResponse {
  name?: string;
  commit?: {
    sha?: string;
  };
}

interface GitHubCommitResponse {
  html_url?: string;
  commit?: {
    author?: {
      date?: string;
    };
    committer?: {
      date?: string;
    };
  };
}

interface GitHubCompareResponse {
  html_url?: string;
  status?: string;
  ahead_by?: number;
  behind_by?: number;
}

interface MicronautProjectOverviewCacheEntry {
  version: 1;
  checkedAt: string;
  repoUrl: string;
  overview: MicronautProjectOverviewReady;
}

class HttpRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpRequestError";
    this.status = status;
  }
}

function buildProjectOverviewCacheScope(projectId: string) {
  return {
    scopeKind: "project" as const,
    scopeId: projectId,
    namespace: MICRONAUT_STATE_NAMESPACE,
    stateKey: MICRONAUT_PROJECT_OVERVIEW_CACHE_STATE_KEY
  };
}

function normalizeProjectOverviewCacheEntry(
  value: unknown
): MicronautProjectOverviewCacheEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const checkedAt = typeof candidate.checkedAt === "string" ? candidate.checkedAt.trim() : "";
  const repoUrl = typeof candidate.repoUrl === "string" ? candidate.repoUrl.trim() : "";
  const overview =
    candidate.overview && typeof candidate.overview === "object"
      ? (candidate.overview as MicronautProjectOverviewReady)
      : null;

  if (
    candidate.version !== 1 ||
    !checkedAt ||
    !repoUrl ||
    !overview ||
    overview.kind !== "ready"
  ) {
    return null;
  }

  return {
    version: 1,
    checkedAt,
    repoUrl,
    overview
  };
}

function withLastCheckedAt(
  overview: Omit<MicronautProjectOverviewReady, "lastCheckedAt">,
  checkedAt: string
): MicronautProjectOverviewReady {
  return {
    ...overview,
    lastCheckedAt: checkedAt
  };
}

function isProjectOverviewCacheFresh(entry: MicronautProjectOverviewCacheEntry): boolean {
  const checkedAtTime = Date.parse(entry.checkedAt);
  return (
    Number.isFinite(checkedAtTime) &&
    Date.now() - checkedAtTime < MICRONAUT_PROJECT_OVERVIEW_CACHE_TTL_MS
  );
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required`);
  }

  return value;
}

function buildGitHubApiUrl(owner: string, repo: string, suffix: string): string {
  return `https://api.github.com/repos/${owner}/${repo}${suffix}`;
}

function buildBranchApiUrl(owner: string, repo: string, branchName: string): string {
  return buildGitHubApiUrl(owner, repo, `/branches/${encodeURIComponent(branchName)}`);
}

function buildGitHubBranchRefName(branchName: string): string {
  return `refs/heads/${branchName}`;
}

function buildCommitApiUrl(owner: string, repo: string, ref: string): string {
  return buildGitHubApiUrl(owner, repo, `/commits/${encodeURIComponent(ref)}`);
}

function buildCompareApiUrl(owner: string, repo: string, baseBranch: string, headBranch: string): string {
  return buildGitHubApiUrl(
    owner,
    repo,
    `/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(headBranch)}`
  );
}

function buildRequestErrorMessage(url: string, status: number, bodyText: string): string {
  try {
    const parsed = bodyText ? (JSON.parse(bodyText) as { message?: string }) : null;
    if (parsed?.message) {
      return `${parsed.message} (${status})`;
    }
  } catch {
    // Fall through to the plain-text body.
  }

  const body = bodyText.trim();
  if (body) {
    return `${body} (${status})`;
  }

  return `Request to ${url} failed with status ${status}.`;
}

interface ExecFileError extends Error {
  code?: string | number | null;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

function isExecFileError(error: unknown): error is ExecFileError {
  return Boolean(error && typeof error === "object");
}

function normalizeExecOutput(value: string | Buffer | undefined): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value instanceof Buffer) {
    return value.toString("utf8").trim();
  }

  return "";
}

function getExecFileOutput(error: unknown): string {
  if (!isExecFileError(error)) {
    return error instanceof Error ? error.message.trim() : "";
  }

  const output = [normalizeExecOutput(error.stderr), normalizeExecOutput(error.stdout)]
    .filter(Boolean)
    .join("\n");

  return output || (typeof error.message === "string" ? error.message.trim() : "");
}

function extractGitHubApiEndpoint(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "api.github.com") {
      return null;
    }

    return `${parsed.pathname.replace(/^\/+/, "")}${parsed.search}`;
  } catch {
    return null;
  }
}

function isGitHubApiRateLimitError(error: unknown): boolean {
  return (
    error instanceof HttpRequestError &&
    error.status === 403 &&
    /rate limit exceeded|secondary rate limit/i.test(error.message)
  );
}

function getGhHttpStatus(error: unknown): number | null {
  const output = getExecFileOutput(error);
  const match = output.match(/\bHTTP\s+(\d{3})\b/i);
  if (!match) {
    return null;
  }

  const status = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(status) ? status : null;
}

function buildGhEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env
  };

  try {
    const realHome = userInfo().homedir;
    if (realHome) {
      env.HOME = realHome;
      env.XDG_CONFIG_HOME = join(realHome, ".config");
      env.GH_CONFIG_DIR = join(realHome, ".config", "gh");
    }
  } catch {
    // Fall back to the worker process environment when the OS profile cannot be resolved.
  }

  return env;
}

function getGhExecutableCandidates(): string[] {
  const override = process.env[GH_ENV_BIN_KEY]?.trim();
  return override ? [override] : GH_EXECUTABLE_CANDIDATES;
}

async function runGhCommand(args: string[]): Promise<string> {
  const env = buildGhEnv();

  for (const executable of getGhExecutableCandidates()) {
    try {
      const result = await execFileAsync(executable, args, {
        encoding: "utf8",
        env,
        maxBuffer: 1024 * 1024
      });

      return result.stdout.trim();
    } catch (error) {
      if (isExecFileError(error) && error.code === "ENOENT") {
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    "GitHub CLI (`gh`) is not installed on the Paperclip host. Install it to create branches from this tab."
  );
}

async function ensureGhCliAuthenticated(): Promise<void> {
  try {
    await runGhCommand(["auth", "status", "--hostname", "github.com"]);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("GitHub CLI (`gh`) is not installed on the Paperclip host")
    ) {
      throw error;
    }

    throw new Error(
      "GitHub CLI is installed but not authenticated for github.com. Run `gh auth login` on the Paperclip host and try again."
    );
  }
}

async function createBranchWithGhCli(
  owner: string,
  repo: string,
  branchName: string,
  baseSha: string
): Promise<void> {
  try {
    await runGhCommand([
      "api",
      "--method",
      "POST",
      `repos/${owner}/${repo}/git/refs`,
      "--field",
      `ref=${buildGitHubBranchRefName(branchName)}`,
      "--field",
      `sha=${baseSha}`,
      "--jq",
      ".ref"
    ]);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("GitHub CLI (`gh`) is not installed on the Paperclip host")
    ) {
      throw error;
    }

    const output = getExecFileOutput(error);
    if (/reference already exists|already exists|http 422/i.test(output)) {
      throw new Error(GH_REFERENCE_ALREADY_EXISTS_ERROR);
    }

    throw new Error(
      output ? `GitHub CLI could not create ${branchName}: ${output}` : `GitHub CLI could not create ${branchName}.`
    );
  }
}

function mergeHeaders(defaultHeaders: Record<string, string>, requestHeaders?: HeadersInit): Headers {
  const headers = new Headers(defaultHeaders);
  if (requestHeaders) {
    const overrides = new Headers(requestHeaders);
    overrides.forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

async function fetchJsonOverHttp<T>(
  ctx: PluginContext,
  url: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await ctx.http.fetch(url, {
    ...init,
    headers: mergeHeaders(GITHUB_HEADERS, init.headers)
  });
  const bodyText = await response.text();

  if (!response.ok) {
    throw new HttpRequestError(buildRequestErrorMessage(url, response.status, bodyText), response.status);
  }

  return (bodyText ? JSON.parse(bodyText) : {}) as T;
}

async function fetchJsonViaGh<T>(endpoint: string): Promise<T> {
  try {
    const output = await runGhCommand(["api", endpoint]);
    return (output ? JSON.parse(output) : {}) as T;
  } catch (error) {
    const status = getGhHttpStatus(error);
    if (status !== null) {
      throw new HttpRequestError(
        getExecFileOutput(error) || `GitHub CLI request for ${endpoint} failed.`,
        status
      );
    }

    throw error;
  }
}

async function fetchJson<T>(ctx: PluginContext, url: string, init: RequestInit = {}): Promise<T> {
  const githubEndpoint = extractGitHubApiEndpoint(url);

  try {
    return await fetchJsonOverHttp<T>(ctx, url, init);
  } catch (error) {
    if (!githubEndpoint || !isGitHubApiRateLimitError(error)) {
      throw error;
    }

    try {
      return await fetchJsonViaGh<T>(githubEndpoint);
    } catch (ghError) {
      if (ghError instanceof HttpRequestError) {
        throw ghError;
      }

      throw error;
    }
  }
}

async function fetchText(ctx: PluginContext, url: string, init: RequestInit = {}): Promise<string> {
  const response = await ctx.http.fetch(url, {
    ...init,
    headers: mergeHeaders(
      {
        "user-agent": GITHUB_HEADERS["user-agent"]
      },
      init.headers
    )
  });
  const bodyText = await response.text();

  if (!response.ok) {
    throw new HttpRequestError(buildRequestErrorMessage(url, response.status, bodyText), response.status);
  }

  return bodyText;
}

function describePartialFailure(
  error: unknown,
  missingMessage: string,
  notFoundMessage: string
): string {
  if (error instanceof HttpRequestError && error.status === 404) {
    return notFoundMessage;
  }

  return missingMessage;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resolveBranchSyncStatus(
  role: MicronautBranchRole,
  aheadBy: number | null,
  behindBy: number | null
): MicronautBranchSyncStatus {
  if (role === "default") {
    return "default";
  }

  if (aheadBy === null || behindBy === null) {
    return "unavailable";
  }

  if (aheadBy === 0 && behindBy === 0) {
    return "up_to_date";
  }

  if (aheadBy > 0 && behindBy > 0) {
    return "diverged";
  }

  if (aheadBy > 0) {
    return "ahead";
  }

  return "behind";
}

function createBranchSummary(
  role: MicronautBranchRole,
  branchName: string | null,
  owner: string,
  repo: string,
  defaultBranch: string | null,
  overrides: Partial<MicronautProjectBranch> = {}
): MicronautProjectBranch {
  const hasBranchName = Boolean(branchName);

  return {
    role,
    label: getMicronautBranchLabel(role),
    name: branchName,
    url: branchName ? buildGitHubBranchUrl(owner, repo, branchName) : null,
    compareUrl:
      role !== "default" && branchName && defaultBranch
        ? buildGitHubCompareUrl(owner, repo, defaultBranch, branchName)
        : null,
    exists: null,
    syncStatus: role === "default" && hasBranchName ? "default" : "unavailable",
    aheadBy: role === "default" && hasBranchName ? 0 : null,
    behindBy: role === "default" && hasBranchName ? 0 : null,
    lastUpdatedAt: null,
    lastCommitSha: null,
    lastCommitUrl: null,
    ...overrides
  };
}

function logBranchWarning(
  ctx: PluginContext,
  repoFullName: string,
  branchName: string | null,
  message: string,
  error: unknown
): void {
  ctx.logger.warn(message, {
    repoFullName,
    branchName,
    error: error instanceof Error ? error.message : String(error)
  });
}

async function loadBranchSummary(
  ctx: PluginContext,
  owner: string,
  repo: string,
  repoFullName: string,
  role: MicronautBranchRole,
  branchName: string | null,
  defaultBranch: string | null,
  warnings: string[]
): Promise<MicronautProjectBranch> {
  if (!branchName) {
    return createBranchSummary(role, null, owner, repo, defaultBranch);
  }

  let branch: GitHubBranchResponse;
  try {
    branch = await fetchJson<GitHubBranchResponse>(ctx, buildBranchApiUrl(owner, repo, branchName));
  } catch (error) {
    if (error instanceof HttpRequestError && error.status === 404) {
      return createBranchSummary(role, branchName, owner, repo, defaultBranch, {
        exists: false,
        syncStatus: "missing"
      });
    }

    warnings.push(`The ${getMicronautBranchLabel(role).toLowerCase()} is temporarily unavailable.`);
    logBranchWarning(
      ctx,
      repoFullName,
      branchName,
      "Could not load Micronaut branch metadata.",
      error
    );
    return createBranchSummary(role, branchName, owner, repo, defaultBranch);
  }

  const resolvedBranchName = branch.name?.trim() || branchName;
  const commitSha = branch.commit?.sha?.trim() || null;
  let summary = createBranchSummary(role, resolvedBranchName, owner, repo, defaultBranch, {
    exists: true,
    lastCommitSha: commitSha
  });

  const [commitResult, compareResult] = await Promise.allSettled([
    commitSha ? fetchJson<GitHubCommitResponse>(ctx, buildCommitApiUrl(owner, repo, commitSha)) : Promise.resolve(null),
    role !== "default" && defaultBranch
      ? fetchJson<GitHubCompareResponse>(
          ctx,
          buildCompareApiUrl(owner, repo, defaultBranch, resolvedBranchName)
        )
      : Promise.resolve(null)
  ]);

  if (commitResult.status === "fulfilled" && commitResult.value) {
    summary = {
      ...summary,
      lastCommitUrl:
        commitResult.value.html_url?.trim() ||
        (commitSha ? `${summary.url?.replace(/\/tree\/.*$/, "")}/commit/${commitSha}` : null),
      lastUpdatedAt:
        commitResult.value.commit?.committer?.date?.trim() ||
        commitResult.value.commit?.author?.date?.trim() ||
        null
    };
  } else if (commitResult.status === "rejected" && commitSha) {
    warnings.push(`The last updated time for ${resolvedBranchName} is temporarily unavailable.`);
    logBranchWarning(
      ctx,
      repoFullName,
      resolvedBranchName,
      "Could not load Micronaut branch commit metadata.",
      commitResult.reason
    );
  }

  if (role === "default") {
    return summary;
  }

  if (compareResult.status === "fulfilled" && compareResult.value) {
    const aheadBy = numberOrNull(compareResult.value.ahead_by);
    const behindBy = numberOrNull(compareResult.value.behind_by);

    return {
      ...summary,
      compareUrl: compareResult.value.html_url?.trim() || summary.compareUrl,
      aheadBy,
      behindBy,
      syncStatus: resolveBranchSyncStatus(role, aheadBy, behindBy)
    };
  }

  if (compareResult.status === "rejected") {
    warnings.push(`The sync status for ${resolvedBranchName} is temporarily unavailable.`);
    logBranchWarning(
      ctx,
      repoFullName,
      resolvedBranchName,
      "Could not load Micronaut branch comparison metadata.",
      compareResult.reason
    );
  }

  return summary;
}

async function loadMicronautProjectOverviewReady(
  ctx: PluginContext,
  parsedRepository: { owner: string; repo: string; canonicalUrl: string },
  repoFullName: string
): Promise<Omit<MicronautProjectOverviewReady, "lastCheckedAt">> {
  const warnings: string[] = [];

  const [repositoryResult, releaseResult] = await Promise.allSettled([
    fetchJson<GitHubRepositoryResponse>(
      ctx,
      buildGitHubApiUrl(parsedRepository.owner, parsedRepository.repo, "")
    ),
    fetchJson<GitHubReleaseResponse>(
      ctx,
      buildGitHubApiUrl(parsedRepository.owner, parsedRepository.repo, "/releases/latest")
    )
  ]);

  let defaultBranch: string | null = null;
  if (repositoryResult.status === "fulfilled") {
    defaultBranch = repositoryResult.value.default_branch?.trim() || null;
  } else {
    warnings.push(
      describePartialFailure(
        repositoryResult.reason,
        "The repository default branch is temporarily unavailable.",
        "The repository metadata could not be found on GitHub."
      )
    );
    ctx.logger.warn("Could not load Micronaut repository metadata.", {
      repoFullName,
      error:
        repositoryResult.reason instanceof Error
          ? repositoryResult.reason.message
          : String(repositoryResult.reason)
    });
  }

  let currentVersion: string | null = null;
  let currentVersionUrl: string | null = `${parsedRepository.canonicalUrl}/releases`;
  if (releaseResult.status === "fulfilled") {
    currentVersion = normalizeReleaseVersion(releaseResult.value.tag_name);
    currentVersionUrl = releaseResult.value.html_url?.trim() || currentVersionUrl;
    if (!currentVersion) {
      warnings.push("The latest GitHub release does not expose a readable version tag.");
    }
  } else {
    warnings.push(
      describePartialFailure(
        releaseResult.reason,
        "The latest GitHub release is temporarily unavailable.",
        "This repository does not have a published GitHub release yet."
      )
    );
    ctx.logger.warn("Could not load Micronaut latest release.", {
      repoFullName,
      error:
        releaseResult.reason instanceof Error ? releaseResult.reason.message : String(releaseResult.reason)
    });
  }

  let nextVersion: string | null = null;
  let gradlePropertiesUrl: string | null = null;
  if (defaultBranch) {
    gradlePropertiesUrl = buildGradlePropertiesUrl(
      parsedRepository.owner,
      parsedRepository.repo,
      defaultBranch
    );

    try {
      const gradlePropertiesText = await fetchText(
        ctx,
        buildRawGradlePropertiesUrl(parsedRepository.owner, parsedRepository.repo, defaultBranch)
      );
      nextVersion = deriveNextVersion(parseProjectVersion(gradlePropertiesText));
      if (!nextVersion) {
        warnings.push("The root gradle.properties file does not define projectVersion.");
      }
    } catch (error) {
      warnings.push(
        describePartialFailure(
          error,
          "The next version is temporarily unavailable.",
          "The root gradle.properties file could not be found on the default branch."
        )
      );
      ctx.logger.warn("Could not load Micronaut gradle.properties.", {
        repoFullName,
        defaultBranch,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const nextMinorBranch = deriveNextMinorBranchName(defaultBranch);
  const nextMajorBranch = deriveNextMajorBranchName(defaultBranch);
  if (defaultBranch && (!nextMinorBranch || !nextMajorBranch)) {
    warnings.push(
      `The default branch ${defaultBranch} does not match Micronaut release branch naming, so next minor and major branches could not be derived.`
    );
  }

  const branches = await Promise.all([
    loadBranchSummary(
      ctx,
      parsedRepository.owner,
      parsedRepository.repo,
      repoFullName,
      "default",
      defaultBranch,
      defaultBranch,
      warnings
    ),
    loadBranchSummary(
      ctx,
      parsedRepository.owner,
      parsedRepository.repo,
      repoFullName,
      "nextMinor",
      nextMinorBranch,
      defaultBranch,
      warnings
    ),
    loadBranchSummary(
      ctx,
      parsedRepository.owner,
      parsedRepository.repo,
      repoFullName,
      "nextMajor",
      nextMajorBranch,
      defaultBranch,
      warnings
    )
  ]);

  return {
    kind: "ready",
    repoUrl: parsedRepository.canonicalUrl,
    repoFullName,
    defaultBranch,
    currentVersion,
    currentVersionUrl,
    nextVersion,
    gradlePropertiesUrl,
    branches,
    warnings
  };
}

async function clearMicronautProjectOverviewCache(
  ctx: PluginContext,
  projectId: string
): Promise<void> {
  await ctx.state.delete(buildProjectOverviewCacheScope(projectId));
}

async function readCachedMicronautProjectOverview(
  ctx: PluginContext,
  projectId: string,
  repoUrl: string
): Promise<MicronautProjectOverviewReady | null> {
  const cachedValue = await ctx.state.get(buildProjectOverviewCacheScope(projectId));
  const cacheEntry = normalizeProjectOverviewCacheEntry(cachedValue);

  if (!cacheEntry) {
    return null;
  }

  if (cacheEntry.repoUrl !== repoUrl) {
    await clearMicronautProjectOverviewCache(ctx, projectId);
    return null;
  }

  if (!isProjectOverviewCacheFresh(cacheEntry)) {
    return null;
  }

  return withLastCheckedAt(cacheEntry.overview, cacheEntry.checkedAt);
}

async function writeMicronautProjectOverviewCache(
  ctx: PluginContext,
  projectId: string,
  repoUrl: string,
  overview: Omit<MicronautProjectOverviewReady, "lastCheckedAt">
): Promise<MicronautProjectOverviewReady> {
  const checkedAt = new Date().toISOString();
  const overviewWithCheckedAt = withLastCheckedAt(overview, checkedAt);

  await ctx.state.set(buildProjectOverviewCacheScope(projectId), {
    version: 1,
    checkedAt,
    repoUrl,
    overview: overviewWithCheckedAt
  } satisfies MicronautProjectOverviewCacheEntry);

  return overviewWithCheckedAt;
}

async function readMicronautProjectOverview(
  ctx: PluginContext,
  params: Record<string, unknown>,
  options: { forceRefresh?: boolean } = {}
): Promise<MicronautProjectOverview> {
  const companyId = requireString(params, "companyId");
  const projectId = requireString(params, "projectId");
  const project = await ctx.projects.get(projectId, companyId);

  if (!project) {
    throw new Error(`Project ${projectId} was not found.`);
  }

  const repoUrl = resolveProjectRepositoryUrl(project);
  const parsedRepository = parseGitHubRepository(repoUrl);

  if (!parsedRepository) {
    await clearMicronautProjectOverviewCache(ctx, projectId);
    return {
      kind: "unsupported",
      reason: "This project is not connected to a GitHub repository.",
      repoUrl
    };
  }

  if (parsedRepository.owner !== MICRONAUT_GITHUB_ORGANIZATION) {
    await clearMicronautProjectOverviewCache(ctx, projectId);
    return {
      kind: "unsupported",
      reason: `This detail tab is only available for repositories in the ${MICRONAUT_GITHUB_ORGANIZATION} organization.`,
      repoUrl: parsedRepository.canonicalUrl
    };
  }

  if (!options.forceRefresh) {
    const cachedOverview = await readCachedMicronautProjectOverview(
      ctx,
      projectId,
      parsedRepository.canonicalUrl
    );
    if (cachedOverview) {
      return cachedOverview;
    }
  }

  const repoFullName = `${parsedRepository.owner}/${parsedRepository.repo}`;
  const freshOverview = await loadMicronautProjectOverviewReady(ctx, parsedRepository, repoFullName);

  return writeMicronautProjectOverviewCache(
    ctx,
    projectId,
    parsedRepository.canonicalUrl,
    freshOverview
  );
}

async function refreshMicronautProjectOverview(
  ctx: PluginContext,
  params: Record<string, unknown>
): Promise<MicronautProjectOverview> {
  return readMicronautProjectOverview(ctx, params, { forceRefresh: true });
}

async function createMicronautBranch(
  ctx: PluginContext,
  params: Record<string, unknown>
): Promise<MicronautCreateBranchResult> {
  const companyId = requireString(params, "companyId");
  const projectId = requireString(params, "projectId");
  const branchName = requireString(params, "branchName").trim();
  const project = await ctx.projects.get(projectId, companyId);

  if (!project) {
    throw new Error(`Project ${projectId} was not found.`);
  }

  const repoUrl = resolveProjectRepositoryUrl(project);
  const parsedRepository = parseGitHubRepository(repoUrl);
  if (!parsedRepository) {
    throw new Error("This project is not connected to a GitHub repository.");
  }

  if (parsedRepository.owner !== MICRONAUT_GITHUB_ORGANIZATION) {
    throw new Error(
      `This action is only available for repositories in the ${MICRONAUT_GITHUB_ORGANIZATION} organization.`
    );
  }

  const repository = await fetchJson<GitHubRepositoryResponse>(
    ctx,
    buildGitHubApiUrl(parsedRepository.owner, parsedRepository.repo, "")
  );
  const defaultBranch = repository.default_branch?.trim();

  if (!defaultBranch) {
    throw new Error(
      `GitHub did not report a default branch for ${parsedRepository.owner}/${parsedRepository.repo}.`
    );
  }

  try {
    const existingBranch = await fetchJson<GitHubBranchResponse>(
      ctx,
      buildBranchApiUrl(parsedRepository.owner, parsedRepository.repo, branchName)
    );
    const existingBranchName = existingBranch.name?.trim() || branchName;
    await clearMicronautProjectOverviewCache(ctx, projectId);

    return {
      status: "already_exists",
      branchName: existingBranchName,
      branchUrl: buildGitHubBranchUrl(
        parsedRepository.owner,
        parsedRepository.repo,
        existingBranchName
      ),
      baseBranch: defaultBranch
    };
  } catch (error) {
    if (!(error instanceof HttpRequestError && error.status === 404)) {
      throw error;
    }
  }

  const baseBranch = await fetchJson<GitHubBranchResponse>(
    ctx,
    buildBranchApiUrl(parsedRepository.owner, parsedRepository.repo, defaultBranch)
  );
  const baseSha = baseBranch.commit?.sha?.trim();
  if (!baseSha) {
    throw new Error(`Could not resolve the latest commit SHA for ${defaultBranch}.`);
  }

  try {
    await ensureGhCliAuthenticated();
    await createBranchWithGhCli(parsedRepository.owner, parsedRepository.repo, branchName, baseSha);
  } catch (error) {
    if (error instanceof Error && error.message === GH_REFERENCE_ALREADY_EXISTS_ERROR) {
      try {
        const existingBranch = await fetchJson<GitHubBranchResponse>(
          ctx,
          buildBranchApiUrl(parsedRepository.owner, parsedRepository.repo, branchName)
        );
        const existingBranchName = existingBranch.name?.trim() || branchName;
        await clearMicronautProjectOverviewCache(ctx, projectId);

        return {
          status: "already_exists",
          branchName: existingBranchName,
          branchUrl: buildGitHubBranchUrl(
            parsedRepository.owner,
            parsedRepository.repo,
            existingBranchName
          ),
          baseBranch: defaultBranch
        };
      } catch (lookupError) {
        if (!(lookupError instanceof HttpRequestError && lookupError.status === 404)) {
          throw lookupError;
        }
      }
    }

    throw error;
  }

  await clearMicronautProjectOverviewCache(ctx, projectId);

  return {
    status: "created",
    branchName,
    branchUrl: buildGitHubBranchUrl(parsedRepository.owner, parsedRepository.repo, branchName),
    baseBranch: defaultBranch
  };
}

const plugin = definePlugin({
  async setup(ctx) {
    ctx.data.register(MICRONAUT_PROJECT_OVERVIEW_DATA_KEY, async (params) =>
      readMicronautProjectOverview(ctx, params)
    );
    ctx.actions.register(MICRONAUT_REFRESH_PROJECT_OVERVIEW_ACTION_KEY, async (params) =>
      refreshMicronautProjectOverview(ctx, params)
    );
    ctx.actions.register(MICRONAUT_CREATE_BRANCH_ACTION_KEY, async (params) =>
      createMicronautBranch(ctx, params)
    );
  }
});

export default plugin;
runWorker(plugin, import.meta.url);
