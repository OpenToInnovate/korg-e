import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { TreeNode } from './sessionTree';
import type { GranularAgentState } from '@/types';
import { fmtK } from '@/lib/formatting';
import { cn } from '@/lib/utils';
import { PROGRESS_BAR_TRANSITION } from '@/lib/progress-colors';
import { getStatusBadgeText, getStatusBadgeClasses } from './statusUtils';
import { ChevronRight, ChevronDown, EllipsisVertical, PenLine, Timer, CornerDownRight } from 'lucide-react';
import { SessionInfoPanel } from './SessionInfoPanel';
import CleatusBotAvatar from '@/components/CleatusBotAvatar';

// Pre-defined color configs to avoid object creation during render
const COLORS_CRITICAL = {
  bar: 'bg-red',
  glow: 'rgba(231, 76, 60, 0.3)',
  growGlow: 'rgba(231, 76, 60, 0.5)',
} as const;

const COLORS_WARNING = {
  bar: 'bg-orange',
  glow: 'rgba(232, 168, 56, 0.3)',
  growGlow: 'rgba(232, 168, 56, 0.5)',
} as const;

const COLORS_NORMAL = {
  bar: 'bg-green',
  glow: 'rgba(76, 175, 80, 0.3)',
  growGlow: 'rgba(76, 175, 80, 0.5)',
} as const;

// Grokbot/OpenBot-style avatars: stable generated identity per session
function SessionAvatar({ sessionKey, label, running }: { sessionKey: string; label: string; running: boolean }) {
  return (
    <CleatusBotAvatar
      name={sessionKey || label}
      size={30}
      state={running ? 'working' : 'idle'}
      className="shrink-0 rounded-[10px]"
    />
  );
}

