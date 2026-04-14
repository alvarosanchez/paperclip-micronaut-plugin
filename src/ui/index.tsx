import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import type { PluginDetailTabProps } from "@paperclipai/plugin-sdk/ui";
import { usePluginAction, usePluginData, usePluginToast } from "@paperclipai/plugin-sdk/ui";
import {
  MICRONAUT_CREATE_BRANCH_ACTION_KEY,
  MICRONAUT_PROJECT_OVERVIEW_DATA_KEY,
  MICRONAUT_REFRESH_PROJECT_OVERVIEW_ACTION_KEY,
  type MicronautCreateBranchResult,
  type MicronautProjectBranch,
  type MicronautProjectOverview
} from "../micronaut.js";

const MICRONAUT_SYMBOL_URL = "https://objectcomputing.com/download_file/5213";

const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat("en", {
  numeric: "always"
});
const ABSOLUTE_TIME_FORMATTER = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short"
});
const OVERVIEW_SNAPSHOT_CACHE = new Map<string, MicronautProjectOverview>();

const HOST_BUTTON_BASE_CLASSNAME = [
  "inline-flex items-center justify-center whitespace-nowrap text-sm font-medium",
  "transition-[color,background-color,border-color,box-shadow,opacity]",
  "disabled:pointer-events-none disabled:opacity-50",
  "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
  "[&_svg]:shrink-0 outline-none focus-visible:border-ring",
  "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
  "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  "rounded-md gap-1.5 shrink-0 shadow-xs"
].join(" ");
const HOST_OUTLINE_BUTTON_CLASSNAME = [
  HOST_BUTTON_BASE_CLASSNAME,
  "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground",
  "dark:bg-input/30 dark:border-input dark:hover:bg-input/50"
].join(" ");
const HOST_INLINE_BUTTON_SIZE_CLASSNAME = "h-8 px-3 has-[>svg]:px-2.5";
const HOST_ICON_BUTTON_SIZE_CLASSNAME = "h-8 w-8 px-0";

type PluginActionButtonSize = "icon" | "sm";

function getPluginActionClassName(options?: {
  extraClassName?: string;
  size?: PluginActionButtonSize;
}): string {
  const size = options?.size ?? "sm";
  const sizeClassName =
    size === "icon" ? HOST_ICON_BUTTON_SIZE_CLASSNAME : HOST_INLINE_BUTTON_SIZE_CLASSNAME;

  return [
    "micronaut-project-tab__button",
    "micronaut-project-tab__button--secondary",
    size === "icon" ? "micronaut-project-tab__button--icon" : "micronaut-project-tab__button--sm",
    HOST_OUTLINE_BUTTON_CLASSNAME,
    sizeClassName,
    options?.extraClassName
  ]
    .filter(Boolean)
    .join(" ");
}

