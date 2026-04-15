import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { PluginDetailTabProps } from "@paperclipai/plugin-sdk/ui";
import { usePluginAction, usePluginData, usePluginToast } from "@paperclipai/plugin-sdk/ui";
import {
  Atom,
  Bot,
  Brain,
  Bug,
  CircuitBoard,
  Code,
  Cog,
  Cpu,
  Crown,
  Database,
  Eye,
  FileCode,
  Fingerprint,
  Flame,
  Gem,
  GitBranch,
  Globe,
  Hammer,
  Heart,
  Hexagon,
  Lightbulb,
  Lock,
  Mail,
  MessageSquare,
  Microscope,
  Package,
  Pentagon,
  Puzzle,
  Radar,
  Rocket,
  Search,
  Shield,
  Sparkles,
  Star,
  Swords,
  Target,
  Telescope,
  Terminal,
  Wand2,
  Wrench,
  Zap,
  type LucideIcon
} from "lucide-react";
import {
  MICRONAUT_CREATE_BRANCH_ACTION_KEY,
  MICRONAUT_MERGE_UP_STATE_DATA_KEY,
  MICRONAUT_PROJECT_OVERVIEW_DATA_KEY,
  MICRONAUT_REFRESH_PROJECT_OVERVIEW_ACTION_KEY,
  MICRONAUT_START_MERGE_UP_ACTION_KEY,
  type MicronautCreateBranchResult,
  type MicronautMergeUpAgentOption,
  type MicronautMergeUpIssue,
  type MicronautMergeUpState,
  type MicronautStartMergeUpResult,
  type MicronautProjectBranch,
  type MicronautProjectOverview
} from "../micronaut.js";

type MicronautThemeMode = "dark" | "light";
type LegacyMediaQueryList = MediaQueryList & {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
};

const MICRONAUT_THEME_ATTRIBUTE_NAMES = ["data-theme", "data-color-scheme", "data-mode"] as const;

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

const AGENT_ICONS: Record<string, LucideIcon> = {
  atom: Atom,
  bot: Bot,
  brain: Brain,
  bug: Bug,
  cog: Cog,
  code: Code,
  cpu: Cpu,
  crown: Crown,
  database: Database,
  eye: Eye,
  fingerprint: Fingerprint,
  flame: Flame,
  gem: Gem,
  globe: Globe,
  hammer: Hammer,
  heart: Heart,
  hexagon: Hexagon,
  lightbulb: Lightbulb,
  lock: Lock,
  mail: Mail,
  microscope: Microscope,
  package: Package,
  pentagon: Pentagon,
  puzzle: Puzzle,
  radar: Radar,
  rocket: Rocket,
  search: Search,
  shield: Shield,
  sparkles: Sparkles,
  star: Star,
  swords: Swords,
  target: Target,
  telescope: Telescope,
  terminal: Terminal,
  wrench: Wrench,
  zap: Zap,
  "circuit-board": CircuitBoard,
  "file-code": FileCode,
  "git-branch": GitBranch,
  "message-square": MessageSquare,
  wand: Wand2
};

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
  --micronaut-border: rgba(15, 23, 42, 0.12);
  --micronaut-border-strong: rgba(15, 23, 42, 0.18);
  --micronaut-surface: rgba(255, 255, 255, 0.92);
  --micronaut-surface-strong: rgba(244, 247, 252, 0.98);
  --micronaut-brand-bg:
    linear-gradient(135deg, rgba(8, 145, 178, 0.16), rgba(249, 115, 22, 0.12));
  --micronaut-brand-border: rgba(8, 145, 178, 0.22);
  --micronaut-text-strong: #0f172a;
  --micronaut-text-muted: rgba(15, 23, 42, 0.78);
  --micronaut-text-subtle: rgba(15, 23, 42, 0.58);
  --micronaut-link: #0f766e;
  --micronaut-default-bg: rgba(8, 145, 178, 0.12);
  --micronaut-default-border: rgba(8, 145, 178, 0.22);
  --micronaut-default-text: #0f766e;
  --micronaut-success-bg: rgba(22, 163, 74, 0.12);
  --micronaut-success-border: rgba(22, 163, 74, 0.2);
  --micronaut-success-text: #166534;
  --micronaut-info-bg: rgba(37, 99, 235, 0.1);
  --micronaut-info-border: rgba(37, 99, 235, 0.18);
  --micronaut-info-text: #1d4ed8;
  --micronaut-warning-bg: rgba(245, 158, 11, 0.12);
  --micronaut-warning-border: rgba(245, 158, 11, 0.2);
  --micronaut-warning-text: #b45309;
  --micronaut-danger-bg: rgba(239, 68, 68, 0.11);
  --micronaut-danger-border: rgba(239, 68, 68, 0.19);
  --micronaut-danger-text: #b91c1c;
  --micronaut-notice-bg: rgba(255, 247, 237, 0.96);
  --micronaut-notice-border: rgba(249, 115, 22, 0.22);
  --micronaut-notice-text: #9a3412;
  --micronaut-panel-shadow: 0 18px 40px rgba(15, 23, 42, 0.06);
  --micronaut-modal-backdrop: rgba(15, 23, 42, 0.2);
  --micronaut-modal-bg: rgba(255, 255, 255, 0.98);
  --micronaut-modal-shadow: 0 24px 72px rgba(15, 23, 42, 0.18);
  color: var(--micronaut-text-strong);
  color-scheme: light;
  display: grid;
  gap: 16px;
  max-width: 920px;
  width: 100%;
}

