import { useState } from 'react';
import { ArrowLeft, ChevronUp, Cpu, Gauge, MoreVertical, PanelLeftClose, PanelLeftOpen, PanelRightOpen, RotateCcw, Trash2, Users } from 'lucide-react';
import KorgeAvatar from '@/components/KorgeAvatar';
import type { CorgiVariantId } from '@/components/corgi/corgiVariants';
import { InlineSelect } from '@/components/ui/InlineSelect';
import { useModelEffort } from './useModelEffort';

interface ChatHeaderProps {
  onReset?: () => void;
  onAbort: () => void;
  isGenerating: boolean;
  /** File explorer toggle button shown on smaller layouts. */
  onToggleFileBrowser?: () => void;
  /** Whether the file explorer is currently collapsed. */
  isFileBrowserCollapsed?: boolean;
  /** Agent display name shown in the header. */
  agentName?: string;
  /** Back to Home (phone only). */
  onBack?: () => void;
  /** Open the bot/routine details panel. */
  onOpenDetails?: () => void;
  /** Corgi variant for the current bot. */
  agentVariant?: CorgiVariantId;
  /** Collar color for the current bot. */
  agentCollar?: string;
  /** Delete the current bot (shown in the overflow menu). */
  onDelete?: () => void;
  /** Group subtitle (group chat): "Name · N bots". */
  subtitle?: string;
  /** Group member avatars. */
  groupMembers?: Array<{ id: string; name: string; variant?: CorgiVariantId; color?: string }>;
}

/**
 * Conversation header. On phones the model/effort/reset controls live behind
 * an overflow menu so Stop is never scrolled off-screen; on desktop they stay
 * inline. Replaces the old horizontally-scrolling cockpit header.
 */