const STYLES = `
.micronaut-project-tab {
  --micronaut-border: rgba(148, 163, 184, 0.18);
  --micronaut-border: color-mix(in srgb, currentColor 14%, transparent);
  --micronaut-border-strong: rgba(148, 163, 184, 0.28);
  --micronaut-border-strong: color-mix(in srgb, currentColor 20%, transparent);
  --micronaut-surface: rgba(15, 23, 42, 0.26);
  --micronaut-surface: color-mix(in srgb, currentColor 4%, transparent);
  --micronaut-surface-strong: rgba(15, 23, 42, 0.36);
  --micronaut-surface-strong: color-mix(in srgb, currentColor 6%, transparent);
  --micronaut-text-strong: rgba(248, 250, 252, 0.96);
  --micronaut-text-muted: rgba(226, 232, 240, 0.78);
  --micronaut-text-subtle: rgba(226, 232, 240, 0.56);
  --micronaut-link: #67e8f9;
  --micronaut-default-bg: rgba(45, 212, 191, 0.14);
  --micronaut-default-border: rgba(45, 212, 191, 0.28);
  --micronaut-default-text: #99f6e4;
  --micronaut-success-bg: rgba(34, 197, 94, 0.14);
  --micronaut-success-border: rgba(34, 197, 94, 0.28);
  --micronaut-success-text: #86efac;
  --micronaut-info-bg: rgba(96, 165, 250, 0.14);
  --micronaut-info-border: rgba(96, 165, 250, 0.28);
  --micronaut-info-text: #93c5fd;
  --micronaut-warning-bg: rgba(245, 158, 11, 0.14);
  --micronaut-warning-border: rgba(245, 158, 11, 0.28);
  --micronaut-warning-text: #fdba74;
  --micronaut-danger-bg: rgba(239, 68, 68, 0.14);
  --micronaut-danger-border: rgba(239, 68, 68, 0.28);
  --micronaut-danger-text: #fca5a5;
  --micronaut-notice-bg: rgba(146, 64, 14, 0.12);
  --micronaut-notice-border: rgba(251, 191, 36, 0.24);
  --micronaut-notice-text: #fcd34d;
  color: inherit;
  display: grid;
  gap: 16px;
  max-width: 920px;
  width: 100%;
}

.micronaut-project-tab,
.micronaut-project-tab * {
  box-sizing: border-box;
}

.micronaut-project-tab__header {
  align-items: flex-start;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: space-between;
}

.micronaut-project-tab__header-main {
  align-items: flex-start;
  display: flex;
  gap: 12px;
  min-width: 0;
}

.micronaut-project-tab__header-actions {
  align-items: flex-end;
  display: grid;
  gap: 8px;
  justify-items: end;
}

.micronaut-project-tab__header-controls {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.micronaut-project-tab__header-status {
  color: var(--micronaut-text-subtle);
  font-size: 0.76rem;
  line-height: 1.4;
  margin: 0;
  text-align: right;
}

.micronaut-project-tab__brand {
  align-items: center;
  background: var(--micronaut-surface);
  border: 1px solid var(--micronaut-border);
  border-radius: 10px;
  display: inline-flex;
  flex: none;
  height: 32px;
  justify-content: center;
  width: 32px;
}

.micronaut-project-tab__brand img {
  display: block;
  height: 18px;
  width: 18px;
}

.micronaut-project-tab__eyebrow {
  color: var(--micronaut-text-subtle);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  margin: 0;
  text-transform: uppercase;
}

.micronaut-project-tab__title {
  color: var(--micronaut-text-strong);
  font-size: 1.02rem;
  font-weight: 600;
  line-height: 1.35;
  margin: 2px 0 0;
}

.micronaut-project-tab__description {
  color: var(--micronaut-text-muted);
  font-size: 0.9rem;
  line-height: 1.55;
  margin: 6px 0 0;
  max-width: 70ch;
}

.micronaut-project-tab__description code,
.micronaut-project-tab__value,
.micronaut-project-tab__branch-name,
.micronaut-project-tab__branch-name-link {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}

.micronaut-project-tab__header-link,
.micronaut-project-tab__action-link,
.micronaut-project-tab__branch-meta-link {
  color: var(--micronaut-link);
  text-decoration: none;
}

.micronaut-project-tab__button {
  text-decoration: none;
}

.micronaut-project-tab__button,
.micronaut-project-tab__button:visited {
  color: inherit;
}

.micronaut-project-tab__button--secondary {
  color: var(--micronaut-text-muted);
}

.micronaut-project-tab__button--secondary:hover {
  color: var(--micronaut-text-strong);
}

.micronaut-project-tab__button-content {
  align-items: center;
  display: inline-flex;
  gap: 6px;
}

.micronaut-project-tab__button--icon .micronaut-project-tab__button-content {
  justify-content: center;
  width: 100%;
}

.micronaut-project-tab__button-icon {
  flex: none;
  height: 14px;
  width: 14px;
}

.micronaut-project-tab__spinner {
  animation: micronaut-project-tab-spin 0.75s linear infinite;
  border: 1.5px solid color-mix(in srgb, currentColor 22%, transparent);
  border-radius: 999px;
  border-top-color: currentColor;
  display: inline-block;
  flex: none;
  height: 14px;
  width: 14px;
}

.micronaut-project-tab__sr-only {
  border: 0;
  clip: rect(0, 0, 0, 0);
  height: 1px;
  margin: -1px;
  overflow: hidden;
  padding: 0;
  position: absolute;
  white-space: nowrap;
  width: 1px;
}

.micronaut-project-tab__header-link {
  align-items: center;
  background: var(--micronaut-surface);
  border: 1px solid var(--micronaut-border);
  border-radius: 8px;
  color: var(--micronaut-text-muted);
  display: inline-flex;
  font-size: 0.78rem;
  font-weight: 600;
  gap: 8px;
  padding: 7px 10px;
  white-space: nowrap;
}

.micronaut-project-tab__header-link:hover,
.micronaut-project-tab__cta-link:hover,
.micronaut-project-tab__action-link:hover,
.micronaut-project-tab__branch-meta-link:hover {
  text-decoration: underline;
}

.micronaut-project-tab__cta-link {
  appearance: none;
  align-items: center;
  background: var(--micronaut-surface-strong);
  border: 1px solid var(--micronaut-border-strong);
  border-radius: 8px;
  color: var(--micronaut-text-strong);
  cursor: pointer;
  display: inline-flex;
  font-size: 0.76rem;
  font-family: inherit;
  font-weight: 600;
  line-height: 1;
  min-height: 32px;
  padding: 7px 10px;
  text-decoration: none;
  white-space: nowrap;
}

.micronaut-project-tab__cta-link:disabled,
.micronaut-project-tab__cta-link:disabled:hover {
  cursor: progress;
  opacity: 0.74;
  text-decoration: none;
}

.micronaut-project-tab__panel {
  background: var(--micronaut-surface);
  border: 1px solid var(--micronaut-border);
  border-radius: 12px;
  overflow: hidden;
}

.micronaut-project-tab__panel-header {
  border-bottom: 1px solid var(--micronaut-border);
  display: grid;
  gap: 4px;
  padding: 12px 14px;
}

.micronaut-project-tab__panel-title {
  color: var(--micronaut-text-strong);
  font-size: 0.88rem;
  font-weight: 600;
  line-height: 1.4;
  margin: 0;
}

.micronaut-project-tab__panel-description {
  color: var(--micronaut-text-muted);
  font-size: 0.8rem;
  line-height: 1.45;
  margin: 0;
}

.micronaut-project-tab__row {
  display: grid;
  gap: 12px 18px;
  padding: 14px;
}

.micronaut-project-tab__row + .micronaut-project-tab__row {
  border-top: 1px solid var(--micronaut-border);
}

.micronaut-project-tab__row--version {
  align-items: flex-start;
  grid-template-columns: minmax(140px, 160px) minmax(0, 1fr);
}

.micronaut-project-tab__row--branch {
  align-items: flex-start;
  grid-template-columns: minmax(140px, 160px) minmax(0, 1fr) auto;
}

.micronaut-project-tab__label {
  color: var(--micronaut-text-subtle);
  font-size: 0.78rem;
  font-weight: 600;
  line-height: 1.4;
  margin: 0;
}

.micronaut-project-tab__body {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.micronaut-project-tab__value-line {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.micronaut-project-tab__value {
  color: var(--micronaut-text-strong);
  font-size: 0.98rem;
  font-weight: 600;
  line-height: 1.35;
  margin: 0;
  overflow-wrap: anywhere;
}

.micronaut-project-tab__value--muted {
  color: var(--micronaut-text-subtle);
}

.micronaut-project-tab__supporting {
  color: var(--micronaut-text-muted);
  font-size: 0.8rem;
  line-height: 1.5;
  margin: 0;
}

.micronaut-project-tab__action-link {
  font-size: 0.78rem;
  font-weight: 600;
}

.micronaut-project-tab__branch-main {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.micronaut-project-tab__branch-name,
.micronaut-project-tab__branch-name-link {
  color: var(--micronaut-text-strong);
  font-size: 0.98rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.35;
  margin: 0;
  overflow-wrap: anywhere;
}

.micronaut-project-tab__branch-name-link {
  text-decoration: none;
}

.micronaut-project-tab__branch-name-link:hover {
  text-decoration: underline;
}

.micronaut-project-tab__branch-meta {
  align-items: center;
  color: var(--micronaut-text-muted);
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  font-size: 0.8rem;
  line-height: 1.45;
}

.micronaut-project-tab__branch-meta-label {
  color: var(--micronaut-text-subtle);
}

.micronaut-project-tab__status-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.micronaut-project-tab__status-pill {
  align-items: center;
  border: 1px solid transparent;
  border-radius: 999px;
  display: inline-flex;
  font-size: 0.75rem;
  font-weight: 700;
  gap: 6px;
  line-height: 1;
  padding: 5px 8px;
  white-space: nowrap;
}

.micronaut-project-tab__status-pill--default {
  background: var(--micronaut-default-bg);
  border-color: var(--micronaut-default-border);
  color: var(--micronaut-default-text);
}

.micronaut-project-tab__status-pill--success {
  background: var(--micronaut-success-bg);
  border-color: var(--micronaut-success-border);
  color: var(--micronaut-success-text);
}

.micronaut-project-tab__status-pill--info {
  background: var(--micronaut-info-bg);
  border-color: var(--micronaut-info-border);
  color: var(--micronaut-info-text);
}

.micronaut-project-tab__status-pill--warning {
  background: var(--micronaut-warning-bg);
  border-color: var(--micronaut-warning-border);
  color: var(--micronaut-warning-text);
}

.micronaut-project-tab__status-pill--danger {
  background: var(--micronaut-danger-bg);
  border-color: var(--micronaut-danger-border);
  color: var(--micronaut-danger-text);
}

.micronaut-project-tab__notice {
  background: var(--micronaut-notice-bg);
  border: 1px solid var(--micronaut-notice-border);
  border-radius: 12px;
  color: var(--micronaut-notice-text);
  display: grid;
  gap: 8px;
  padding: 14px;
}

.micronaut-project-tab__notice-title {
  color: var(--micronaut-text-strong);
  font-size: 0.88rem;
  font-weight: 600;
  margin: 0;
}

.micronaut-project-tab__notice-list {
  display: grid;
  gap: 6px;
  margin: 0;
  padding-left: 18px;
}

.micronaut-project-tab__state {
  background: var(--micronaut-surface);
  border: 1px solid var(--micronaut-border);
  border-radius: 12px;
  display: grid;
  gap: 8px;
  padding: 14px;
}

.micronaut-project-tab__state-title {
  color: var(--micronaut-text-strong);
  font-size: 0.94rem;
  font-weight: 600;
  line-height: 1.4;
  margin: 0;
}

.micronaut-project-tab__state-body {
  color: var(--micronaut-text-muted);
  font-size: 0.84rem;
  line-height: 1.5;
  margin: 0;
  max-width: 70ch;
}

@keyframes micronaut-project-tab-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 760px) {
  .micronaut-project-tab__header-actions {
    justify-items: start;
  }

  .micronaut-project-tab__header-controls {
    justify-content: flex-start;
  }

  .micronaut-project-tab__header-status {
    text-align: left;
  }

  .micronaut-project-tab__row--version,
  .micronaut-project-tab__row--branch {
    grid-template-columns: minmax(0, 1fr);
  }

  .micronaut-project-tab__status-list {
    justify-content: flex-start;
  }
}
`;