function formatRowTime(session: { lastActivity?: string | number; updatedAt?: number }): string {
  const raw = session.lastActivity ?? session.updatedAt;
  const ms = typeof raw === 'string' ? Date.parse(raw) : raw;
  if (!ms || Number.isNaN(ms)) return '';
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

interface SessionNodeProps {
  node: TreeNode;
  isActive: boolean;
  isGrowing: boolean;
  running: boolean;
  displayTokens: number;
  label: string;
  isExpanded: boolean;
  hasChildren: boolean;
  isRootAgent: boolean;
  isSubagent: boolean;
  isCron: boolean;
  isCronRun: boolean;
  isUnread: boolean;
  isRenaming: boolean;
  renameValue: string;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  granularStatus?: GranularAgentState;
  onSelect: (key: string) => void;
  onToggleExpand: (key: string) => void;
  onDelete?: (key: string, label: string) => void;
  onStartRename?: (key: string, label: string) => void;
  onAbort?: (key: string) => void;
  onRenameChange: (value: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  /** Compact mode for mobile/topbar dropdown; uses kebab actions instead of hover actions. */
  compact?: boolean;
}

function arePropsEqual(prev: SessionNodeProps, next: SessionNodeProps): boolean {
  return (
    prev.node.key === next.node.key &&
    prev.node.session === next.node.session &&
    prev.node.depth === next.node.depth &&
    prev.isActive === next.isActive &&
    prev.isGrowing === next.isGrowing &&
    prev.running === next.running &&
    prev.displayTokens === next.displayTokens &&
    prev.label === next.label &&
    prev.isExpanded === next.isExpanded &&
    prev.hasChildren === next.hasChildren &&
    prev.isRootAgent === next.isRootAgent &&
    prev.isSubagent === next.isSubagent &&
    prev.isCron === next.isCron &&
    prev.isCronRun === next.isCronRun &&
    prev.isUnread === next.isUnread &&
    prev.isRenaming === next.isRenaming &&
    prev.renameValue === next.renameValue &&
    prev.granularStatus === next.granularStatus &&
    prev.compact === next.compact
  );
}

/** Single session node in the session tree with status badge and actions. */
export const SessionNode = memo(function SessionNode({
  node,
  isActive,
  isGrowing,
  running,
  displayTokens,
  label,
  isExpanded,
  hasChildren,
  isRootAgent,
  isSubagent,
  isCron,
  isCronRun,
  isUnread,
  isRenaming,
  renameValue,
  renameInputRef,
  granularStatus,
  onSelect,
  onToggleExpand,
  onDelete,
  onStartRename,
  onAbort,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  compact = false,
}: SessionNodeProps) {
  const { session, key: sessionKey, depth } = node;
  const max = session.contextTokens || 200000;
  const pct = Math.min(100, Math.round((displayTokens / max) * 100));
  const colors = pct >= 80 ? COLORS_CRITICAL : pct >= 50 ? COLORS_WARNING : COLORS_NORMAL;
  const boxShadow = isGrowing
    ? `0 0 6px ${colors.growGlow}`
    : `0 0 4px ${colors.glow}`;

  const handleSelect = useCallback(() => onSelect(sessionKey), [onSelect, sessionKey]);
  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleExpand(sessionKey);
  }, [onToggleExpand, sessionKey]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(sessionKey, label);
  }, [onDelete, sessionKey, label]);

  const handleRenameClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onStartRename?.(sessionKey, label);
  }, [onStartRename, sessionKey, label]);

  const handleAbortClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onAbort?.(sessionKey);
  }, [onAbort, sessionKey]);

  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  const canRenameDelete = isRootAgent || isSubagent || isCron || isCronRun;
  const hasAbortAction = Boolean(onAbort && running);
  const hasRenameAction = Boolean(canRenameDelete && onStartRename && !isRenaming);
  const hasDeleteAction = Boolean(canRenameDelete && onDelete);
  const hasActions = hasAbortAction || hasRenameAction || hasDeleteAction;

  useEffect(() => {
    if (!compact || !actionsOpen) return;

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (actionsRef.current?.contains(target)) return;
      setActionsOpen(false);
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [compact, actionsOpen]);

  const handleKebabToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setActionsOpen(prev => !prev);
  }, []);

  const handleAbortFromMenu = useCallback((e: React.MouseEvent) => {
    handleAbortClick(e);
    setActionsOpen(false);
  }, [handleAbortClick]);

  const handleRenameFromMenu = useCallback((e: React.MouseEvent) => {
    handleRenameClick(e);
    setActionsOpen(false);
  }, [handleRenameClick]);

  const handleDeleteFromMenu = useCallback((e: React.MouseEvent) => {
    handleDeleteClick(e);
    setActionsOpen(false);
  }, [handleDeleteClick]);

  // Compute badge text and classes from granular status or fall back to binary
  const badgeText = (isCron || isCronRun)
    ? (running ? 'RUNNING' : isCron ? 'CRON' : 'RUN')
    : granularStatus ? getStatusBadgeText(granularStatus) : (running ? 'WORKING' : 'IDLE');
  const badgeClasses = (isCron || isCronRun)
    ? (running ? 'bg-purple/20 text-purple' : 'bg-purple/10 text-purple/70')
    : granularStatus
      ? getStatusBadgeClasses(granularStatus)
      : (running ? 'bg-green/20 text-green' : 'bg-muted-foreground/20 text-muted-foreground');
  const rowTime = formatRowTime(node.session);
  const previewLine = node.session.model ? `${fmtK(displayTokens)} tok · ${node.session.model}` : `${fmtK(displayTokens)} tok`;

  // Indentation: 14px per depth level
  const indent = depth * 14;

  return (
    <div
      className={cn(
        'group relative w-full px-1.5 py-0.5 text-xs',
        isCronRun && !isActive && 'opacity-60'
      )}
    >
      {/* Tree connector: subtle left border for children */}
      {depth > 0 && (
        <div
          className="absolute top-0 bottom-0 border-l border-border/30"
          style={{ left: `${(depth - 1) * 14 + 10}px` }}
        />
      )}

      <button
        type="button"
        onClick={handleSelect}
        aria-current={isActive ? 'true' : undefined}
        className={cn(
          'relative flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-xl border-0 px-2 py-2 text-left transition-colors',
          isActive ? 'bg-secondary' : 'hover:bg-secondary/60',
          isUnread && !isActive && 'bg-secondary/40'
        )}
        style={{ paddingLeft: `${indent + 8}px` }}
      >
        {/* Collapse/expand chevron for nodes with children */}
        {hasChildren && (
          <span
            role="button"
            tabIndex={0}
            onClick={handleToggle}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggle(e as unknown as React.MouseEvent); } }}
            className="shrink-0 flex h-3 w-3 items-center justify-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground cursor-pointer"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
        )}

        <SessionAvatar sessionKey={sessionKey} label={label} running={running} />

        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* Label (or rename input) + time */}
          {isRenaming ? (
            <input
              ref={renameInputRef}
              type="text"
              value={renameValue}
              onChange={(e) => onRenameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onRenameCommit();
                if (e.key === 'Escape') onRenameCancel();
              }}
              onBlur={onRenameCommit}
              onClick={(e) => e.stopPropagation()}
              className="text-foreground text-[0.8125rem] font-semibold flex-1 min-w-0 bg-background border border-border/60 px-1 py-0 rounded focus:outline-none focus:border-primary"
            />
          ) : (
            <SessionInfoPanel session={node.session} running={running}>
              <span className="flex w-full items-baseline gap-2">
                <span className={cn(
                  "min-w-0 flex-1 truncate cursor-pointer text-[0.8125rem] font-semibold",
                  isCronRun ? "text-muted-foreground font-normal" : "text-foreground"
                )}>
                  {isCron && <Timer size={11} className="text-purple mr-1 inline shrink-0" aria-label="Cron job" />}
                  {isCronRun && <CornerDownRight size={10} className="text-purple/60 mr-1 inline shrink-0" aria-label="Cron run" />}
                  {label}
                </span>
                <span className="shrink-0 text-[0.6875rem] tabular-nums text-muted-foreground">
                  {rowTime}
                </span>
              </span>
            </SessionInfoPanel>
          )}

          {/* Status + usage preview line */}
          <span className="flex min-w-0 items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
            <span className={`shrink-0 rounded px-1 py-px text-[0.5625rem] font-bold uppercase tracking-wider ${badgeClasses}`}>
              {badgeText}
            </span>
            <span className="truncate">{previewLine}</span>
          </span>
        </span>

        {/* Unread indicator */}
        {isUnread && <span className="unread-dot shrink-0" aria-label="Unread" />}

        {/* Live progress sliver while running */}
        {running && (
          <span className="pointer-events-none absolute inset-x-2 bottom-0.5 h-0.5 overflow-hidden rounded-full bg-background/60">
            <span
              className={`block h-full ${colors.bar}`}
              style={{
                width: `${pct}%`,
                boxShadow,
                transition: PROGRESS_BAR_TRANSITION,
              }}
            />
          </span>
        )}
      </button>

      {compact ? (
        hasActions && (
          <div ref={actionsRef} className="flex items-center gap-0.5 shrink-0 pr-1">
            {actionsOpen && (
              <>
                {hasAbortAction && (
                  <button
                    type="button"
                    onClick={handleAbortFromMenu}
                    title="Abort session"
                    className="bg-card border border-border/60 text-muted-foreground hover:text-red hover:border-red/40 cursor-pointer text-[0.667rem] w-5 h-5 flex items-center justify-center"
                  >
                    ⏹
                  </button>
                )}
                {hasRenameAction && (
                  <button
                    type="button"
                    onClick={handleRenameFromMenu}
                    title="Rename session"
                    className="bg-card border border-border/60 text-muted-foreground hover:text-foreground hover:border-muted-foreground cursor-pointer text-[0.667rem] w-5 h-5 flex items-center justify-center"
                  >
                    <PenLine size={10} />
                  </button>
                )}
                {hasDeleteAction && (
                  <button
                    type="button"
                    onClick={handleDeleteFromMenu}
                    title="Delete session"
                    className="bg-card border border-border/60 text-muted-foreground hover:text-red hover:border-red/40 cursor-pointer text-[0.667rem] w-5 h-5 flex items-center justify-center"
                  >
                    ✕
                  </button>
                )}
              </>
            )}

            <button
              type="button"
              onClick={handleKebabToggle}
              title="Session actions"
              aria-label="Session actions"
              aria-expanded={actionsOpen}
              className="bg-transparent border border-border/60 text-muted-foreground hover:text-foreground hover:border-muted-foreground cursor-pointer text-[0.667rem] w-6 h-6 flex items-center justify-center"
            >
              <EllipsisVertical size={12} />
            </button>
          </div>
        )
      ) : (
        /* Hover actions — abort is available for all running sessions */
        <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity z-10">
          {hasAbortAction && (
            <button
              type="button"
              onClick={handleAbortClick}
              title="Abort session"
              className="bg-card/90 border border-border/60 text-muted-foreground hover:text-red hover:border-red/40 cursor-pointer text-[0.667rem] w-5 h-5 flex items-center justify-center"
            >
              ⏹
            </button>
          )}
          {canRenameDelete && (
            <>
              {hasRenameAction && (
                <button
                  type="button"
                  onClick={handleRenameClick}
                  title="Rename session"
                  className="bg-card/90 border border-border/60 text-muted-foreground hover:text-foreground hover:border-muted-foreground cursor-pointer text-[0.667rem] w-5 h-5 flex items-center justify-center"
                >
                  <PenLine size={10} />
                </button>
              )}
              {hasDeleteAction && (
                <button
                  type="button"
                  onClick={handleDeleteClick}
                  title="Delete session"
                  className="bg-card/90 border border-border/60 text-muted-foreground hover:text-red hover:border-red/40 cursor-pointer text-[0.667rem] w-5 h-5 flex items-center justify-center"
                >
                  ✕
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}, arePropsEqual);
