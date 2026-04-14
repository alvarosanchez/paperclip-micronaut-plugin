import type { Project } from "@paperclipai/plugin-sdk";

export const MICRONAUT_GITHUB_ORGANIZATION = "micronaut-projects";
export const MICRONAUT_PROJECT_OVERVIEW_DATA_KEY = "micronaut.project-overview";
export const MICRONAUT_PROJECT_DETAIL_TAB_ID = "micronaut-project-overview";
export const MICRONAUT_CREATE_BRANCH_ACTION_KEY = "micronaut.create-branch";
export const MICRONAUT_REFRESH_PROJECT_OVERVIEW_ACTION_KEY = "micronaut.refresh-project-overview";

const SNAPSHOT_SUFFIX = "-SNAPSHOT";
const RELEASE_BRANCH_PATTERN = /^(?<major>\d+)\.(?<minor>\d+)\.x$/;

export interface ParsedGitHubRepository {
  owner: string;
  repo: string;
  canonicalUrl: string;
}

export type MicronautBranchRole = "default" | "nextMinor" | "nextMajor";
export type MicronautBranchSyncStatus =
  | "default"
  | "up_to_date"
  | "ahead"
  | "behind"
  | "diverged"
  | "missing"
  | "unavailable";

export interface MicronautProjectBranch {
  role: MicronautBranchRole;
  label: string;
  name: string | null;
  url: string | null;
  compareUrl: string | null;
  exists: boolean | null;
  syncStatus: MicronautBranchSyncStatus;
  aheadBy: number | null;
  behindBy: number | null;
  lastUpdatedAt: string | null;
  lastCommitSha: string | null;
  lastCommitUrl: string | null;
}

export interface MicronautProjectOverviewUnsupported {
  kind: "unsupported";
  reason: string;
  repoUrl: string | null;
}

export interface MicronautProjectOverviewReady {
  kind: "ready";
  repoUrl: string;
  repoFullName: string;
  defaultBranch: string | null;
  currentVersion: string | null;
  currentVersionUrl: string | null;
  nextVersion: string | null;
  gradlePropertiesUrl: string | null;
  branches: MicronautProjectBranch[];
  lastCheckedAt: string;
  warnings: string[];
}

export type MicronautProjectOverview =
  | MicronautProjectOverviewUnsupported
  | MicronautProjectOverviewReady;

export interface MicronautCreateBranchResult {
  status: "already_exists" | "created";
  branchName: string;
  branchUrl: string;
  baseBranch: string;
}

function normalizeGitHubOwner(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeGitHubRepo(value: string): string {
  return value.trim().replace(/\.git$/i, "").toLowerCase();
}

export function resolveProjectRepositoryUrl(project: Project): string | null {
  return (
    project.codebase.repoUrl ??
    project.primaryWorkspace?.repoUrl ??
    project.workspaces.find((workspace) => workspace.isPrimary)?.repoUrl ??
    project.workspaces.find((workspace) => workspace.repoUrl)?.repoUrl ??
    null
  );
}

export function parseGitHubRepository(
  repoUrl: string | null | undefined
): ParsedGitHubRepository | null {
  if (!repoUrl) {
    return null;
  }

  const trimmed = repoUrl.trim();
  if (!trimmed) {
    return null;
  }

  const sshMatch =
    /^git@github\.com:(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/i.exec(trimmed) ??
    /^ssh:\/\/git@github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/i.exec(trimmed);
  if (sshMatch?.groups) {
    const owner = normalizeGitHubOwner(sshMatch.groups.owner);
    const repo = normalizeGitHubRepo(sshMatch.groups.repo);
    return {
      owner,
      repo,
      canonicalUrl: buildGitHubRepositoryUrl(owner, repo)
    };
  }

  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== "github.com" && hostname !== "www.github.com") {
      return null;
    }

    const [owner, repo] = parsed.pathname
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .slice(0, 2);
    if (!owner || !repo) {
      return null;
    }

    const normalizedOwner = normalizeGitHubOwner(owner);
    const normalizedRepo = normalizeGitHubRepo(repo);

    return {
      owner: normalizedOwner,
      repo: normalizedRepo,
      canonicalUrl: buildGitHubRepositoryUrl(normalizedOwner, normalizedRepo)
    };
  } catch {
    return null;
  }
}

export function buildGitHubRepositoryUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}`;
}

export function buildGitHubBranchUrl(owner: string, repo: string, branchName: string): string {
  return `${buildGitHubRepositoryUrl(owner, repo)}/tree/${encodeURIComponent(branchName)}`;
}

export function buildGitHubCompareUrl(
  owner: string,
  repo: string,
  baseBranch: string,
  compareBranch: string
): string {
  return `${buildGitHubRepositoryUrl(owner, repo)}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(compareBranch)}`;
}

export function buildGradlePropertiesUrl(
  owner: string,
  repo: string,
  ref: string
): string {
  return `${buildGitHubRepositoryUrl(owner, repo)}/blob/${encodeURIComponent(ref)}/gradle.properties`;
}

export function buildRawGradlePropertiesUrl(
  owner: string,
  repo: string,
  ref: string
): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/gradle.properties`;
}

export function normalizeReleaseVersion(tagName: string | null | undefined): string | null {
  if (!tagName) {
    return null;
  }

  const trimmed = tagName.trim();
  if (!trimmed) {
    return null;
  }

  return /^v\d/i.test(trimmed) ? trimmed.slice(1) : trimmed;
}

export function parseProjectVersion(propertiesText: string): string | null {
  const match = propertiesText.match(/^\s*projectVersion\s*=\s*(.+?)\s*$/m);
  if (!match) {
    return null;
  }

  const version = match[1]?.trim();
  return version ? version : null;
}

export function deriveNextVersion(projectVersion: string | null | undefined): string | null {
  if (!projectVersion) {
    return null;
  }

  const trimmed = projectVersion.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.endsWith(SNAPSHOT_SUFFIX)
    ? trimmed.slice(0, -SNAPSHOT_SUFFIX.length)
    : trimmed;
}

export function parseReleaseBranchName(
  branchName: string | null | undefined
): { major: number; minor: number } | null {
  if (!branchName) {
    return null;
  }

  const trimmed = branchName.trim();
  if (!trimmed) {
    return null;
  }

  const match = RELEASE_BRANCH_PATTERN.exec(trimmed);
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

export function buildReleaseBranchName(major: number, minor: number): string {
  return `${major}.${minor}.x`;
}

export function deriveNextMinorBranchName(branchName: string | null | undefined): string | null {
  const parsed = parseReleaseBranchName(branchName);
  if (!parsed) {
    return null;
  }

  return buildReleaseBranchName(parsed.major, parsed.minor + 1);
}

export function deriveNextMajorBranchName(branchName: string | null | undefined): string | null {
  const parsed = parseReleaseBranchName(branchName);
  if (!parsed) {
    return null;
  }

  return buildReleaseBranchName(parsed.major + 1, 0);
}

export function getMicronautBranchLabel(role: MicronautBranchRole): string {
  switch (role) {
    case "default":
      return "Default branch";
    case "nextMinor":
      return "Next minor branch";
    case "nextMajor":
      return "Next major branch";
    default:
      return "Branch";
  }
}