type StatusPillTone = "danger" | "default" | "info" | "success" | "warning";

interface StatusPill {
  label: string;
  tone: StatusPillTone;
}

function normalizeTextContent(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function applyMicronautTabIconStyles(icon: HTMLImageElement): void {
  icon.style.display = "inline-block";
  icon.style.flex = "none";
  icon.style.height = "14px";
  icon.style.marginInlineEnd = "6px";
  icon.style.objectFit = "contain";
  icon.style.verticalAlign = "text-bottom";
  icon.style.width = "14px";
}

function getErrorMessage(
  error: unknown,
  fallback = "The Micronaut request could not be completed right now."
): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }

  return fallback;
}

function getOverviewSnapshotCacheKey(companyId: string, projectId: string): string {
  return `${companyId}:${projectId}`;
}

function IconBase({ children }: { children: ReactNode }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className="micronaut-project-tab__button-icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 16 16"
    >
      {children}
    </svg>
  );
}

function RefreshIcon(): ReactElement {
  return (
    <IconBase>
      <path d="M13 3.5V7h-3.5" />
      <path d="M13 7A5.5 5.5 0 1 0 14 10" />
    </IconBase>
  );
}

function PlusBranchIcon(): ReactElement {
  return (
    <IconBase>
      <path d="M4.25 3a1.25 1.25 0 1 1 0 2.5A1.25 1.25 0 0 1 4.25 3Z" />
      <path d="M4.25 5.5v5.25a2.25 2.25 0 0 0 2.25 2.25h1" />
      <path d="M9.75 4.25A1.25 1.25 0 1 0 9.75 6.75 1.25 1.25 0 0 0 9.75 4.25Z" />
      <path d="M10 8.75v4.5" />
      <path d="M7.75 11h4.5" />
    </IconBase>
  );
}

