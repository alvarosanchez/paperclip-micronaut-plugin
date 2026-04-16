import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { userInfo } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  definePlugin,
  startWorkerRpcHost,
  type PluginContext
} from "@paperclipai/plugin-sdk";
import {
  MICRONAUT_CREATE_BRANCH_ACTION_KEY,
  MICRONAUT_GITHUB_ORGANIZATION,
  MICRONAUT_MERGE_UP_STATE_DATA_KEY,
  MICRONAUT_PROJECT_OVERVIEW_DATA_KEY,
  MICRONAUT_REFRESH_PROJECT_OVERVIEW_ACTION_KEY,
  MICRONAUT_SET_MERGE_UP_AGENT_ACTION_KEY,
  MICRONAUT_START_MERGE_UP_ACTION_KEY,
  type MicronautBranchRole,
  type MicronautBranchSyncStatus,
  type MicronautBranchVersionStatus,
  type MicronautCreateBranchResult,
  type MicronautMergeUpAgentOption,
  type MicronautMergeUpIssue,
  type MicronautMergeUpState,
  type MicronautStartMergeUpResult,
  type MicronautProjectBranch,
  type MicronautProjectOverview,
  type MicronautProjectOverviewReady,
  buildGitHubBranchUrl,
  buildGitHubCompareUrl,
  buildGradlePropertiesUrl,
  compareProjectVersionValues,
  deriveNextMajorBranchName,
  deriveNextMinorBranchName,
  deriveNextVersion,
  deriveReleaseBranchProjectVersion,
  getMicronautBranchLabel,
  normalizeReleaseVersion,
  parseGitHubRepository,
  parseProjectVersion,
  parseProjectVersionValue,
  resolveProjectRepositoryUrl
} from "./micronaut.js";

const execFileAsync = promisify(execFile);
const GH_REFERENCE_ALREADY_EXISTS_ERROR = "GH_REFERENCE_ALREADY_EXISTS";
const GITHUB_HEADERS = {
  accept: "application/vnd.github+json",
  "user-agent": "paperclip-micronaut-plugin"
};
const GH_ENV_BIN_KEY = "PAPERCLIP_MICRONAUT_GH_BIN";
const PAPERCLIP_API_URL_ENV_KEY = "PAPERCLIP_API_URL";
const PAPERCLIP_API_KEY_ENV_KEY = "PAPERCLIP_API_KEY";
const MICRONAUT_STATE_NAMESPACE = "micronaut";
const MICRONAUT_PROJECT_OVERVIEW_CACHE_STATE_KEY = "project-overview-cache";
const MICRONAUT_COMPANY_SETTINGS_STATE_KEY = "company-settings";
const MICRONAUT_PROJECT_MERGE_UP_STATE_KEY = "merge-up-issues";
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

interface GitHubContentFileResponse {
  type?: string;
  encoding?: string;
  content?: string;
}

interface MicronautProjectOverviewCacheEntry {
  version: 1;
  checkedAt: string;
  repoUrl: string;
  overview: MicronautProjectOverviewReady;
}

interface MicronautCompanySettingsState {
  version: 1;
  preferredMergeUpAgentId: string | null;
}

interface MicronautTrackedMergeUpIssueRecord {
  targetBranch: string;
  sourceBranch: string;
  issueId: string;
  issueIdentifier: string | null;
  issueTitle: string | null;
  agentId: string | null;
  agentName: string | null;
  agentUrlKey: string | null;
  createdAt: string;
}

interface MicronautProjectMergeUpIssuesState {
  version: 1;
  issues: MicronautTrackedMergeUpIssueRecord[];
}

type MicronautIssueComment = Awaited<ReturnType<PluginContext["issues"]["listComments"]>>[number];

class HttpRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpRequestError";
    this.status = status;
  }
}