.micronaut-project-tab[data-theme-mode="dark"] {
  --micronaut-border: rgba(148, 163, 184, 0.18);
  --micronaut-border-strong: rgba(148, 163, 184, 0.28);
  --micronaut-surface: rgba(15, 23, 42, 0.58);
  --micronaut-surface-strong: rgba(15, 23, 42, 0.82);
  --micronaut-brand-bg:
    linear-gradient(135deg, rgba(8, 145, 178, 0.26), rgba(249, 115, 22, 0.16));
  --micronaut-brand-border: rgba(103, 232, 249, 0.22);
  --micronaut-text-strong: rgba(248, 250, 252, 0.96);
  --micronaut-text-muted: rgba(226, 232, 240, 0.82);
  --micronaut-text-subtle: rgba(226, 232, 240, 0.58);
  --micronaut-link: #67e8f9;
  --micronaut-default-bg: rgba(45, 212, 191, 0.16);
  --micronaut-default-border: rgba(45, 212, 191, 0.28);
  --micronaut-default-text: #99f6e4;
  --micronaut-success-bg: rgba(34, 197, 94, 0.14);
  --micronaut-success-border: rgba(34, 197, 94, 0.28);
  --micronaut-success-text: #86efac;
  --micronaut-info-bg: rgba(96, 165, 250, 0.15);
  --micronaut-info-border: rgba(96, 165, 250, 0.3);
  --micronaut-info-text: #bfdbfe;
  --micronaut-warning-bg: rgba(245, 158, 11, 0.16);
  --micronaut-warning-border: rgba(245, 158, 11, 0.32);
  --micronaut-warning-text: #fdba74;
  --micronaut-danger-bg: rgba(239, 68, 68, 0.16);
  --micronaut-danger-border: rgba(239, 68, 68, 0.32);
  --micronaut-danger-text: #fca5a5;
  --micronaut-notice-bg: rgba(120, 53, 15, 0.28);
  --micronaut-notice-border: rgba(251, 191, 36, 0.24);
  --micronaut-notice-text: #fcd34d;
  --micronaut-panel-shadow: 0 22px 48px rgba(2, 6, 23, 0.32);
  --micronaut-modal-backdrop: rgba(2, 6, 23, 0.72);
  --micronaut-modal-bg: rgba(15, 23, 42, 0.96);
  --micronaut-modal-shadow: 0 24px 80px rgba(2, 6, 23, 0.45);
  color-scheme: dark;
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
  box-shadow: var(--micronaut-panel-shadow);
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

.micronaut-project-tab__branch-supporting {
  color: var(--micronaut-text-muted);
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  font-size: 0.8rem;
  line-height: 1.5;
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
  box-shadow: var(--micronaut-panel-shadow);
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
  box-shadow: var(--micronaut-panel-shadow);
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

.micronaut-project-tab__modal-backdrop {
  align-items: center;
  backdrop-filter: blur(10px);
  background: var(--micronaut-modal-backdrop);
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 20px;
  position: fixed;
  z-index: 1000;
}

.micronaut-project-tab__modal {
  background: var(--micronaut-modal-bg);
  border: 1px solid var(--micronaut-border-strong);
  border-radius: 16px;
  box-shadow: var(--micronaut-modal-shadow);
  display: grid;
  gap: 14px;
  max-height: min(720px, calc(100vh - 40px));
  max-width: min(680px, calc(100vw - 40px));
  overflow: auto;
  padding: 18px;
  width: 100%;
}

.micronaut-project-tab__modal-header {
  display: grid;
  gap: 6px;
}

.micronaut-project-tab__modal-title {
  color: var(--micronaut-text-strong);
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.35;
  margin: 0;
}

.micronaut-project-tab__modal-body {
  display: grid;
  gap: 14px;
}

.micronaut-project-tab__modal-copy {
  color: var(--micronaut-text-muted);
  font-size: 0.85rem;
  line-height: 1.55;
  margin: 0;
}

.micronaut-project-tab__modal-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-left: 18px;
}

.micronaut-project-tab__modal-list li {
  color: var(--micronaut-text-muted);
  font-size: 0.84rem;
  line-height: 1.55;
}

.micronaut-project-tab__modal-card {
  background: var(--micronaut-surface);
  border: 1px solid var(--micronaut-border);
  border-radius: 12px;
  display: grid;
  gap: 8px;
  padding: 12px;
}

.micronaut-project-tab__modal-card-title {
  color: var(--micronaut-text-strong);
  font-size: 0.84rem;
  font-weight: 600;
  line-height: 1.4;
  margin: 0;
}

.micronaut-project-tab__modal-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.micronaut-project-tab__merge-up-picker-anchor {
  position: relative;
}

.micronaut-project-tab__merge-up-popover {
  background: var(--background, var(--micronaut-modal-bg));
  border: 1px solid var(--border, var(--micronaut-border-strong));
  border-radius: 12px;
  box-shadow: 0 16px 38px rgba(15, 23, 42, 0.22);
  min-width: min(280px, calc(100vw - 48px));
  padding: 6px;
  position: fixed;
  width: 280px;
  z-index: 1100;
}

.micronaut-project-tab__merge-up-issue-link {
  align-items: center;
  background: var(--micronaut-surface);
  border: 1px solid var(--micronaut-border);
  border-radius: 999px;
  color: var(--micronaut-text-muted);
  display: inline-flex;
  gap: 8px;
  min-height: 32px;
  padding: 0 10px;
  text-decoration: none;
}

.micronaut-project-tab__merge-up-issue-link:hover {
  background: var(--micronaut-surface-strong);
  border-color: var(--micronaut-border-strong);
  color: var(--micronaut-text-strong);
}

.micronaut-project-tab__merge-up-issue-label {
  font-size: 0.78rem;
  font-weight: 700;
  line-height: 1.2;
}

.micronaut-project-tab__merge-up-pr-link {
  align-items: center;
  background: color-mix(in srgb, var(--micronaut-info-bg) 88%, transparent);
  border: 1px solid var(--micronaut-info-border);
  border-radius: 999px;
  color: var(--micronaut-info-text);
  display: inline-flex;
  font-size: 0.78rem;
  font-weight: 700;
  min-height: 32px;
  padding: 0 10px;
  text-decoration: none;
}

.micronaut-project-tab__merge-up-pr-link:hover {
  border-color: color-mix(in srgb, var(--micronaut-info-border) 76%, currentColor);
  color: var(--micronaut-text-strong);
}

.micronaut-project-tab__issue-status-icon {
  align-items: center;
  border: 2px solid currentColor;
  border-radius: 999px;
  display: inline-flex;
  flex: none;
  height: 14px;
  justify-content: center;
  width: 14px;
}

.micronaut-project-tab__issue-status-icon--backlog {
  color: var(--micronaut-text-subtle);
}

.micronaut-project-tab__issue-status-icon--todo {
  color: #2563eb;
}

.micronaut-project-tab[data-theme-mode="dark"] .micronaut-project-tab__issue-status-icon--todo {
  color: #60a5fa;
}

.micronaut-project-tab__issue-status-icon--in_progress {
  color: #ca8a04;
}

.micronaut-project-tab[data-theme-mode="dark"] .micronaut-project-tab__issue-status-icon--in_progress {
  color: #facc15;
}

.micronaut-project-tab__issue-status-icon--in_review {
  color: #7c3aed;
}

.micronaut-project-tab[data-theme-mode="dark"] .micronaut-project-tab__issue-status-icon--in_review {
  color: #a78bfa;
}

.micronaut-project-tab__issue-status-icon--done {
  color: #16a34a;
}

.micronaut-project-tab[data-theme-mode="dark"] .micronaut-project-tab__issue-status-icon--done {
  color: #4ade80;
}

.micronaut-project-tab__issue-status-icon--cancelled {
  color: #737373;
}

.micronaut-project-tab__issue-status-icon--blocked {
  color: #dc2626;
}

.micronaut-project-tab[data-theme-mode="dark"] .micronaut-project-tab__issue-status-icon--blocked {
  color: #f87171;
}

.micronaut-project-tab__issue-status-icon-dot {
  background: currentColor;
  border-radius: 999px;
  display: block;
  height: 6px;
  width: 6px;
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

  .micronaut-project-tab__brand {
    min-width: 0;
    padding: 0 10px;
  }

  .micronaut-project-tab__row--version,
  .micronaut-project-tab__row--branch {
    grid-template-columns: minmax(0, 1fr);
  }

  .micronaut-project-tab__status-list {
    justify-content: flex-start;
  }

  .micronaut-project-tab__merge-up-popover {
    left: 0;
    min-width: 0;
    right: auto;
    width: min(320px, calc(100vw - 48px));
  }
}
`;

type StatusPillTone = "danger" | "default" | "info" | "success" | "warning";

interface StatusPill {
  label: string;
  tone: StatusPillTone;
}

function normalizeThemeToken(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function parseMicronautThemeMode(value: string | null | undefined): MicronautThemeMode | null {
  const normalized = normalizeThemeToken(value);
  if (!normalized) {
    return null;
  }

  if (/(^|[\s:_-])dark($|[\s:_-])/.test(normalized)) {
    return "dark";
  }

  if (/(^|[\s:_-])light($|[\s:_-])/.test(normalized)) {
    return "light";
  }

  return null;
}

function parseCssRgb(value: string | null | undefined): { b: number; g: number; r: number } | null {
  if (!value) {
    return null;
  }

  const match = value.match(
    /rgba?\(\s*(?<r>\d{1,3})\s*,\s*(?<g>\d{1,3})\s*,\s*(?<b>\d{1,3})(?:\s*,\s*[\d.]+)?\s*\)/i
  );
  if (!match?.groups) {
    return null;
  }

  const r = Number.parseInt(match.groups.r, 10);
  const g = Number.parseInt(match.groups.g, 10);
  const b = Number.parseInt(match.groups.b, 10);
  if ([r, g, b].some((channel) => !Number.isFinite(channel))) {
    return null;
  }

  return { r, g, b };
}

function getRelativeLuminance(color: { b: number; g: number; r: number }): number {
  const channels = [color.r, color.g, color.b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function getThemeModeFromElement(element: Element | null | undefined): MicronautThemeMode | null {
  if (!(element instanceof HTMLElement)) {
    return null;
  }

  for (const attributeName of MICRONAUT_THEME_ATTRIBUTE_NAMES) {
    const themeMode = parseMicronautThemeMode(element.getAttribute(attributeName));
    if (themeMode) {
      return themeMode;
    }
  }

  const themeMode = parseMicronautThemeMode(element.className);
  if (themeMode) {
    return themeMode;
  }

  const colorScheme = normalizeThemeToken(window.getComputedStyle(element).colorScheme);
  if (colorScheme === "dark" || colorScheme === "light") {
    return colorScheme;
  }

  return null;
}

function resolveMicronautThemeMode(): MicronautThemeMode {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return "light";
  }

  const explicitTheme =
    getThemeModeFromElement(document.documentElement) ?? getThemeModeFromElement(document.body);
  if (explicitTheme) {
    return explicitTheme;
  }

  const backgroundColor =
    parseCssRgb(window.getComputedStyle(document.body ?? document.documentElement).backgroundColor) ??
    parseCssRgb(window.getComputedStyle(document.documentElement).backgroundColor);
  if (backgroundColor) {
    return getRelativeLuminance(backgroundColor) < 0.34 ? "dark" : "light";
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function useMicronautThemeMode(): MicronautThemeMode {
  const [themeMode, setThemeMode] = useState<MicronautThemeMode>(() => resolveMicronautThemeMode());

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const updateThemeMode = () => {
      setThemeMode(resolveMicronautThemeMode());
    };
    updateThemeMode();

    const observer = new MutationObserver(() => {
      updateThemeMode();
    });
    const observerOptions = {
      attributes: true,
      attributeFilter: ["class", "style", ...MICRONAUT_THEME_ATTRIBUTE_NAMES]
    };

    observer.observe(document.documentElement, observerOptions);
    if (document.body) {
      observer.observe(document.body, observerOptions);
    }

    const mediaQuery =
      typeof window.matchMedia === "function"
        ? (window.matchMedia("(prefers-color-scheme: dark)") as LegacyMediaQueryList)
        : null;
    const handleChange = (_event: MediaQueryListEvent) => {
      updateThemeMode();
    };

    if (mediaQuery) {
      if (typeof mediaQuery.addEventListener === "function") {
        mediaQuery.addEventListener("change", handleChange);
      } else {
        mediaQuery.addListener?.(handleChange);
      }
    }

    return () => {
      observer.disconnect();
      if (!mediaQuery) {
        return;
      }

      if (typeof mediaQuery.removeEventListener === "function") {
        mediaQuery.removeEventListener("change", handleChange);
      } else {
        mediaQuery.removeListener?.(handleChange);
      }
    };
  }, []);

  return themeMode;
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

function SparkleIcon(): ReactElement {
  return (
    <IconBase>
      <path d="m8 2 .9 2.1L11 5l-2.1.9L8 8l-.9-2.1L5 5l2.1-.9Z" />
      <path d="m12.5 9 .45 1.05L14 10.5l-1.05.45L12.5 12l-.45-1.05L11 10.5l1.05-.45Z" />
      <path d="m4 9 .6 1.4L6 11l-1.4.6L4 13l-.6-1.4L2 11l1.4-.6Z" />
    </IconBase>
  );
}

function FlagIcon(): ReactElement {
  return (
    <IconBase>
      <path d="M4 13V3.25" />
      <path d="M4 3.75h6.25l-.85 1.95.85 1.95H4" />
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

function AgentIcon({
  className,
  icon
}: {
  className?: string;
  icon: string | null | undefined;
}): ReactElement {
  const Icon = AGENT_ICONS[icon ?? ""] ?? Bot;
  return <Icon aria-hidden="true" className={className} strokeWidth={1.75} />;
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

interface SetDefaultDialogState {
  kind: "setDefault";
  branch: MicronautProjectBranch;
  defaultBranchName: string | null;
}

interface BranchVersionSummary {
  href: string | null;
  linkLabel: string | null;
  text: string;
}

function createEmptyMergeUpState(): MicronautMergeUpState {
  return {
    kind: "ready",
    preferredAgentId: null,
    preferredAgentName: null,
    agents: [],
    issues: []
  };
}

function isMergeUpIssueClosed(issue: MicronautMergeUpIssue | null | undefined): boolean {
  return issue?.status === "done" || issue?.status === "cancelled";
}

function isMergeUpIssueVisible(issue: MicronautMergeUpIssue | null | undefined): boolean {
  return Boolean(issue) && !isMergeUpIssueClosed(issue);
}

function upsertMergeUpIssueList(
  issues: MicronautMergeUpIssue[],
  issue: MicronautMergeUpIssue
): MicronautMergeUpIssue[] {
  const nextIssues = issues.filter(
    (candidate) =>
      candidate.issueId !== issue.issueId && candidate.targetBranch !== issue.targetBranch
  );

  nextIssues.push(issue);
  return nextIssues.sort((left, right) => {
    const leftVisible = isMergeUpIssueVisible(left);
    const rightVisible = isMergeUpIssueVisible(right);
    if (leftVisible !== rightVisible) {
      return leftVisible ? -1 : 1;
    }

    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
}

function mergeMergeUpState(
  current: MicronautMergeUpState | null,
  incoming: MicronautMergeUpState
): MicronautMergeUpState {
  if (!current?.issues.length) {
    return incoming;
  }

  const currentIssueMap = new Map(current.issues.map((issue) => [issue.issueId, issue]));
  return {
    ...incoming,
    issues: incoming.issues.map((issue) => {
      const currentIssue = currentIssueMap.get(issue.issueId);
      if (!currentIssue?.pullRequestUrl || issue.pullRequestUrl) {
        return issue;
      }

      return {
        ...issue,
        pullRequestUrl: currentIssue.pullRequestUrl
      };
    })
  };
}

function getBranchMergeUpIssue(
  mergeUpState: MicronautMergeUpState | null,
  branchName: string | null
): MicronautMergeUpIssue | null {
  if (!mergeUpState || !branchName) {
    return null;
  }

  return mergeUpState.issues.find((issue) => issue.targetBranch === branchName) ?? null;
}

function getMergeUpIssueStatusLabel(status: MicronautMergeUpIssue["status"]): string {
  switch (status) {
    case "in_progress":
      return "In Progress";
    case "in_review":
      return "In Review";
    default:
      return status.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
  }
}

function getMergeUpIssueHref(
  issue: MicronautMergeUpIssue | null | undefined,
  companyPrefix: string | null,
  companyId: string | null
): string | null {
  if (!issue?.issueId) {
    return null;
  }

  const issueRef = issue.issueIdentifier || issue.issueId;
  const resolvedCompanyPrefix =
    normalizeCompanyPrefix(companyPrefix) ?? resolveFallbackCompanyPrefix();
  const companySegment = resolvedCompanyPrefix ? `/${encodeURIComponent(resolvedCompanyPrefix)}` : "";
  const pathname = `${companySegment}/issues/${encodeURIComponent(issueRef)}`;
  return buildHostHref(pathname, resolvedCompanyPrefix ? null : companyId);
}

function getPullRequestNumberFromUrl(url: string | null | undefined): string | null {
  const match = /\/pull\/(\d+)(?:[/?#]|$)/.exec(url ?? "");
  return match?.[1] ?? null;
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

function getPullRequestLabel(url: string | null | undefined): string {
  const pullRequestNumber = getPullRequestNumberFromUrl(url);
  return pullRequestNumber ? `PR #${pullRequestNumber}` : "Open PR";
}