function ExternalLinkIcon(): ReactElement {
  return (
    <IconBase>
      <path d="M9.5 3.5H13V7" />
      <path d="M7 9.5 13 3.5" />
      <path d="M12.25 8.75v3a.5.5 0 0 1-.5.5h-7.5a.5.5 0 0 1-.5-.5v-7.5a.5.5 0 0 1 .5-.5h3" />
    </IconBase>
  );
}

function LoadingSpinner(): ReactElement {
  return <span aria-hidden="true" className="micronaut-project-tab__spinner" />;
}

interface ButtonContentProps {
  busy?: boolean;
  busyLabel?: string;
  icon?: ReactNode;
  iconOnly?: boolean;
  label: string;
}

function ButtonContent({
  busy = false,
  busyLabel,
  icon,
  iconOnly = false,
  label
}: ButtonContentProps): ReactElement {
  const spokenLabel = busy ? busyLabel ?? label : label;

  return (
    <span className="micronaut-project-tab__button-content">
      {busy ? <LoadingSpinner /> : icon ?? null}
      {iconOnly ? <span className="micronaut-project-tab__sr-only">{spokenLabel}</span> : <span>{spokenLabel}</span>}
    </span>
  );
}

function formatRelativeTime(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const differenceInMilliseconds = parsed.getTime() - Date.now();
  const differenceInSeconds = differenceInMilliseconds / 1000;
  if (Math.abs(differenceInSeconds) < 45) {
    return "just now";
  }

  const divisions: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
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
      return RELATIVE_TIME_FORMATTER.format(Math.round(duration), division.unit);
    }

    duration /= division.amount;
  }

  return null;
}

function formatAbsoluteTime(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return ABSOLUTE_TIME_FORMATTER.format(parsed);
}

function getLastCheckedMeta(value: string | null | undefined): {
  label: string;
  title: string | null;
} {
  const absoluteTime = formatAbsoluteTime(value);
  const relativeTime = formatRelativeTime(value);

  return {
    label: relativeTime ? `Last checked ${relativeTime}` : "Last checked recently",
    title: absoluteTime
  };
}