class GitHubCliFallbackError extends Error {
  constructor(primaryError: HttpRequestError, fallbackError: unknown) {
    const fallbackMessage =
      fallbackError instanceof Error && fallbackError.message.trim()
        ? fallbackError.message.trim()
        : "The GitHub CLI fallback failed.";

    super(`${primaryError.message} GitHub CLI fallback also failed: ${fallbackMessage}`);
    this.name = "GitHubCliFallbackError";
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

function buildCompanySettingsScope(companyId: string) {
  return {
    scopeKind: "company" as const,
    scopeId: companyId,
    namespace: MICRONAUT_STATE_NAMESPACE,
    stateKey: MICRONAUT_COMPANY_SETTINGS_STATE_KEY
  };
}

function buildProjectMergeUpIssuesScope(projectId: string) {
  return {
    scopeKind: "project" as const,
    scopeId: projectId,
    namespace: MICRONAUT_STATE_NAMESPACE,
    stateKey: MICRONAUT_PROJECT_MERGE_UP_STATE_KEY
  };
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeDateValue(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }

  return normalizeOptionalString(value);
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

function normalizeTrackedMergeUpIssueRecord(
  value: unknown
): MicronautTrackedMergeUpIssueRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const targetBranch = normalizeOptionalString(candidate.targetBranch) ?? "";
  const sourceBranch = normalizeOptionalString(candidate.sourceBranch) ?? "";
  const issueId = normalizeOptionalString(candidate.issueId) ?? "";
  const createdAt = normalizeOptionalString(candidate.createdAt) ?? "";

  if (!targetBranch || !sourceBranch || !issueId || !createdAt) {
    return null;
  }

  return {
    targetBranch,
    sourceBranch,
    issueId,
    issueIdentifier: normalizeOptionalString(candidate.issueIdentifier),
    issueTitle: normalizeOptionalString(candidate.issueTitle),
    agentId: normalizeOptionalString(candidate.agentId),
    agentName: normalizeOptionalString(candidate.agentName),
    agentUrlKey: normalizeOptionalString(candidate.agentUrlKey),
    createdAt
  };
}

function normalizeProjectMergeUpIssuesState(value: unknown): MicronautProjectMergeUpIssuesState {
  if (!value || typeof value !== "object") {
    return {
      version: 1,
      issues: []
    };
  }

  const candidate = value as Record<string, unknown>;
  const issues = Array.isArray(candidate.issues)
    ? candidate.issues
        .map((issue) => normalizeTrackedMergeUpIssueRecord(issue))
        .filter((issue): issue is MicronautTrackedMergeUpIssueRecord => Boolean(issue))
    : [];

  if (candidate.version !== 1) {
    return {
      version: 1,
      issues
    };
  }

  return {
    version: 1,
    issues
  };
}

function normalizeCompanySettingsState(value: unknown): MicronautCompanySettingsState {
  if (!value || typeof value !== "object") {
    return {
      version: 1,
      preferredMergeUpAgentId: null
    };
  }

  const candidate = value as Record<string, unknown>;
  const preferredMergeUpAgentId =
    typeof candidate.preferredMergeUpAgentId === "string"
      ? candidate.preferredMergeUpAgentId.trim() || null
      : null;

  return {
    version: 1,
    preferredMergeUpAgentId
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

function buildContentsApiUrl(owner: string, repo: string, filePath: string, ref: string): string {
  const encodedPath = filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const search = new URLSearchParams({
    ref
  });

  return `${buildGitHubApiUrl(owner, repo, `/contents/${encodedPath}`)}?${search.toString()}`;
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

function isGitHubApiRateLimitError(error: unknown): error is HttpRequestError {
  return (
    error instanceof HttpRequestError &&
    error.status === 403 &&
    /rate limit exceeded|secondary rate limit/i.test(error.message)
  );
}

function shouldUseGitHubCliFallback(error: unknown): boolean {
  if (isGitHubApiRateLimitError(error)) {
    return true;
  }

  if (error instanceof HttpRequestError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }

  if (error instanceof SyntaxError) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return /\baborted\b|\btimed?\s*out\b|fetch failed|network|socket|econnreset|eai_again|enotfound|etimedout/i.test(
    error.message
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

function buildPaperclipApiIssueCommentsUrl(issueRef: string): string | null {
  const baseUrl = normalizeOptionalString(process.env[PAPERCLIP_API_URL_ENV_KEY]);
  if (!baseUrl) {
    return null;
  }

  try {
    return new URL(`/api/issues/${encodeURIComponent(issueRef)}/comments`, `${baseUrl}/`).toString();
  } catch {
    return null;
  }
}

async function fetchIssueCommentsViaPaperclipApi(
  ctx: PluginContext,
  issueRef: string
): Promise<MicronautIssueComment[]> {
  const url = buildPaperclipApiIssueCommentsUrl(issueRef);
  if (!url) {
    return [];
  }

  const headers = new Headers({
    accept: "application/json"
  });
  const apiKey = normalizeOptionalString(process.env[PAPERCLIP_API_KEY_ENV_KEY]);
  if (apiKey) {
    headers.set("authorization", `Bearer ${apiKey}`);
  }

  const response = await ctx.http.fetch(url, {
    headers
  });
  const bodyText = await response.text();

  if (!response.ok) {
    throw new HttpRequestError(buildRequestErrorMessage(url, response.status, bodyText), response.status);
  }

  const parsed = bodyText ? (JSON.parse(bodyText) as unknown) : [];
  return Array.isArray(parsed) ? (parsed as MicronautIssueComment[]) : [];
}

async function fetchJson<T>(ctx: PluginContext, url: string, init: RequestInit = {}): Promise<T> {
  const githubEndpoint = extractGitHubApiEndpoint(url);

  try {
    return await fetchJsonOverHttp<T>(ctx, url, init);
  } catch (error) {
    if (!githubEndpoint || !shouldUseGitHubCliFallback(error)) {
      throw error;
    }

    try {
      return await fetchJsonViaGh<T>(githubEndpoint);
    } catch (ghError) {
      if (ghError instanceof HttpRequestError) {
        throw ghError;
      }

      if (error instanceof HttpRequestError) {
        throw new GitHubCliFallbackError(error, ghError);
      }

      throw error;
    }
  }
}

function decodeGitHubContentFile(response: GitHubContentFileResponse, description: string): string {
  const type = response.type?.trim().toLowerCase() ?? "";
  if (type && type !== "file") {
    throw new Error(`${description} is not a file.`);
  }

  const encoding = response.encoding?.trim().toLowerCase() ?? "";
  const content = typeof response.content === "string" ? response.content.trim() : "";
  if (encoding !== "base64" || !content) {
    throw new Error(`${description} did not include decodable file content.`);
  }

  return Buffer.from(content.replace(/\s+/g, ""), "base64").toString("utf8");
}

async function fetchGitHubFileText(
  ctx: PluginContext,
  owner: string,
  repo: string,
  filePath: string,
  ref: string
): Promise<string> {
  const response = await fetchJson<GitHubContentFileResponse>(
    ctx,
    buildContentsApiUrl(owner, repo, filePath, ref)
  );

  return decodeGitHubContentFile(response, `${filePath} on ${owner}/${repo}@${ref}`);
}

function describePartialFailure(
  error: unknown,
  missingMessage: string,
  notFoundMessage: string
): string {
  if (error instanceof HttpRequestError && error.status === 404) {
    return notFoundMessage;
  }

  if (error instanceof GitHubCliFallbackError) {
    return error.message;
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

function resolveBranchVersionStatus(branch: Pick<
  MicronautProjectBranch,
  "role" | "exists" | "projectVersion" | "expectedProjectVersion"
>): MicronautBranchVersionStatus {
  if (branch.role === "default") {
    return "default";
  }

  if (branch.exists === false) {
    return "missing";
  }

  if (!branch.projectVersion || !branch.expectedProjectVersion) {
    return "unavailable";
  }

  if (branch.projectVersion === branch.expectedProjectVersion) {
    return "aligned";
  }

  const parsedProjectVersion = parseProjectVersionValue(branch.projectVersion);
  const parsedExpectedVersion = parseProjectVersionValue(branch.expectedProjectVersion);
  if (!parsedProjectVersion || !parsedExpectedVersion) {
    return "unexpected";
  }

  return compareProjectVersionValues(parsedProjectVersion, parsedExpectedVersion) < 0
    ? "behind"
    : "unexpected";
}

function applyDerivedBranchState(branch: MicronautProjectBranch): MicronautProjectBranch {
  const canCreateBranch = branch.role !== "default" && branch.exists === false && Boolean(branch.name);
  const canMergeUp =
    branch.role !== "default" &&
    branch.exists === true &&
    typeof branch.behindBy === "number" &&
    branch.behindBy > 0;
  const canSetDefault =
    branch.role !== "default" &&
    branch.exists === true &&
    typeof branch.behindBy === "number" &&
    branch.behindBy === 0;

  return {
    ...branch,
    versionStatus: resolveBranchVersionStatus(branch),
    canCreateBranch,
    canMergeUp,
    canSetDefault
  };
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

  return applyDerivedBranchState({
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
    projectVersion: null,
    projectVersionUrl: null,
    expectedProjectVersion: branchName ? deriveReleaseBranchProjectVersion(branchName) : null,
    versionStatus: role === "default" ? "default" : "unavailable",
    canCreateBranch: false,
    canMergeUp: false,
    canSetDefault: false,
    ...overrides
  });
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

  const [commitResult, compareResult, projectVersionResult] = await Promise.allSettled([
    commitSha ? fetchJson<GitHubCommitResponse>(ctx, buildCommitApiUrl(owner, repo, commitSha)) : Promise.resolve(null),
    role !== "default" && defaultBranch
      ? fetchJson<GitHubCompareResponse>(
          ctx,
          buildCompareApiUrl(owner, repo, defaultBranch, resolvedBranchName)
        )
      : Promise.resolve(null),
    role !== "default"
      ? fetchGitHubFileText(ctx, owner, repo, "gradle.properties", resolvedBranchName)
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

  if (projectVersionResult.status === "fulfilled" && typeof projectVersionResult.value === "string") {
    const parsedProjectVersion = parseProjectVersion(projectVersionResult.value);

    summary = {
      ...summary,
      projectVersion: parsedProjectVersion,
      projectVersionUrl: buildGradlePropertiesUrl(owner, repo, resolvedBranchName)
    };

    if (!parsedProjectVersion) {
      warnings.push(`The root gradle.properties file on ${resolvedBranchName} does not define projectVersion.`);
    }
  } else if (projectVersionResult.status === "rejected") {
    warnings.push(`The projectVersion for ${resolvedBranchName} is temporarily unavailable.`);
    logBranchWarning(
      ctx,
      repoFullName,
      resolvedBranchName,
      "Could not load Micronaut branch gradle.properties.",
      projectVersionResult.reason
    );
  }

  if (role === "default") {
    return applyDerivedBranchState(summary);
  }

  if (compareResult.status === "fulfilled" && compareResult.value) {
    const aheadBy = numberOrNull(compareResult.value.ahead_by);
    const behindBy = numberOrNull(compareResult.value.behind_by);

    return applyDerivedBranchState({
      ...summary,
      compareUrl: compareResult.value.html_url?.trim() || summary.compareUrl,
      aheadBy,
      behindBy,
      syncStatus: resolveBranchSyncStatus(role, aheadBy, behindBy)
    });
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

  return applyDerivedBranchState(summary);
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
  let defaultBranchProjectVersion: string | null = null;
  if (defaultBranch) {
    gradlePropertiesUrl = buildGradlePropertiesUrl(
      parsedRepository.owner,
      parsedRepository.repo,
      defaultBranch
    );

    try {
      const gradlePropertiesText = await fetchGitHubFileText(
        ctx,
        parsedRepository.owner,
        parsedRepository.repo,
        "gradle.properties",
        defaultBranch
      );
      defaultBranchProjectVersion = parseProjectVersion(gradlePropertiesText);
      nextVersion = deriveNextVersion(defaultBranchProjectVersion);
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
  ]).then((loadedBranches) =>
    loadedBranches.map((branch) => {
      if (branch.role !== "default") {
        return branch;
      }

      return applyDerivedBranchState({
        ...branch,
        projectVersion: defaultBranchProjectVersion,
        projectVersionUrl: gradlePropertiesUrl,
        expectedProjectVersion: deriveReleaseBranchProjectVersion(defaultBranch)
      });
    })
  );

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

async function readCompanySettingsState(
  ctx: PluginContext,
  companyId: string
): Promise<MicronautCompanySettingsState> {
  return normalizeCompanySettingsState(await ctx.state.get(buildCompanySettingsScope(companyId)));
}

async function writeCompanySettingsState(
  ctx: PluginContext,
  companyId: string,
  state: MicronautCompanySettingsState
): Promise<void> {
  await ctx.state.set(buildCompanySettingsScope(companyId), state);
}

async function readProjectMergeUpIssuesState(
  ctx: PluginContext,
  projectId: string
): Promise<MicronautProjectMergeUpIssuesState> {
  return normalizeProjectMergeUpIssuesState(
    await ctx.state.get(buildProjectMergeUpIssuesScope(projectId))
  );
}

async function writeProjectMergeUpIssuesState(
  ctx: PluginContext,
  projectId: string,
  state: MicronautProjectMergeUpIssuesState
): Promise<void> {
  await ctx.state.set(buildProjectMergeUpIssuesScope(projectId), state);
}

function upsertTrackedMergeUpIssueRecord(
  issues: MicronautTrackedMergeUpIssueRecord[],
  issue: MicronautTrackedMergeUpIssueRecord
): MicronautTrackedMergeUpIssueRecord[] {
  const nextIssues = issues.filter(
    (candidate) =>
      candidate.issueId !== issue.issueId && candidate.targetBranch !== issue.targetBranch
  );

  nextIssues.push(issue);
  return nextIssues.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

async function persistTrackedMergeUpIssueRecord(
  ctx: PluginContext,
  projectId: string,
  issue: MicronautTrackedMergeUpIssueRecord
): Promise<MicronautTrackedMergeUpIssueRecord> {
  const current = await readProjectMergeUpIssuesState(ctx, projectId);
  await writeProjectMergeUpIssuesState(ctx, projectId, {
    version: 1,
    issues: upsertTrackedMergeUpIssueRecord(current.issues, issue)
  });

  return issue;
}

function isClosedMergeUpIssueStatus(status: string | null | undefined): boolean {
  return status === "done" || status === "cancelled";
}

function sortMergeUpIssues(issues: MicronautMergeUpIssue[]): MicronautMergeUpIssue[] {
  return [...issues].sort((left, right) => {
    const leftVisible = !isClosedMergeUpIssueStatus(left.status);
    const rightVisible = !isClosedMergeUpIssueStatus(right.status);
    if (leftVisible !== rightVisible) {
      return leftVisible ? -1 : 1;
    }

    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
}

function getUnknownObjectStringProperty(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = (value as Record<string, unknown>)[key];
  if (candidate instanceof Date && Number.isFinite(candidate.getTime())) {
    return candidate.toISOString();
  }

  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function extractPullRequestUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const match =
    /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+(?:[/?#][^\s)]*)?/i.exec(
      value
    );
  return match?.[0] ?? null;
}

function getIssueCommentTimestamp(comment: MicronautIssueComment): number {
  const timestamp =
    normalizeDateValue(getUnknownObjectStringProperty(comment, "updatedAt")) ??
    normalizeDateValue(getUnknownObjectStringProperty(comment, "createdAt"));
  if (!timestamp) {
    return 0;
  }

  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractPullRequestUrlFromComments(comments: MicronautIssueComment[]): string | null {
  for (const comment of [...comments].sort(
    (left, right) => getIssueCommentTimestamp(right) - getIssueCommentTimestamp(left)
  )) {
    const pullRequestUrl = extractPullRequestUrl(getUnknownObjectStringProperty(comment, "body"));
    if (pullRequestUrl) {
      return pullRequestUrl;
    }
  }

  return null;
}

async function buildMergeUpIssueSnapshot(
  ctx: PluginContext,
  companyId: string,
  record: MicronautTrackedMergeUpIssueRecord,
  agentLookup?: Map<string, Awaited<ReturnType<PluginContext["agents"]["list"]>>[number]>
): Promise<{
  record: MicronautTrackedMergeUpIssueRecord;
  issue: MicronautMergeUpIssue;
} | null> {
  const hostIssue = await ctx.issues.get(record.issueId, companyId);
  if (!hostIssue) {
    return null;
  }

  const resolvedAgentId = hostIssue.assigneeAgentId ?? record.agentId ?? null;
  const resolvedAgent =
    resolvedAgentId
      ? (agentLookup?.get(resolvedAgentId) ?? (await ctx.agents.get(resolvedAgentId, companyId)))
      : null;
  const createdAt = normalizeDateValue(hostIssue.createdAt) ?? record.createdAt;
  const updatedAt = normalizeDateValue(hostIssue.updatedAt) ?? createdAt;
  const identifier = normalizeOptionalString(hostIssue.identifier) ?? record.issueIdentifier ?? hostIssue.id;
  const title = normalizeOptionalString(hostIssue.title) ?? record.issueTitle ?? `Merge up ${record.sourceBranch} into ${record.targetBranch}`;
  const agentName = resolvedAgent?.name ?? record.agentName ?? null;
  const agentUrlKey = resolvedAgent?.urlKey ?? record.agentUrlKey ?? resolvedAgentId;
  const closedAt =
    hostIssue.status === "done"
      ? normalizeDateValue(hostIssue.completedAt) ?? updatedAt
      : hostIssue.status === "cancelled"
        ? normalizeDateValue(hostIssue.cancelledAt) ?? updatedAt
        : null;
  let pullRequestUrl: string | null = null;
  try {
    const comments = await ctx.issues.listComments(hostIssue.id, companyId);
    pullRequestUrl = extractPullRequestUrlFromComments(comments);
  } catch (error) {
    ctx.logger.warn("Could not load Micronaut merge-up issue comments.", {
      issueId: hostIssue.id,
      companyId,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  if (!pullRequestUrl) {
    const issueRef = identifier || hostIssue.id;
    try {
      const fallbackComments = await fetchIssueCommentsViaPaperclipApi(ctx, issueRef);
      pullRequestUrl = extractPullRequestUrlFromComments(fallbackComments);
    } catch (error) {
      ctx.logger.warn("Could not load Micronaut merge-up issue comments from the Paperclip API.", {
        issueId: hostIssue.id,
        issueRef,
        companyId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const nextRecord: MicronautTrackedMergeUpIssueRecord = {
    ...record,
    issueIdentifier: identifier,
    issueTitle: title,
    agentId: resolvedAgentId,
    agentName,
    agentUrlKey,
    createdAt
  };

  return {
    record: nextRecord,
    issue: {
      targetBranch: record.targetBranch,
      sourceBranch: record.sourceBranch,
      issueId: hostIssue.id,
      issueIdentifier: identifier,
      issueTitle: title,
      pullRequestUrl,
      status: hostIssue.status,
      agentId: resolvedAgentId,
      agentName,
      agentUrlKey,
      createdAt,
      updatedAt,
      closedAt
    }
  };
}

function normalizeMergeUpAgentOption(agent: {
  id: string;
  name: string;
  urlKey: string;
  title: string | null;
  icon?: string | null;
  status: string;
}): MicronautMergeUpAgentOption {
  return {
    id: agent.id,
    name: agent.name,
    urlKey: agent.urlKey,
    title: agent.title,
    icon: normalizeOptionalString(agent.icon) ?? null,
    status: agent.status
  };
}

function isSelectableMergeUpAgentStatus(status: string): boolean {
  return status !== "terminated" && status !== "pending_approval";
}

async function readMicronautMergeUpState(
  ctx: PluginContext,
  params: Record<string, unknown>
): Promise<MicronautMergeUpState> {
  const companyId = requireString(params, "companyId");
  const projectId = requireString(params, "projectId");
  const project = await ctx.projects.get(projectId, companyId);

  if (!project) {
    throw new Error(`Project ${projectId} was not found.`);
  }

  const [settings, agents, projectIssuesState] = await Promise.all([
    readCompanySettingsState(ctx, companyId),
    ctx.agents.list({
      companyId,
      limit: 200
    }),
    readProjectMergeUpIssuesState(ctx, projectId)
  ]);
  const agentLookup = new Map(agents.map((agent) => [agent.id, agent] as const));

  const agentOptions = agents
    .filter((agent) => isSelectableMergeUpAgentStatus(agent.status))
    .map((agent) => normalizeMergeUpAgentOption(agent))
    .sort((left, right) => left.name.localeCompare(right.name, "en", { sensitivity: "base" }));

  const preferredAgent = settings.preferredMergeUpAgentId
    ? agentOptions.find((agent) => agent.id === settings.preferredMergeUpAgentId) ?? null
    : null;

  if (settings.preferredMergeUpAgentId && !preferredAgent) {
    await writeCompanySettingsState(ctx, companyId, {
      version: 1,
      preferredMergeUpAgentId: null
    });
  }

  const hydratedIssues = (
    await Promise.all(
      projectIssuesState.issues.map((issue) =>
        buildMergeUpIssueSnapshot(ctx, companyId, issue, agentLookup)
      )
    )
  ).filter(
    (issue): issue is NonNullable<Awaited<ReturnType<typeof buildMergeUpIssueSnapshot>>> =>
      Boolean(issue)
  );
  const nextTrackedIssues = hydratedIssues.map((issue) => issue.record);
  if (JSON.stringify(nextTrackedIssues) !== JSON.stringify(projectIssuesState.issues)) {
    await writeProjectMergeUpIssuesState(ctx, projectId, {
      version: 1,
      issues: nextTrackedIssues
    });
  }

  return {
    kind: "ready",
    preferredAgentId: preferredAgent?.id ?? null,
    preferredAgentName: preferredAgent?.name ?? null,
    agents: agentOptions,
    issues: sortMergeUpIssues(hydratedIssues.map((issue) => issue.issue))
  };
}

async function setMicronautMergeUpAgent(
  ctx: PluginContext,
  params: Record<string, unknown>
): Promise<MicronautMergeUpAgentOption> {
  const companyId = requireString(params, "companyId");
  const agentId = requireString(params, "agentId");
  const agent = await ctx.agents.get(agentId, companyId);

  if (!agent || !isSelectableMergeUpAgentStatus(agent.status)) {
    throw new Error("Select an available agent to run Micronaut merge ups.");
  }

  await writeCompanySettingsState(ctx, companyId, {
    version: 1,
    preferredMergeUpAgentId: agent.id
  });

  return normalizeMergeUpAgentOption(agent);
}

function buildMergeUpIssueTitle(input: {
  sourceBranch: string;
  targetBranch: string;
}): string {
  return `Merge up ${input.sourceBranch} into ${input.targetBranch}`;
}

function buildMergeUpIssueDescription(input: {
  projectName: string;
  repoFullName: string;
  sourceBranch: string;
  targetBranch: string;
  expectedProjectVersion: string | null;
  targetBranchProjectVersion: string | null;
  targetBranchVersionStatus: MicronautBranchVersionStatus;
}): string {
  const needsProjectVersionAlignment =
    input.targetBranchVersionStatus === "behind" &&
    input.targetBranchProjectVersion &&
    input.expectedProjectVersion;

  return [
    `Merge up \`${input.sourceBranch}\` into \`${input.targetBranch}\`.`,
    "",
    `Project: ${input.projectName}`,
    `Repository: ${input.repoFullName}`,
    "",
    "Goal:",
    `Open a pull request into \`${input.targetBranch}\` that brings in the latest changes from \`${input.sourceBranch}\`.`,
    "",
    "Expected workflow:",
    `1. Start from \`origin/${input.targetBranch}\`.`,
    `2. Merge \`origin/${input.sourceBranch}\`.`,
    needsProjectVersionAlignment
      ? `3. Update \`gradle.properties\` on this work branch so \`projectVersion=${input.targetBranchProjectVersion}\` becomes \`projectVersion=${input.expectedProjectVersion}\`.`
      : "3. Resolve conflicts carefully without dropping changes from either branch.",
    needsProjectVersionAlignment
      ? "4. Resolve conflicts carefully without dropping changes from either branch."
      : "4. Run the smallest relevant validation for the files you touched.",
    needsProjectVersionAlignment
      ? "5. Run the smallest relevant validation for the files you touched."
      : `5. Push a working branch and open a PR targeting \`${input.targetBranch}\`.`,
    needsProjectVersionAlignment
      ? `6. Push a working branch and open a PR targeting \`${input.targetBranch}\`.`
      : null,
    "",
    "Constraints:",
    "- Never force-push or rewrite history.",
    `- Never push directly to \`${input.sourceBranch}\` or \`${input.targetBranch}\`.`,
    "- Do not change the repository default branch.",
    needsProjectVersionAlignment
      ? `- This branch is also behind on versioning, so the PR must include the required \`gradle.properties\` change to \`${input.expectedProjectVersion}\`.`
      : "- Only edit `gradle.properties` if the merge itself requires preserving an existing change from one of the two branches.",
    "- If auth, branch protection, or tooling blocks you, stop and report the exact blocker.",
    "",
    "When you finish:",
    "- Comment with the PR URL and the validation you ran.",
    "- Close the issue with a short summary of conflicts or follow-up work."
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function buildMergeUpIssueWakePrompt(input: {
  issueIdentifier: string;
  issueTitle: string;
  projectName: string;
  repoFullName: string;
  sourceBranch: string;
  targetBranch: string;
}): string {
  return [
    `You were just assigned Paperclip issue ${input.issueIdentifier}: ${input.issueTitle}.`,
    `Project: ${input.projectName}`,
    `Repository: ${input.repoFullName}`,
    "",
    "Open your assigned issue queue, pick up that issue immediately, and follow the issue instructions as the source of truth.",
    `This work is the Micronaut merge up from \`${input.sourceBranch}\` into \`${input.targetBranch}\`.`,
    "If another run is already active, make sure this issue is still on your radar as the next queued task."
  ].join("\n");
}

async function startMicronautMergeUp(
  ctx: PluginContext,
  params: Record<string, unknown>
): Promise<MicronautStartMergeUpResult> {
  const companyId = requireString(params, "companyId");
  const projectId = requireString(params, "projectId");
  const targetBranch = requireString(params, "targetBranch").trim();
  const requestedAgentId =
    typeof params.agentId === "string" && params.agentId.trim() ? params.agentId.trim() : null;
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

  const currentIssuesState = await readProjectMergeUpIssuesState(ctx, projectId);

  const settings = await readCompanySettingsState(ctx, companyId);
  const agentId = requestedAgentId ?? settings.preferredMergeUpAgentId;
  if (!agentId) {
    throw new Error("Choose an agent before starting a Micronaut merge up.");
  }

  const agent = await ctx.agents.get(agentId, companyId);
  if (!agent || !isSelectableMergeUpAgentStatus(agent.status)) {
    if (!requestedAgentId && settings.preferredMergeUpAgentId) {
      await writeCompanySettingsState(ctx, companyId, {
        version: 1,
        preferredMergeUpAgentId: null
      });
    }

    throw new Error("Choose an available agent before starting a Micronaut merge up.");
  }

  if (settings.preferredMergeUpAgentId !== agent.id) {
    await writeCompanySettingsState(ctx, companyId, {
      version: 1,
      preferredMergeUpAgentId: agent.id
    });
  }

  const repoFullName = `${parsedRepository.owner}/${parsedRepository.repo}`;
  const repository = await fetchJson<GitHubRepositoryResponse>(
    ctx,
    buildGitHubApiUrl(parsedRepository.owner, parsedRepository.repo, "")
  );
  const sourceBranch = repository.default_branch?.trim();

  if (!sourceBranch) {
    throw new Error(
      `GitHub did not report a default branch for ${parsedRepository.owner}/${parsedRepository.repo}.`
    );
  }

  const branchSummary = await loadBranchSummary(
    ctx,
    parsedRepository.owner,
    parsedRepository.repo,
    repoFullName,
    "nextMinor",
    targetBranch,
    sourceBranch,
    []
  );

  if (branchSummary.exists !== true) {
    throw new Error(`${targetBranch} does not exist yet, so it cannot be merged up.`);
  }

  if (!branchSummary.canMergeUp) {
    throw new Error(`${targetBranch} is not behind ${sourceBranch}, so a merge up is not needed right now.`);
  }

  const existingTrackedIssue = currentIssuesState.issues.find(
    (issue) => issue.targetBranch === targetBranch
  );
  if (existingTrackedIssue) {
    const existingSnapshot = await buildMergeUpIssueSnapshot(ctx, companyId, existingTrackedIssue);
    if (existingSnapshot && !isClosedMergeUpIssueStatus(existingSnapshot.issue.status)) {
      return {
        status: "already_exists",
        issue: existingSnapshot.issue
      };
    }
  }

  const createdIssue = await ctx.issues.create({
    companyId,
    projectId,
    title: buildMergeUpIssueTitle({
      sourceBranch,
      targetBranch
    }),
    description: buildMergeUpIssueDescription({
      projectName: project.name,
      repoFullName,
      sourceBranch,
      targetBranch,
      expectedProjectVersion: branchSummary.expectedProjectVersion,
      targetBranchProjectVersion: branchSummary.projectVersion,
      targetBranchVersionStatus: branchSummary.versionStatus
    }),
    priority: "medium",
    assigneeAgentId: agent.id
  });

  let liveIssue = createdIssue;
  try {
    liveIssue = await ctx.issues.update(createdIssue.id, { status: "todo" }, companyId);
  } catch (error) {
    const fallbackRecord: MicronautTrackedMergeUpIssueRecord = {
      targetBranch,
      sourceBranch,
      issueId: createdIssue.id,
      issueIdentifier: normalizeOptionalString(createdIssue.identifier),
      issueTitle: normalizeOptionalString(createdIssue.title),
      agentId: agent.id,
      agentName: agent.name,
      agentUrlKey: agent.urlKey,
      createdAt: normalizeDateValue(createdIssue.createdAt) ?? new Date().toISOString()
    };
    await persistTrackedMergeUpIssueRecord(ctx, projectId, fallbackRecord);
    throw error;
  }

  const trackedIssueRecord: MicronautTrackedMergeUpIssueRecord = {
    targetBranch,
    sourceBranch,
    issueId: liveIssue.id,
    issueIdentifier: normalizeOptionalString(liveIssue.identifier),
    issueTitle: normalizeOptionalString(liveIssue.title),
    agentId: agent.id,
    agentName: agent.name,
    agentUrlKey: agent.urlKey,
    createdAt: normalizeDateValue(liveIssue.createdAt) ?? new Date().toISOString()
  };
  await persistTrackedMergeUpIssueRecord(ctx, projectId, trackedIssueRecord);

  const issueSnapshot = await buildMergeUpIssueSnapshot(ctx, companyId, trackedIssueRecord);
  if (!issueSnapshot) {
    throw new Error("The merge-up issue was created, but it could not be loaded afterwards.");
  }

  try {
    await ctx.agents.invoke(agent.id, companyId, {
      reason: "issue_assigned",
      prompt: buildMergeUpIssueWakePrompt({
        issueIdentifier: issueSnapshot.issue.issueIdentifier,
        issueTitle: issueSnapshot.issue.issueTitle,
        projectName: project.name,
        repoFullName,
        sourceBranch,
        targetBranch
      })
    });
  } catch (error) {
    ctx.logger.warn("Could not wake Micronaut merge-up assignee after issue creation.", {
      issueId: issueSnapshot.issue.issueId,
      agentId: agent.id,
      projectId,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  return {
    status: "created",
    issue: issueSnapshot.issue
  };
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

export function shouldStartWorkerHost(moduleUrl: string, entry = process.argv[1]): boolean {
  if (typeof entry !== "string" || !entry.trim()) {
    return false;
  }

  const modulePath = fileURLToPath(moduleUrl);
  let entryPath = entry;

  if (entry.startsWith("file:")) {
    try {
      entryPath = fileURLToPath(new URL(entry));
    } catch {
      entryPath = entry;
    }
  }

  try {
    return realpathSync(entryPath) === realpathSync(modulePath);
  } catch {
    return resolve(entryPath) === resolve(modulePath);
  }
}

const plugin = definePlugin({
  async setup(ctx) {
    ctx.data.register(MICRONAUT_PROJECT_OVERVIEW_DATA_KEY, async (params) =>
      readMicronautProjectOverview(ctx, params)
    );
    ctx.data.register(MICRONAUT_MERGE_UP_STATE_DATA_KEY, async (params) =>
      readMicronautMergeUpState(ctx, params)
    );
    ctx.actions.register(MICRONAUT_REFRESH_PROJECT_OVERVIEW_ACTION_KEY, async (params) =>
      refreshMicronautProjectOverview(ctx, params)
    );
    ctx.actions.register(MICRONAUT_SET_MERGE_UP_AGENT_ACTION_KEY, async (params) =>
      setMicronautMergeUpAgent(ctx, params)
    );
    ctx.actions.register(MICRONAUT_START_MERGE_UP_ACTION_KEY, async (params) =>
      startMicronautMergeUp(ctx, params)
    );
    ctx.actions.register(MICRONAUT_CREATE_BRANCH_ACTION_KEY, async (params) =>
      createMicronautBranch(ctx, params)
    );
  }
});

export default plugin;

if (shouldStartWorkerHost(import.meta.url)) {
  startWorkerRpcHost({ plugin });
}