interface IssueCommentSummary {
  body?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

function getIssueCommentTimestamp(comment: IssueCommentSummary): number {
  const timestamp = comment.updatedAt ?? comment.createdAt ?? null;
  if (!timestamp) {
    return 0;
  }

  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function fetchIssuePullRequestUrl(issue: MicronautMergeUpIssue): Promise<string | null> {
  if (typeof window === "undefined") {
    return null;
  }

  const issueRef = issue.issueIdentifier ?? issue.issueId;
  if (!issueRef) {
    return null;
  }

  const response = await fetch(
    new URL(`/api/issues/${encodeURIComponent(issueRef)}/comments`, window.location.origin).toString(),
    {
      headers: {
        accept: "application/json"
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Issue comments request failed with status ${response.status}`);
  }

  const comments = (await response.json()) as IssueCommentSummary[];
  if (!Array.isArray(comments)) {
    return null;
  }

  for (const comment of [...comments].sort(
    (left, right) => getIssueCommentTimestamp(right) - getIssueCommentTimestamp(left)
  )) {
    const pullRequestUrl = extractPullRequestUrl(comment.body);
    if (pullRequestUrl) {
      return pullRequestUrl;
    }
  }

  return null;
}

function normalizeCompanyPrefix(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized.replace(/^\/+|\/+$/g, "") : null;
}

function resolveFallbackCompanyPrefix(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const match = /^\/([^/]+)\/(?:agents|projects|issues|goals|dashboard|inbox|work|settings)(?:\/|$)/i.exec(
    window.location.pathname
  );
  return match?.[1]?.trim() || null;
}

function buildHostHref(pathname: string, companyId: string | null = null): string {
  const normalizedCompanyId = companyId?.trim() ?? "";

  if (typeof window === "undefined") {
    if (!normalizedCompanyId) {
      return pathname;
    }

    const separator = pathname.includes("?") ? "&" : "?";
    return `${pathname}${separator}companyId=${encodeURIComponent(normalizedCompanyId)}`;
  }

  const url = new URL(pathname, window.location.origin);
  if (normalizedCompanyId) {
    url.searchParams.set("companyId", normalizedCompanyId);
  }

  return url.toString();
}

function formatCommitCount(value: number): string {
  return `${value} ${value === 1 ? "commit" : "commits"}`;
}

function getBranchSyncSummary(branch: MicronautProjectBranch, defaultBranchName: string | null): string {
  const referenceBranchName = defaultBranchName ?? "the current default branch";
  if (branch.role === "default") {
    return branch.name
      ? `${branch.name} is the current default branch.`
      : "The current default branch is temporarily unavailable.";
  }

  if (branch.exists === false) {
    return branch.name
      ? `${branch.name} has not been created yet.`
      : "This upcoming release branch has not been created yet.";
  }

  if (typeof branch.behindBy === "number" && typeof branch.aheadBy === "number") {
    if (branch.behindBy === 0 && branch.aheadBy === 0) {
      return `${branch.name ?? "This branch"} is up to date with ${referenceBranchName}.`;
    }

    if (branch.behindBy === 0 && branch.aheadBy > 0) {
      return `${branch.name ?? "This branch"} is ${formatCommitCount(branch.aheadBy)} ahead of ${referenceBranchName} and not behind it.`;
    }

    return `${branch.name ?? "This branch"} is ${formatCommitCount(branch.aheadBy)} ahead and ${formatCommitCount(branch.behindBy)} behind ${referenceBranchName}.`;
  }

  return `${branch.name ?? "This branch"} could not be compared with ${referenceBranchName} yet.`;
}

function getBranchVersionSummary(branch: MicronautProjectBranch): BranchVersionSummary {
  if (branch.role === "default") {
    if (branch.projectVersion) {
      return {
        href: branch.projectVersionUrl,
        linkLabel: branch.projectVersionUrl ? "Open gradle.properties" : null,
        text: `projectVersion is ${branch.projectVersion} on the default branch.`
      };
    }

    return {
      href: branch.projectVersionUrl,
      linkLabel: branch.projectVersionUrl ? "Open gradle.properties" : null,
      text: "projectVersion is unavailable on the default branch."
    };
  }

  if (branch.exists === false) {
    return {
      href: null,
      linkLabel: null,
      text: branch.expectedProjectVersion
        ? `When ${branch.name ?? "this branch"} is created, it should use projectVersion=${branch.expectedProjectVersion}.`
        : "The expected projectVersion for this branch could not be derived yet."
    };
  }

  if (branch.versionStatus === "aligned" && branch.projectVersion) {
    return {
      href: branch.projectVersionUrl,
      linkLabel: branch.projectVersionUrl ? "Open gradle.properties" : null,
      text: `projectVersion ${branch.projectVersion} already matches ${branch.name ?? "this branch"}.`
    };
  }

  if (
    branch.versionStatus === "behind" &&
    branch.projectVersion &&
    branch.expectedProjectVersion
  ) {
    return {
      href: branch.projectVersionUrl,
      linkLabel: branch.projectVersionUrl ? "Open gradle.properties" : null,
      text: `projectVersion ${branch.projectVersion} is behind ${branch.name ?? "this branch"}; expected ${branch.expectedProjectVersion}.`
    };
  }

  if (
    branch.versionStatus === "unexpected" &&
    branch.projectVersion &&
    branch.expectedProjectVersion
  ) {
    return {
      href: branch.projectVersionUrl,
      linkLabel: branch.projectVersionUrl ? "Open gradle.properties" : null,
      text: `projectVersion ${branch.projectVersion} differs from the expected ${branch.expectedProjectVersion}.`
    };
  }

  return {
    href: branch.projectVersionUrl,
    linkLabel: branch.projectVersionUrl ? "Open gradle.properties" : null,
    text: branch.expectedProjectVersion
      ? `The branch should eventually use projectVersion=${branch.expectedProjectVersion}, but the current value could not be read.`
      : "The current projectVersion could not be read."
  };
}

function getBranchStatusPills(branch: MicronautProjectBranch): StatusPill[] {
  if (branch.exists === false) {
    return [];
  }

  if (branch.role === "default") {
    return branch.name ? [{ label: "Default", tone: "default" }] : [{ label: "Unavailable", tone: "warning" }];
  }

  const pills: StatusPill[] = [];
  if (branch.syncStatus === "up_to_date" || (branch.aheadBy === 0 && branch.behindBy === 0)) {
    pills.push({ label: "Up to date", tone: "success" });
  }

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
    if (branch.versionStatus === "behind") {
      pills.push({
        label: "Needs version PR",
        tone: "warning"
      });
    } else if (branch.versionStatus === "unexpected") {
      pills.push({
        label: "Version differs",
        tone: "danger"
      });
    }

    return pills;
  }

  if (branch.versionStatus === "behind") {
    return [{ label: "Needs version PR", tone: "warning" }];
  }

  if (branch.versionStatus === "unexpected") {
    return [{ label: "Version differs", tone: "danger" }];
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
  themeMode: MicronautThemeMode;
}

function MicronautSurface({ children, themeMode }: MicronautSurfaceProps): ReactElement {
  return (
    <section
      className="micronaut-project-tab"
      data-testid="micronaut-project-overview"
      data-theme-mode={themeMode}
    >
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
  isMergeUpBusy: boolean;
  isMergeUpStateLoading: boolean;
  isMergeUpPickerOpen: boolean;
  mergeUpAgents: MicronautMergeUpAgentOption[];
  mergeUpIssue: MicronautMergeUpIssue | null;
  mergeUpIssueHref: string | null;
  pendingAgentId: string | null;
  preferredAgentId: string | null;
  onCreateBranch: (branch: MicronautProjectBranch) => void | Promise<void>;
  onCloseMergeUpPicker: () => void;
  onOpenSetDefaultPreview: (branch: MicronautProjectBranch) => void;
  onOpenMergeUpPicker: (branch: MicronautProjectBranch) => void;
  onSelectMergeUpAgent: (branch: MicronautProjectBranch, agentId: string) => void;
}

function shouldLetBrowserHandleClick(event: {
  altKey: boolean;
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

function MergeUpIssueStatusIcon({
  status
}: {
  status: MicronautMergeUpIssue["status"];
}): ReactElement {
  return (
    <span
      aria-label={getMergeUpIssueStatusLabel(status)}
      className={`micronaut-project-tab__issue-status-icon micronaut-project-tab__issue-status-icon--${status}`}
      title={getMergeUpIssueStatusLabel(status)}
    >
      {status === "done" ? <span className="micronaut-project-tab__issue-status-icon-dot" /> : null}
    </span>
  );
}

interface MergeUpAgentPopoverProps {
  anchorRect: DOMRect | null;
  agents: MicronautMergeUpAgentOption[];
  isLoadingState: boolean;
  onClose: () => void;
  onSelectAgent: (agentId: string) => void;
  pendingAgentId: string | null;
  preferredAgentId: string | null;
}

function MergeUpAgentPopover({
  anchorRect,
  agents,
  isLoadingState,
  onClose,
  onSelectAgent,
  pendingAgentId,
  preferredAgentId
}: MergeUpAgentPopoverProps): ReactElement {
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!anchorRect || typeof window === "undefined") {
      setPosition(null);
      return;
    }

    const popoverWidth = Math.min(280, window.innerWidth - 48);
    setPosition({
      left: Math.max(24, Math.min(anchorRect.right - popoverWidth, window.innerWidth - popoverWidth - 24)),
      top: Math.min(anchorRect.bottom + 8, window.innerHeight - 24)
    });
  }, [anchorRect]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const orderedAgents = useMemo(
    () =>
      [...agents].sort((left, right) => {
        const leftPreferred = left.id === preferredAgentId;
        const rightPreferred = right.id === preferredAgentId;
        if (leftPreferred !== rightPreferred) {
          return leftPreferred ? -1 : 1;
        }

        return left.name.localeCompare(right.name, "en", { sensitivity: "base" });
      }),
    [agents, preferredAgentId]
  );
  const normalizedSearch = search.trim().toLowerCase();
  const filteredAgents = orderedAgents.filter((agent) => {
    if (!normalizedSearch) {
      return true;
    }

    return [agent.name, agent.title, agent.urlKey]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLowerCase().includes(normalizedSearch));
  });

  if (typeof document === "undefined" || !position) {
    return <></>;
  }

  return createPortal(
    <div
      className="micronaut-project-tab__merge-up-popover rounded-md border bg-popover text-popover-foreground shadow-md"
      ref={rootRef}
      role="dialog"
      aria-label="Choose merge-up agent"
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`
      }}
    >
      <input
        aria-label="Search assignees"
        autoFocus
        className="w-full px-2 py-1.5 text-xs bg-transparent outline-none border-b border-border mb-1 placeholder:text-muted-foreground/50"
        placeholder="Search assignees..."
        ref={inputRef}
        value={search}
        onChange={(event) => {
          setSearch(event.currentTarget.value);
        }}
      />
      <div className="max-h-48 overflow-y-auto overscroll-contain">
        {isLoadingState ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">Loading assignees...</p>
        ) : filteredAgents.length > 0 ? (
          filteredAgents.map((agent) => (
            <button
              aria-current={agent.id === preferredAgentId ? "true" : undefined}
              className={`flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50 text-left${agent.id === preferredAgentId ? " bg-accent" : ""}`}
              disabled={pendingAgentId !== null}
              key={agent.id}
              onClick={() => {
                onSelectAgent(agent.id);
              }}
              type="button"
            >
              <AgentIcon
                className="h-3 w-3 shrink-0 text-muted-foreground"
                icon={agent.icon}
              />
              <span className="truncate">{agent.name}</span>
            </button>
          ))
        ) : (
          <p className="px-2 py-2 text-xs text-muted-foreground">No assignees found.</p>
        )}
      </div>
    </div>,
    document.body
  );
}

function BranchRow({
  branch,
  defaultBranchName,
  disabled,
  isCreating,
  isMergeUpBusy,
  isMergeUpStateLoading,
  isMergeUpPickerOpen,
  mergeUpAgents,
  mergeUpIssue,
  mergeUpIssueHref,
  pendingAgentId,
  preferredAgentId,
  onCreateBranch,
  onCloseMergeUpPicker,
  onOpenSetDefaultPreview,
  onOpenMergeUpPicker,
  onSelectMergeUpAgent
}: BranchRowProps): ReactElement {
  const mergeUpButtonRef = useRef<HTMLButtonElement | null>(null);
  const displayName = branch.name ?? "Unavailable";
  const showCreateBranchButton = branch.exists === false && branch.role !== "default" && Boolean(branch.name);
  const visibleMergeUpIssue = isMergeUpIssueVisible(mergeUpIssue) ? mergeUpIssue : null;
  const showMergeUpButton = branch.canMergeUp && !visibleMergeUpIssue;
  const showSetDefaultButton = branch.canSetDefault;
  const statusPills = getBranchStatusPills(branch);
  const lastUpdated = getBranchLastUpdatedLabel(branch);
  const versionSummary = getBranchVersionSummary(branch);
  const isBranchLinkVisible = Boolean(branch.url) && branch.exists !== false;
  const compareLabel = defaultBranchName
    ? `Compare with ${defaultBranchName}`
    : "Compare with default";
  const nameTestId = branch.role === "default" ? "default-branch-value" : `branch-name-${branch.role}`;
  const createBranchTitle = branch.name
    ? `Create ${branch.name} from ${defaultBranchName ?? "the default branch"}`
    : "Create branch";
  const mergeUpPullRequestUrl =
    mergeUpIssue?.pullRequestUrl &&
    (visibleMergeUpIssue !== null || branch.canMergeUp)
      ? mergeUpIssue.pullRequestUrl
      : null;
  const mergeUpPullRequestLabel = getPullRequestLabel(mergeUpPullRequestUrl);

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

        <div className="micronaut-project-tab__branch-supporting">
          <span>{versionSummary.text}</span>
          {versionSummary.href && versionSummary.linkLabel ? (
            <a
              className="micronaut-project-tab__action-link"
              href={versionSummary.href}
              rel="noreferrer"
              target="_blank"
            >
              {versionSummary.linkLabel}
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
        {showMergeUpButton ? (
          <div className="micronaut-project-tab__merge-up-picker-anchor">
            <button
              aria-expanded={isMergeUpPickerOpen ? "true" : undefined}
              aria-haspopup="dialog"
              aria-label={
                branch.name ? `Choose an agent to merge into ${branch.name}` : "Choose merge-up agent"
              }
              className={getPluginActionClassName()}
              data-testid={`branch-merge-up-${branch.role}`}
              disabled={disabled || isMergeUpBusy}
              ref={mergeUpButtonRef}
              onClick={() => {
                if (isMergeUpPickerOpen) {
                  onCloseMergeUpPicker();
                  return;
                }

                onOpenMergeUpPicker(branch);
              }}
              title={
                branch.name && defaultBranchName
                  ? `Ask an agent to merge ${defaultBranchName} into ${branch.name}`
                  : "Choose merge-up agent"
              }
              type="button"
            >
              <ButtonContent
                busy={isMergeUpBusy}
                busyLabel="Creating..."
                icon={<SparkleIcon />}
                label="Merge up"
              />
            </button>
            {isMergeUpPickerOpen ? (
              <MergeUpAgentPopover
                anchorRect={mergeUpButtonRef.current?.getBoundingClientRect() ?? null}
                agents={mergeUpAgents}
                isLoadingState={isMergeUpStateLoading}
                onClose={onCloseMergeUpPicker}
                onSelectAgent={(agentId) => {
                  onSelectMergeUpAgent(branch, agentId);
                }}
                pendingAgentId={pendingAgentId}
                preferredAgentId={preferredAgentId}
              />
            ) : null}
          </div>
        ) : null}
        {visibleMergeUpIssue && mergeUpIssueHref ? (
          <a
            className="micronaut-project-tab__merge-up-issue-link"
            data-testid={`branch-merge-up-issue-${branch.role}`}
            href={mergeUpIssueHref}
            title={visibleMergeUpIssue.issueTitle}
            onClick={(event) => {
              if (shouldLetBrowserHandleClick(event)) {
                return;
              }

              event.preventDefault();
              if (typeof window !== "undefined") {
                window.location.assign(mergeUpIssueHref);
              }
            }}
          >
            <MergeUpIssueStatusIcon status={visibleMergeUpIssue.status} />
            <span className="micronaut-project-tab__merge-up-issue-label">
              {visibleMergeUpIssue.issueIdentifier}
            </span>
          </a>
        ) : null}
        {mergeUpPullRequestUrl ? (
          <a
            className="micronaut-project-tab__merge-up-pr-link"
            data-testid={`branch-merge-up-pr-${branch.role}`}
            href={mergeUpPullRequestUrl}
            rel="noreferrer"
            target="_blank"
            title={mergeUpPullRequestUrl}
          >
            {mergeUpPullRequestLabel}
          </a>
        ) : null}
        {showSetDefaultButton ? (
          <button
            aria-label={branch.name ? `Preview setting ${branch.name} as default` : "Preview set default"}
            className={getPluginActionClassName()}
            data-testid={`branch-set-default-${branch.role}`}
            disabled={disabled}
            onClick={() => {
              onOpenSetDefaultPreview(branch);
            }}
            title={branch.name ? `Preview setting ${branch.name} as the default branch` : "Preview set default"}
            type="button"
          >
            <ButtonContent icon={<FlagIcon />} label="Set default" />
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
  const themeMode = useMicronautThemeMode();

  return (
    <MicronautSurface themeMode={themeMode}>
      <section className="micronaut-project-tab__state">
        <p className="micronaut-project-tab__eyebrow">Micronaut</p>
        <p className="micronaut-project-tab__state-title">{title}</p>
        <p className="micronaut-project-tab__state-body">{body}</p>
      </section>
    </MicronautSurface>
  );
}

interface SetDefaultPreviewDialogProps {
  branch: MicronautProjectBranch;
  defaultBranchName: string | null;
  onClose: () => void;
}

function SetDefaultPreviewDialog({
  branch,
  defaultBranchName,
  onClose
}: SetDefaultPreviewDialogProps): ReactElement {
  const branchName = branch.name ?? "this branch";
  const sourceBranchName = defaultBranchName ?? "the current default branch";
  const syncSummary = getBranchSyncSummary(branch, defaultBranchName);
  const versionSummary = getBranchVersionSummary(branch);
  const plannedSteps =
    branch.versionStatus === "behind" && branch.projectVersion && branch.expectedProjectVersion
      ? [
          `Create a pull request that updates gradle.properties on ${branchName} from projectVersion=${branch.projectVersion} to projectVersion=${branch.expectedProjectVersion}.`,
          `After that pull request merges, run gh on the Paperclip host to make ${branchName} the repository default branch instead of ${sourceBranchName}.`
        ]
      : branch.versionStatus === "unexpected" &&
          branch.projectVersion &&
          branch.expectedProjectVersion
        ? [
            `Review gradle.properties on ${branchName} because projectVersion=${branch.projectVersion} differs from the expected ${branch.expectedProjectVersion}.`,
            `Once the branch state is validated, run gh on the Paperclip host to make ${branchName} the repository default branch instead of ${sourceBranchName}.`
          ]
        : [
            `Run gh on the Paperclip host to make ${branchName} the repository default branch instead of ${sourceBranchName}.`
          ];

  return (
    <div
      aria-modal="true"
      className="micronaut-project-tab__modal-backdrop"
      onClick={onClose}
      role="dialog"
    >
      <section
        className="micronaut-project-tab__modal"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <header className="micronaut-project-tab__modal-header">
          <p className="micronaut-project-tab__eyebrow">Preview</p>
          <h3 className="micronaut-project-tab__modal-title">
            Set {branchName} as the default branch
          </h3>
          <p className="micronaut-project-tab__modal-copy">
            This slice still keeps the default-branch switch as a preview so you can validate the
            exact GitHub and versioning steps before we wire the real `gh` flow.
          </p>
        </header>

        <div className="micronaut-project-tab__modal-body">
          <section className="micronaut-project-tab__modal-card">
            <h4 className="micronaut-project-tab__modal-card-title">Eligibility snapshot</h4>
            <p className="micronaut-project-tab__modal-copy">{syncSummary}</p>
            <p className="micronaut-project-tab__modal-copy">{versionSummary.text}</p>
          </section>

          <section className="micronaut-project-tab__modal-card">
            <h4 className="micronaut-project-tab__modal-card-title">Planned steps</h4>
            <ol className="micronaut-project-tab__modal-list">
              {plannedSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>
        </div>

        <div className="micronaut-project-tab__modal-actions">
          <button className={getPluginActionClassName()} onClick={onClose} type="button">
            Close preview
          </button>
        </div>
      </section>
    </div>
  );
}

interface MicronautProjectDetailTabBodyProps {
  companyId: string;
  companyPrefix: string | null;
  projectId: string;
}

function MicronautProjectDetailTabBody({
  companyId,
  companyPrefix,
  projectId
}: MicronautProjectDetailTabBodyProps): ReactElement | null {
  const themeMode = useMicronautThemeMode();
  const overviewSnapshotCacheKey = getOverviewSnapshotCacheKey(companyId, projectId);
  const { data, error, loading } = usePluginData<MicronautProjectOverview>(
    MICRONAUT_PROJECT_OVERVIEW_DATA_KEY,
    {
      companyId,
      projectId
    }
  );
  const {
    data: mergeUpData,
    loading: mergeUpLoading,
    refresh: refreshMergeUpState
  } = usePluginData<MicronautMergeUpState>(MICRONAUT_MERGE_UP_STATE_DATA_KEY, {
    companyId,
    projectId
  });
  const refreshOverview = usePluginAction(MICRONAUT_REFRESH_PROJECT_OVERVIEW_ACTION_KEY);
  const createBranch = usePluginAction(MICRONAUT_CREATE_BRANCH_ACTION_KEY);
  const startMergeUp = usePluginAction(MICRONAUT_START_MERGE_UP_ACTION_KEY);
  const toast = usePluginToast();
  const mergeUpStatusRef = useRef(new Map<string, MicronautMergeUpIssue["status"]>());
  const mergeUpHydratedRef = useRef(false);
  const mergeUpPullRequestLookupRef = useRef(new Set<string>());
  const [displayedOverview, setDisplayedOverview] = useState<MicronautProjectOverview | null>(
    () => OVERVIEW_SNAPSHOT_CACHE.get(overviewSnapshotCacheKey) ?? null
  );
  const [displayedMergeUpState, setDisplayedMergeUpState] = useState<MicronautMergeUpState | null>(
    null
  );
  const [isRefreshingOverview, setIsRefreshingOverview] = useState(false);
  const [pendingBranchRole, setPendingBranchRole] = useState<MicronautProjectBranch["role"] | null>(
    null
  );
  const [activeDialog, setActiveDialog] = useState<SetDefaultDialogState | null>(null);
  const [openMergeUpPickerBranchName, setOpenMergeUpPickerBranchName] = useState<string | null>(
    null
  );
  const [pendingMergeUpTargetBranch, setPendingMergeUpTargetBranch] = useState<string | null>(null);
  const [pendingMergeUpAgentId, setPendingMergeUpAgentId] = useState<string | null>(null);
  const activeSetDefaultDialog = activeDialog;
  const shouldPollMergeUpState =
    displayedMergeUpState?.issues.some((issue) => {
      if (!isMergeUpIssueClosed(issue)) {
        return true;
      }

      if (displayedOverview?.kind !== "ready") {
        return false;
      }

      return displayedOverview.branches.some(
        (branch) => branch.name === issue.targetBranch && branch.canMergeUp
      );
    }) ?? false;
  const isMergeUpStateLoading = mergeUpLoading && !displayedMergeUpState;

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

  useEffect(() => {
    if (!mergeUpData) {
      return;
    }

    setDisplayedMergeUpState((current) => mergeMergeUpState(current, mergeUpData));
  }, [mergeUpData]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!shouldPollMergeUpState) {
      return;
    }

    refreshMergeUpState();
    const intervalId = window.setInterval(() => {
      refreshMergeUpState();
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [refreshMergeUpState, shouldPollMergeUpState]);

  useEffect(() => {
    if (!displayedMergeUpState) {
      return;
    }

    const nextStatuses = new Map<string, MicronautMergeUpIssue["status"]>();
    for (const issue of displayedMergeUpState.issues) {
      nextStatuses.set(issue.issueId, issue.status);
    }

    if (!mergeUpHydratedRef.current) {
      mergeUpHydratedRef.current = true;
      mergeUpStatusRef.current = nextStatuses;
      return;
    }

    for (const issue of displayedMergeUpState.issues) {
      const previousStatus = mergeUpStatusRef.current.get(issue.issueId);
      if (!previousStatus || previousStatus === issue.status) {
        continue;
      }

      const issueHref = getMergeUpIssueHref(issue, companyPrefix, companyId);
      if (issue.status === "done") {
        toast({
          dedupeKey: `micronaut-merge-up-completed:${issue.issueId}`,
          title: `Merge up done for ${issue.targetBranch}`,
          body: `${issue.issueIdentifier} is marked done.`,
          tone: "success",
          action: issueHref
            ? {
                label: "Open issue",
                href: issueHref
              }
            : undefined
        });
      }

      if (issue.status === "blocked") {
        toast({
          dedupeKey: `micronaut-merge-up-blocked:${issue.issueId}`,
          title: `Merge up blocked for ${issue.targetBranch}`,
          body: `${issue.issueIdentifier} needs attention.`,
          tone: "error"
        });
      }

      if (issue.status === "cancelled") {
        toast({
          dedupeKey: `micronaut-merge-up-cancelled:${issue.issueId}`,
          title: `Merge up cancelled for ${issue.targetBranch}`,
          body: `${issue.issueIdentifier} was cancelled.`,
          tone: "info",
          action: issueHref
            ? {
                label: "Open issue",
                href: issueHref
              }
            : undefined
        });
      }
    }

    mergeUpStatusRef.current = nextStatuses;
  }, [companyId, companyPrefix, displayedMergeUpState, toast]);

  useEffect(() => {
    if (typeof window === "undefined" || !displayedMergeUpState?.issues.length) {
      return;
    }

    const issuesNeedingHydration = displayedMergeUpState.issues.filter((issue) => {
      if (issue.pullRequestUrl) {
        return false;
      }

      const issueRef = issue.issueIdentifier ?? issue.issueId;
      if (!issueRef) {
        return false;
      }

      const lookupKey = `${issue.issueId}:${issue.updatedAt}`;
      return !mergeUpPullRequestLookupRef.current.has(lookupKey);
    });

    if (issuesNeedingHydration.length === 0) {
      return;
    }

    let cancelled = false;

    for (const issue of issuesNeedingHydration) {
      const lookupKey = `${issue.issueId}:${issue.updatedAt}`;
      mergeUpPullRequestLookupRef.current.add(lookupKey);

      void fetchIssuePullRequestUrl(issue)
        .then((pullRequestUrl) => {
          if (cancelled || !pullRequestUrl) {
            return;
          }

          setDisplayedMergeUpState((current) => {
            if (!current) {
              return current;
            }

            let changed = false;
            const nextIssues = current.issues.map((candidate) => {
              if (candidate.issueId !== issue.issueId || candidate.pullRequestUrl) {
                return candidate;
              }

              changed = true;
              return {
                ...candidate,
                pullRequestUrl
              };
            });

            return changed
              ? {
                  ...current,
                  issues: nextIssues
                }
              : current;
          });
        })
        .catch(() => {
          // Leave the issue row without a PR chip when the comments endpoint cannot be read.
        });
    }

    return () => {
      cancelled = true;
    };
  }, [displayedMergeUpState]);

  function updateDisplayedMergeUpState(
    updater: (state: MicronautMergeUpState) => MicronautMergeUpState
  ): void {
    setDisplayedMergeUpState((current) => updater(current ?? createEmptyMergeUpState()));
  }

  function setPreferredMergeUpAgentSnapshot(agent: MicronautMergeUpAgentOption): void {
    updateDisplayedMergeUpState((current) => {
      const nextAgents = current.agents.some((candidate) => candidate.id === agent.id)
        ? current.agents
        : [...current.agents, agent].sort((left, right) =>
            left.name.localeCompare(right.name, "en", { sensitivity: "base" })
          );

      return {
        ...current,
        preferredAgentId: agent.id,
        preferredAgentName: agent.name,
        agents: nextAgents
      };
    });
  }

  function applyMergeUpIssueSnapshot(issue: MicronautMergeUpIssue): void {
    updateDisplayedMergeUpState((current) => ({
      ...current,
      preferredAgentId: issue.agentId,
      preferredAgentName: issue.agentName,
      issues: upsertMergeUpIssueList(current.issues, issue)
    }));
  }

  async function refreshDisplayedOverview(
    showErrorToast = true
  ): Promise<MicronautProjectOverview | null> {
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

  async function handleStartMergeUp(
    branch: MicronautProjectBranch,
    agentId?: string
  ): Promise<void> {
    const resolvedAgentId = agentId ?? displayedMergeUpState?.preferredAgentId ?? null;
    if (!branch.name || pendingMergeUpTargetBranch || !resolvedAgentId) {
      return;
    }

    setPendingMergeUpTargetBranch(branch.name);
    setPendingMergeUpAgentId(resolvedAgentId);
    setOpenMergeUpPickerBranchName(null);

    try {
      const result = (await startMergeUp({
        companyId,
        projectId,
        targetBranch: branch.name,
        agentId: resolvedAgentId
      })) as MicronautStartMergeUpResult;

      applyMergeUpIssueSnapshot(result.issue);
      const selectedAgent =
        displayedMergeUpState?.agents.find((candidate) => candidate.id === resolvedAgentId) ??
        null;
      if (selectedAgent) {
        setPreferredMergeUpAgentSnapshot(selectedAgent);
      }

      const issueHref = getMergeUpIssueHref(result.issue, companyPrefix, companyId);
      if (result.status === "created") {
        toast({
          dedupeKey: `micronaut-merge-up-created:${result.issue.issueId}`,
          title: `Merge-up issue created for ${result.issue.targetBranch}`,
          body: result.issue.agentName
            ? `${result.issue.issueIdentifier} is now assigned to ${result.issue.agentName}.`
            : `${result.issue.issueIdentifier} is now tracking this merge-up.`,
          tone: "info",
          action: issueHref
            ? {
                label: "Open issue",
                href: issueHref
              }
            : undefined
        });
      } else {
        toast({
          dedupeKey: `micronaut-merge-up-existing:${result.issue.issueId}`,
          title: `Merge-up issue already exists for ${result.issue.targetBranch}`,
          body: `${result.issue.issueIdentifier} is already open for this branch.`,
          tone: "info",
          action: issueHref
            ? {
                label: "Open issue",
                href: issueHref
              }
            : undefined
        });
      }
    } catch (actionError) {
      toast({
        title: branch.name ? `Could not create merge-up issue for ${branch.name}` : "Could not create merge-up issue",
        body: getErrorMessage(actionError, "The merge-up issue could not be created right now."),
        tone: "error"
      });
    } finally {
      setPendingMergeUpTargetBranch(null);
      setPendingMergeUpAgentId(null);
      refreshMergeUpState();
    }
  }

  function closeActiveDialog(): void {
    setActiveDialog(null);
  }

  function handleOpenMergeUpPicker(branch: MicronautProjectBranch): void {
    setOpenMergeUpPickerBranchName(branch.name ?? null);
  }

  function handleCloseMergeUpPicker(): void {
    setOpenMergeUpPickerBranchName(null);
  }

  function handleOpenSetDefaultPreview(branch: MicronautProjectBranch): void {
    setActiveDialog({
      kind: "setDefault",
      branch,
      defaultBranchName: displayedOverview?.kind === "ready" ? displayedOverview.defaultBranch : null
    });
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
  const actionsDisabled =
    pendingBranchRole !== null ||
    isRefreshingOverview ||
    pendingMergeUpAgentId !== null ||
    pendingMergeUpTargetBranch !== null;

  return (
    <MicronautSurface themeMode={themeMode}>
      <header className="micronaut-project-tab__header">
        <div className="micronaut-project-tab__header-main">
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
        {displayedOverview.branches.map((branch) => {
          const mergeUpIssue = getBranchMergeUpIssue(displayedMergeUpState, branch.name);

          return (
            <BranchRow
              branch={branch}
              defaultBranchName={displayedOverview.defaultBranch}
              disabled={actionsDisabled}
              isCreating={pendingBranchRole === branch.role}
              isMergeUpBusy={pendingMergeUpTargetBranch === branch.name}
              isMergeUpPickerOpen={openMergeUpPickerBranchName === branch.name}
              isMergeUpStateLoading={isMergeUpStateLoading}
              key={branch.role}
              mergeUpAgents={displayedMergeUpState?.agents ?? []}
              mergeUpIssue={mergeUpIssue}
              mergeUpIssueHref={getMergeUpIssueHref(mergeUpIssue, companyPrefix, companyId)}
              onCloseMergeUpPicker={handleCloseMergeUpPicker}
              onCreateBranch={handleCreateBranch}
              onOpenMergeUpPicker={handleOpenMergeUpPicker}
              onOpenSetDefaultPreview={handleOpenSetDefaultPreview}
              onSelectMergeUpAgent={(selectedBranch, agentId) => {
                void handleStartMergeUp(selectedBranch, agentId);
              }}
              pendingAgentId={pendingMergeUpAgentId}
              preferredAgentId={displayedMergeUpState?.preferredAgentId ?? null}
            />
          );
        })}
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

      {activeSetDefaultDialog ? (
        <SetDefaultPreviewDialog
          branch={activeSetDefaultDialog.branch}
          defaultBranchName={activeSetDefaultDialog.defaultBranchName}
          onClose={closeActiveDialog}
        />
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
      companyPrefix={context.companyPrefix}
      key={`${context.companyId}:${context.entityId}`}
      projectId={context.entityId}
    />
  );
}