function isMicronautHostTab(candidate: Element): candidate is HTMLElement {
  return (
    candidate instanceof HTMLElement &&
    candidate.getAttribute("role") === "tab" &&
    normalizeTextContent(candidate.textContent) === "Micronaut"
  );
}

function applyMicronautTabIconToTab(tab: HTMLElement): void {
  tab.dataset.micronautTab = "true";
  const existingIcon = tab.querySelector('[data-micronaut-tab-icon="true"]');
  if (existingIcon instanceof HTMLImageElement) {
    applyMicronautTabIconStyles(existingIcon);
    return;
  }

  const icon = document.createElement("img");
  icon.src = MICRONAUT_SYMBOL_URL;
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("data-micronaut-tab-icon", "true");
  applyMicronautTabIconStyles(icon);
  tab.prepend(icon);
}

function applyMicronautTabIconsToDocument(): void {
  if (typeof document === "undefined") {
    return;
  }

  for (const candidate of Array.from(document.querySelectorAll('[role="tab"]'))) {
    if (isMicronautHostTab(candidate)) {
      applyMicronautTabIconToTab(candidate);
    }
  }
}

function queueMicronautTabIconRefresh(): void {
  if (typeof window === "undefined") {
    return;
  }

  const windowWithMicronautState = window as Window & {
    __paperclipMicronautTabIconRefreshScheduled?: boolean;
  };

  if (windowWithMicronautState.__paperclipMicronautTabIconRefreshScheduled) {
    return;
  }

  windowWithMicronautState.__paperclipMicronautTabIconRefreshScheduled = true;
  window.requestAnimationFrame(() => {
    windowWithMicronautState.__paperclipMicronautTabIconRefreshScheduled = false;
    applyMicronautTabIconsToDocument();
  });
}

function startMicronautTabIconObserver(): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  const windowWithMicronautState = window as Window & {
    __paperclipMicronautTabIconObserver?: MutationObserver;
    __paperclipMicronautTabIconBootstrapScheduled?: boolean;
  };

  if (windowWithMicronautState.__paperclipMicronautTabIconObserver) {
    queueMicronautTabIconRefresh();
    return;
  }

  const startObserver = () => {
    if (windowWithMicronautState.__paperclipMicronautTabIconObserver) {
      queueMicronautTabIconRefresh();
      return;
    }

    if (!document.body) {
      window.requestAnimationFrame(() => {
        startObserver();
      });
      return;
    }

    const observer = new MutationObserver(() => {
      queueMicronautTabIconRefresh();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    windowWithMicronautState.__paperclipMicronautTabIconObserver = observer;
    queueMicronautTabIconRefresh();
  };

  if (document.readyState === "loading") {
    if (!windowWithMicronautState.__paperclipMicronautTabIconBootstrapScheduled) {
      windowWithMicronautState.__paperclipMicronautTabIconBootstrapScheduled = true;
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          windowWithMicronautState.__paperclipMicronautTabIconBootstrapScheduled = false;
          startObserver();
        },
        { once: true }
      );
    }
    return;
  }

  startObserver();
}

function getBranchStatusPills(branch: MicronautProjectBranch): StatusPill[] {
  if (branch.exists === false) {
    return [];
  }

  if (branch.role === "default") {
    return branch.name ? [{ label: "Default", tone: "default" }] : [{ label: "Unavailable", tone: "warning" }];
  }

  if (branch.syncStatus === "up_to_date" || (branch.aheadBy === 0 && branch.behindBy === 0)) {
    return [{ label: "Up to date", tone: "success" }];
  }

  const pills: StatusPill[] = [];
  if (typeof branch.aheadBy === "number" && branch.aheadBy > 0) {
    pills.push({
      label: `${branch.aheadBy} ahead`,
      tone: "info"
    });
  }
  if (typeof branch.behindBy === "number" && branch.behindBy > 0) {
    pills.push({
      label: `${branch.behindBy} behind`,
      tone: "warning"
    });
  }

  if (pills.length > 0) {
    return pills;
  }

  return [{ label: "Unavailable", tone: "warning" }];
}

function getBranchLastUpdatedLabel(branch: MicronautProjectBranch): {
  label: string;
  title: string | null;
} {
  if (branch.exists === false) {
    return {
      label: "Not created yet",
      title: null
    };
  }

  const relativeTime = formatRelativeTime(branch.lastUpdatedAt);
  return {
    label: relativeTime ?? "Unavailable",
    title: formatAbsoluteTime(branch.lastUpdatedAt)
  };
}

interface MicronautSurfaceProps {
  children: ReactNode;
}

function MicronautSurface({ children }: MicronautSurfaceProps): ReactElement {
  return (
    <section className="micronaut-project-tab" data-testid="micronaut-project-overview">
      <style>{STYLES}</style>
      {children}
    </section>
  );
}