export function ChatHeader({
  onReset,
  onAbort,
  isGenerating,
  onToggleFileBrowser,
  isFileBrowserCollapsed = true,
  agentName = 'Agent',
  onBack,
  onOpenDetails,
  onDelete,
  subtitle,
  groupMembers,
  agentVariant,
  agentCollar,
}: ChatHeaderProps) {
  const {
    modelOptions,
    effortOptions,
    selectedModel,
    selectedEffort,
    selectedEffortLabel,
    handleModelChange,
    handleEffortChange,
    controlsDisabled,
    uiError,
  } = useModelEffort();

  const [menuOpen, setMenuOpen] = useState(false);
  const modelSelectorDisabled = controlsDisabled || modelOptions.length === 0;
  const visibleModelOptions = modelOptions.length > 0
    ? modelOptions
    : [{ value: '', label: 'No configured models' }];

  return (
    <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5 sm:px-4">
      {/* Mobile: back to Home */}
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to all bots"
          className="tap flex shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground sm:hidden"
        >
          <ArrowLeft size={20} />
        </button>
      )}

      {/* Desktop: file explorer toggle */}
      {onToggleFileBrowser && (
        <button
          onClick={onToggleFileBrowser}
          className="shell-icon-button hidden size-10 shrink-0 px-0 sm:flex"
          title="Open file explorer (Ctrl+B)"
          aria-label="Open file explorer"
        >
          {isFileBrowserCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
      )}

      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <KorgeAvatar
          name={agentName}
          variant={agentVariant}
          collar={agentCollar}
          size={28}
          state={isGenerating ? 'working' : 'idle'}
          className="shrink-0"
        />
        {groupMembers && groupMembers.length > 0 && (
          <span className="hidden -space-x-1.5 sm:flex">
            {groupMembers.slice(0, 3).map((m) => (
              <KorgeAvatar key={m.id} name={m.id} variant={m.variant} collar={m.color} size={18} state="idle" />
            ))}
          </span>
        )}
        <span className="min-w-0 truncate text-base font-semibold text-foreground">{agentName}</span>
        {subtitle && (
          <span className="hidden min-w-0 items-center gap-1 text-2xs text-muted-foreground sm:flex">
            <Users size={11} className="shrink-0" />
            <span className="truncate">{subtitle}</span>
          </span>
        )}
        {isGenerating && (
          <span className="hidden shrink-0 items-center gap-1 rounded-full bg-green/15 px-2 py-0.5 text-2xs font-semibold text-green sm:inline-flex">
            Working
          </span>
        )}
      </div>

      {uiError && (
        <span className="hidden max-w-[220px] truncate text-2xs text-red md:inline" title={uiError} role="status" aria-live="polite">
          ⚠ {uiError}
        </span>
      )}

      {/* Stop is always visible while generating, on every viewport */}
      {isGenerating && (
        <button
          onClick={onAbort}
          aria-label="Stop generating"
          title="Stop generating"
          className="cockpit-toolbar-button min-h-11 shrink-0 px-3 sm:min-h-9"
          data-tone="danger"
        >
          <span aria-hidden="true">⏹</span>
          <span className="hidden sm:inline">Stop</span>
        </button>
      )}

      {/* Desktop inline controls */}
      <div className="hidden shrink-0 items-center gap-1 whitespace-nowrap sm:flex sm:gap-2">
        <div className="flex min-w-0 shrink-0 items-center gap-1">
          <Cpu size={12} className="shrink-0 text-foreground/70" aria-hidden="true" />
          <span className="text-xs text-muted-foreground">Model</span>
          <InlineSelect
            value={selectedModel}
            onChange={handleModelChange}
            ariaLabel="Model"
            disabled={modelSelectorDisabled}
            title={controlsDisabled ? 'Connect to gateway to change model' : uiError || undefined}
            triggerClassName="max-w-[180px] rounded-xl border-border/75 bg-background/65 px-2.5 py-1.5 text-xs font-sans text-foreground"
            menuClassName="min-w-[220px] rounded-2xl border-border/80 bg-card/98 p-1 shadow-[0_20px_50px_rgba(0,0,0,0.28)]"
            options={visibleModelOptions}
          />
        </div>
        <div className="flex min-w-0 shrink-0 items-center gap-1">
          <Gauge size={12} className="shrink-0 text-foreground/70" aria-hidden="true" />
          <span className="text-xs text-muted-foreground">Effort</span>
          <InlineSelect
            value={selectedEffort}
            onChange={handleEffortChange}
            ariaLabel="Effort"
            disabled={controlsDisabled}
            title={controlsDisabled ? 'Connect to gateway to change effort' : undefined}
            triggerClassName="rounded-xl border-border/75 bg-background/65 px-2.5 py-1.5 text-xs font-sans text-foreground"
            menuClassName="rounded-2xl border-border/80 bg-card/98 p-1 shadow-[0_20px_50px_rgba(0,0,0,0.28)]"
            displayLabel={selectedEffortLabel}
            options={effortOptions}
          />
        </div>
        {onOpenDetails && (
          <button onClick={onOpenDetails} aria-label="Open bot details" title="Details" className="shell-icon-button size-9 shrink-0 px-0">
            <PanelRightOpen size={16} />
          </button>
        )}
        {onReset && (
          <button
            onClick={() => onReset()}
            title="Reset session (start fresh)"
            aria-label="Reset session"
            className="cockpit-toolbar-button min-h-9 shrink-0 px-3"
            data-tone="danger"
          >
            <span aria-hidden="true">↺</span>
            <span className="hidden lg:inline">Reset</span>
          </button>
        )}
      </div>

      {/* Mobile overflow */}
      <div className="relative shrink-0 sm:hidden">
        <button
          type="button"
          aria-label="Conversation options"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className="tap flex items-center justify-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          {menuOpen ? <ChevronUp size={20} /> : <MoreVertical size={20} />}
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="glass-strong animate-menu-in absolute right-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-3xl p-1">
              <div className="px-3 py-2">
                <div className="mb-1 text-2xs font-semibold text-muted-foreground">Model</div>
                <InlineSelect
                  value={selectedModel}
                  onChange={handleModelChange}
                  ariaLabel="Model"
                  disabled={modelSelectorDisabled}
                  triggerClassName="w-full justify-between rounded-xl border-border/75 bg-background/65 px-3 py-2 text-sm font-sans text-foreground"
                  menuClassName="min-w-[220px] rounded-2xl border-border/80 bg-card/98 p-1 shadow-xl"
                  options={visibleModelOptions}
                />
              </div>
              <div className="px-3 pb-2">
                <div className="mb-1 text-2xs font-semibold text-muted-foreground">Effort</div>
                <InlineSelect
                  value={selectedEffort}
                  onChange={handleEffortChange}
                  ariaLabel="Effort"
                  disabled={controlsDisabled}
                  triggerClassName="w-full justify-between rounded-xl border-border/75 bg-background/65 px-3 py-2 text-sm font-sans text-foreground"
                  menuClassName="rounded-2xl border-border/80 bg-card/98 p-1 shadow-xl"
                  displayLabel={selectedEffortLabel}
                  options={effortOptions}
                />
              </div>
              <div className="border-t border-border/60 pt-1">
                {onOpenDetails && (
                  <MenuRow icon={<PanelRightOpen size={15} />} label="Bot details" onClick={() => { setMenuOpen(false); onOpenDetails(); }} />
                )}
                {onToggleFileBrowser && (
                  <MenuRow icon={<PanelLeftOpen size={15} />} label="Files" onClick={() => { setMenuOpen(false); onToggleFileBrowser(); }} />
                )}
                {onReset && (
                  <MenuRow icon={<RotateCcw size={15} />} label="Reset session" onClick={() => { setMenuOpen(false); onReset(); }} />
                )}
                {onDelete && (
                  <MenuRow icon={<Trash2 size={15} />} label="Delete bot" danger onClick={() => { setMenuOpen(false); onDelete(); }} />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MenuRow({ icon, label, danger, onClick }: { icon: React.ReactNode; label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-3 text-left text-sm hover:bg-secondary ${danger ? 'text-destructive' : 'text-foreground'}`}
    >
      {icon} {label}
    </button>
  );
}