interface PanelProps {
  title: string;
  description: string;
  children: ReactNode;
}

function Panel({ title, description, children }: PanelProps): ReactElement {
  return (
    <section className="micronaut-project-tab__panel">
      <header className="micronaut-project-tab__panel-header">
        <h3 className="micronaut-project-tab__panel-title">{title}</h3>
        <p className="micronaut-project-tab__panel-description">{description}</p>
      </header>
      {children}
    </section>
  );
}

interface VersionRowProps {
  description: string;
  href: string | null;
  label: string;
  linkLabel: string;
  value: string | null;
  valueTestId: string;
}

function VersionRow({
  description,
  href,
  label,
  linkLabel,
  value,
  valueTestId
}: VersionRowProps): ReactElement {
  const hasValue = Boolean(value);

  return (
    <div className="micronaut-project-tab__row micronaut-project-tab__row--version">
      <p className="micronaut-project-tab__label">{label}</p>
      <div className="micronaut-project-tab__body">
        <div className="micronaut-project-tab__value-line">
          <p
            className={`micronaut-project-tab__value${hasValue ? "" : " micronaut-project-tab__value--muted"}`}
            data-testid={valueTestId}
          >
            {value ?? "Unavailable"}
          </p>
          {href ? (
            <a
              className="micronaut-project-tab__action-link"
              href={href}
              rel="noreferrer"
              target="_blank"
            >
              {linkLabel}
            </a>
          ) : null}
        </div>
        <p className="micronaut-project-tab__supporting">{description}</p>
      </div>
    </div>
  );
}

interface BranchRowProps {
  branch: MicronautProjectBranch;
  defaultBranchName: string | null;
  disabled: boolean;
  isCreating: boolean;
  onCreateBranch: (branch: MicronautProjectBranch) => void | Promise<void>;
}

function BranchRow({
  branch,
  defaultBranchName,
  disabled,
  isCreating,
  onCreateBranch
}: BranchRowProps): ReactElement {
  const displayName = branch.name ?? "Unavailable";
  const showCreateBranchButton = branch.exists === false && branch.role !== "default" && Boolean(branch.name);
  const statusPills = getBranchStatusPills(branch);
  const lastUpdated = getBranchLastUpdatedLabel(branch);
  const isBranchLinkVisible = Boolean(branch.url) && branch.exists !== false;
  const compareLabel = defaultBranchName
    ? `Compare with ${defaultBranchName}`
    : "Compare with default";
  const nameTestId = branch.role === "default" ? "default-branch-value" : `branch-name-${branch.role}`;
  const createBranchTitle = branch.name
    ? `Create ${branch.name} from ${defaultBranchName ?? "the default branch"}`
    : "Create branch";

  return (
    <article
      className="micronaut-project-tab__row micronaut-project-tab__row--branch"
      data-branch-role={branch.role}
      data-sync-status={branch.syncStatus}
      data-testid={`branch-row-${branch.role}`}
    >
      <p className="micronaut-project-tab__label">{branch.label}</p>

      <div className="micronaut-project-tab__branch-main">
        {isBranchLinkVisible ? (
          <a
            className="micronaut-project-tab__branch-name-link"
            data-testid={nameTestId}
            href={branch.url ?? undefined}
            rel="noreferrer"
            target="_blank"
          >
            {displayName}
          </a>
        ) : (
          <p className="micronaut-project-tab__branch-name" data-testid={nameTestId}>
            {displayName}
          </p>
        )}

        <div className="micronaut-project-tab__branch-meta">
          <span>
            <span className="micronaut-project-tab__branch-meta-label">Last updated</span>{" "}
            <span data-testid={`branch-last-updated-${branch.role}`} title={lastUpdated.title ?? undefined}>
              {lastUpdated.label}
            </span>
          </span>
          {branch.compareUrl && branch.role !== "default" && branch.exists !== false ? (
            <a
              className="micronaut-project-tab__branch-meta-link"
              href={branch.compareUrl}
              rel="noreferrer"
              target="_blank"
            >
              {compareLabel}
            </a>
          ) : null}
        </div>
      </div>

      <div className="micronaut-project-tab__status-list" data-testid={`branch-status-${branch.role}`}>
        {showCreateBranchButton ? (
          <button
            aria-label={branch.name ? `Create branch ${branch.name}` : "Create branch"}
            aria-busy={isCreating ? "true" : undefined}
            className={getPluginActionClassName()}
            data-testid={`branch-create-${branch.role}`}
            disabled={disabled}
            onClick={() => {
              void onCreateBranch(branch);
            }}
            title={createBranchTitle}
            type="button"
          >
            <ButtonContent
              busy={isCreating}
              busyLabel="Creating..."
              icon={<PlusBranchIcon />}
              label="Create branch"
            />
          </button>
        ) : null}
        {statusPills.map((statusPill, index) => (
          <span
            className={`micronaut-project-tab__status-pill micronaut-project-tab__status-pill--${statusPill.tone}`}
            data-testid={`branch-pill-${branch.role}-${index}`}
            key={`${statusPill.label}-${index}`}
          >
            {statusPill.label}
          </span>
        ))}
      </div>
    </article>
  );
}

interface StatePanelProps {
  body: string;
  title: string;
}

function StatePanel({ body, title }: StatePanelProps): ReactElement {
  return (
    <MicronautSurface>
      <section className="micronaut-project-tab__state">
        <p className="micronaut-project-tab__eyebrow">Micronaut</p>
        <p className="micronaut-project-tab__state-title">{title}</p>
        <p className="micronaut-project-tab__state-body">{body}</p>
      </section>
    </MicronautSurface>
  );
}

interface MicronautProjectDetailTabBodyProps {
  companyId: string;
  projectId: string;
}

function MicronautProjectDetailTabBody({
  companyId,
  projectId
}: MicronautProjectDetailTabBodyProps): ReactElement | null {
  const overviewSnapshotCacheKey = getOverviewSnapshotCacheKey(companyId, projectId);
  const { data, error, loading } = usePluginData<MicronautProjectOverview>(
    MICRONAUT_PROJECT_OVERVIEW_DATA_KEY,
    {
      companyId,
      projectId
    }
  );
  const refreshOverview = usePluginAction(MICRONAUT_REFRESH_PROJECT_OVERVIEW_ACTION_KEY);
  const createBranch = usePluginAction(MICRONAUT_CREATE_BRANCH_ACTION_KEY);
  const toast = usePluginToast();
  const [displayedOverview, setDisplayedOverview] = useState<MicronautProjectOverview | null>(
    () => OVERVIEW_SNAPSHOT_CACHE.get(overviewSnapshotCacheKey) ?? null
  );
  const [isRefreshingOverview, setIsRefreshingOverview] = useState(false);
  const [pendingBranchRole, setPendingBranchRole] = useState<MicronautProjectBranch["role"] | null>(
    null
  );

  useEffect(() => {
    setDisplayedOverview(OVERVIEW_SNAPSHOT_CACHE.get(overviewSnapshotCacheKey) ?? null);
  }, [overviewSnapshotCacheKey]);

  useEffect(() => {
    if (!data) {
      return;
    }

    setDisplayedOverview(data);
    if (data.kind === "ready") {
      OVERVIEW_SNAPSHOT_CACHE.set(overviewSnapshotCacheKey, data);
      return;
    }

    OVERVIEW_SNAPSHOT_CACHE.delete(overviewSnapshotCacheKey);
  }, [data, overviewSnapshotCacheKey]);

  async function refreshDisplayedOverview(showErrorToast = true): Promise<MicronautProjectOverview | null> {
    setIsRefreshingOverview(true);

    try {
      const refreshedOverview = (await refreshOverview({
        companyId,
        projectId
      })) as MicronautProjectOverview;

      setDisplayedOverview(refreshedOverview);
      if (refreshedOverview.kind === "ready") {
        OVERVIEW_SNAPSHOT_CACHE.set(overviewSnapshotCacheKey, refreshedOverview);
      } else {
        OVERVIEW_SNAPSHOT_CACHE.delete(overviewSnapshotCacheKey);
      }

      return refreshedOverview;
    } catch (actionError) {
      if (showErrorToast) {
        toast({
          title: "Could not refresh Micronaut data",
          body: getErrorMessage(actionError, "Micronaut data could not be refreshed right now."),
          tone: "error"
        });
      }

      return null;
    } finally {
      setIsRefreshingOverview(false);
    }
  }

  async function handleCreateBranch(branch: MicronautProjectBranch): Promise<void> {
    if (!branch.name || pendingBranchRole || isRefreshingOverview) {
      return;
    }

    setPendingBranchRole(branch.role);
    try {
      const result = (await createBranch({
        companyId,
        projectId,
        branchName: branch.name
      })) as MicronautCreateBranchResult;

      const refreshedOverview = await refreshDisplayedOverview(false);
      const refreshedSnapshot = refreshedOverview?.kind === "ready";
      toast({
        title:
          result.status === "created"
            ? `Created ${result.branchName}`
            : `${result.branchName} already exists`,
        body:
          result.status === "created"
            ? refreshedSnapshot
              ? `Created from ${result.baseBranch}.`
              : `Created from ${result.baseBranch}. Refresh the Micronaut tab again if the cached view does not update right away.`
            : refreshedSnapshot
              ? `GitHub already has ${result.branchName}.`
              : `GitHub already has ${result.branchName}. Refresh the Micronaut tab again if the cached view does not update right away.`,
        tone: result.status === "created" ? "success" : "info",
        action: {
          label: "Open branch",
          href: result.branchUrl
        }
      });
    } catch (actionError) {
      toast({
        title: branch.name ? `Could not create ${branch.name}` : "Could not create branch",
        body: getErrorMessage(actionError, "The branch could not be created right now."),
        tone: "error"
      });
    } finally {
      setPendingBranchRole(null);
    }
  }

  if (loading && !displayedOverview) {
    return (
      <StatePanel
        body="Reading the latest GitHub release, gradle.properties, and the nearby Micronaut release branches."
        title="Loading Micronaut project metadata"
      />
    );
  }

  if (error && !displayedOverview) {
    return (
      <StatePanel
        body={error.message || "The Micronaut project overview could not be loaded right now."}
        title="Micronaut metadata is unavailable"
      />
    );
  }

  if (!displayedOverview || displayedOverview.kind === "unsupported") {
    return null;
  }

  const branchDescription = displayedOverview.defaultBranch
    ? `Default, next minor, and next major release branches derived from ${displayedOverview.defaultBranch}.`
    : "Default, next minor, and next major release branches for this repository.";
  const lastCheckedMeta = getLastCheckedMeta(displayedOverview.lastCheckedAt);
  const headerStatusLabel = isRefreshingOverview ? "Checking GitHub now..." : lastCheckedMeta.label;
  const actionsDisabled = pendingBranchRole !== null || isRefreshingOverview;

  return (
    <MicronautSurface>
      <header className="micronaut-project-tab__header">
        <div className="micronaut-project-tab__header-main">
          <div className="micronaut-project-tab__brand">
            <img alt="Micronaut" src={MICRONAUT_SYMBOL_URL} />
          </div>
          <div>
            <p className="micronaut-project-tab__eyebrow">Micronaut</p>
            <h2 className="micronaut-project-tab__title">{displayedOverview.repoFullName}</h2>
          </div>
        </div>

        <div className="micronaut-project-tab__header-actions">
          <p
            className="micronaut-project-tab__header-status"
            data-testid="last-checked-at-value"
            title={lastCheckedMeta.title ?? undefined}
          >
            {headerStatusLabel}
          </p>
          <div className="micronaut-project-tab__header-controls">
            <button
              aria-busy={isRefreshingOverview ? "true" : undefined}
              className={getPluginActionClassName()}
              data-testid="refresh-overview-button"
              disabled={actionsDisabled}
              onClick={() => {
                void refreshDisplayedOverview(true);
              }}
              title="Refresh Micronaut data"
              type="button"
            >
              <ButtonContent
                busy={isRefreshingOverview}
                busyLabel="Refreshing..."
                icon={<RefreshIcon />}
                label="Refresh"
              />
            </button>

            <a
              className={getPluginActionClassName()}
              href={displayedOverview.repoUrl}
              rel="noreferrer"
              target="_blank"
            >
              <ButtonContent icon={<ExternalLinkIcon />} label="Open repository" />
            </a>
          </div>
        </div>
      </header>

      <Panel
        description="Release metadata from GitHub and the repository root gradle.properties file."
        title="Versions"
      >
        <VersionRow
          description="Latest published GitHub release."
          href={displayedOverview.currentVersionUrl}
          label="Current version"
          linkLabel="Open release"
          value={displayedOverview.currentVersion}
          valueTestId="current-version-value"
        />
        <VersionRow
          description={
            displayedOverview.defaultBranch
              ? `Derived from gradle.properties on ${displayedOverview.defaultBranch}.`
              : "Derived from the repository root gradle.properties file."
          }
          href={displayedOverview.gradlePropertiesUrl}
          label="Next version"
          linkLabel="Open gradle.properties"
          value={displayedOverview.nextVersion}
          valueTestId="next-version-value"
        />
      </Panel>

      <Panel description={branchDescription} title="Branches">
        {displayedOverview.branches.map((branch) => (
          <BranchRow
            branch={branch}
            defaultBranchName={displayedOverview.defaultBranch}
            disabled={actionsDisabled}
            isCreating={pendingBranchRole === branch.role}
            key={branch.role}
            onCreateBranch={handleCreateBranch}
          />
        ))}
      </Panel>

      {displayedOverview.warnings.length > 0 ? (
        <section className="micronaut-project-tab__notice">
          <p className="micronaut-project-tab__notice-title">Some Micronaut data is unavailable</p>
          <ul className="micronaut-project-tab__notice-list">
            {displayedOverview.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </MicronautSurface>
  );
}

export function MicronautProjectDetailTab({
  context
}: PluginDetailTabProps): ReactElement | null {
  if (!context.companyId || !context.entityId) {
    return null;
  }

  return (
    <MicronautProjectDetailTabBody
      companyId={context.companyId}
      key={`${context.companyId}:${context.entityId}`}
      projectId={context.entityId}
    />
  );
}

startMicronautTabIconObserver();
