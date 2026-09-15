/**
 * App.tsx - Main application layout component
 * 
 * This component focuses on layout and composition.
 * Connection management is handled by useConnectionManager.
 * Dashboard data fetching is handled by useDashboardData.
 */
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useReducer,
  lazy,
  Suspense,
} from 'react';
import { AlertTriangle, CheckCircle2, RotateCw } from 'lucide-react';
import { useGateway } from '@/contexts/GatewayContext';
import { useSessionContext, type SpawnSessionOpts } from '@/contexts/SessionContext';
import { useChat } from '@/contexts/ChatContext';
import { useSettings, type STTInputMode } from '@/contexts/SettingsContext';
import { getSessionKey } from '@/types';
import { useConnectionManager } from '@/hooks/useConnectionManager';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useGatewayRestart } from '@/hooks/useGatewayRestart';
import { ConnectDialog } from '@/features/connect/ConnectDialog';
import { MobileTabBar, type MobileDestination } from '@/components/MobileTabBar';
import { StatusBar } from '@/components/StatusBar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { WorkspaceSwitchDialog } from '@/components/WorkspaceSwitchDialog';
import { ChatPanel, type ChatPanelHandle } from '@/features/chat/ChatPanel';
import type { TTSProvider } from '@/features/tts/useTTS';
import type { ViewMode } from '@/features/command-palette/commands';
import { getContextLimit } from '@/lib/constants';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { createCommands } from '@/features/command-palette/commands';
import { PanelErrorBoundary } from '@/components/PanelErrorBoundary';
import { SpawnAgentDialog } from '@/features/sessions/SpawnAgentDialog';
import { DEFAULT_CHAT_PATH_LINKS_CONFIG, parseChatPathLinksConfig } from '@/features/chat/chatPathLinks';
import { FileTreePanel, TabbedContentArea, useOpenFiles, type FileTreeChangeEvent } from '@/features/file-browser';
import { useRoster } from '@/features/roster/useRoster';
import { isCorgiVariant } from '@/components/corgi/corgiVariants';
import { BotDialog, type BotFormValues } from '@/features/roster/BotDialog';
import { GroupWizard } from '@/features/roster/GroupWizard';
import { SectionDialog } from '@/features/roster/SectionDialog';
import type { RosterBot, RosterGroup, RosterSection } from '@/features/roster/types';
import { ActivityFeed } from '@/features/shell/ActivityFeed';
import { MessageSquare, LayoutGrid, PanelRightClose } from 'lucide-react';
import { useProposals } from '@/features/kanban/hooks/useProposals';
import { type BeadLinkTarget, type OpenBeadTab, buildBeadTabId } from '@/features/beads';
import { isImageFile } from '@/features/file-browser/utils/fileTypes';
import { buildAgentRootSessionKey, getSessionDisplayLabel } from '@/features/sessions/sessionKeys';
import { shouldGuardWorkspaceSwitch } from '@/features/workspace/workspaceSwitchGuard';
import { getWorkspaceAgentId, getWorkspaceRootSessionKey } from '@/features/workspace/workspaceScope';

// Lazy-loaded features (not needed in initial bundle)
const SettingsDrawer = lazy(() => import('@/features/settings/SettingsDrawer').then(m => ({ default: m.SettingsDrawer })));
const CommandPalette = lazy(() => import('@/features/command-palette/CommandPalette').then(m => ({ default: m.CommandPalette })));

// Lazy-loaded side panels
const RosterSidebar = lazy(() => import('@/features/roster/RosterSidebar').then(m => ({ default: m.RosterSidebar })));
const WorkspacePanel = lazy(() => import('@/features/workspace/WorkspacePanel').then(m => ({ default: m.WorkspacePanel })));

// Lazy-loaded view modes
const KanbanPanel = lazy(() => import('@/features/kanban/KanbanPanel').then(m => ({ default: m.KanbanPanel })));

interface AppProps {
  onLogout?: () => void;
}

interface PendingWorkspaceSwitch {
  targetLabel: string;
  execute: () => Promise<void>;
  resolve: (didSwitch: boolean) => void;
  reject: (error: unknown) => void;
}

function buildWorkspaceSwitchErrorMessage(result: {
  failedPath?: string;
  conflict?: boolean;
}): string {
  const fileLabel = result.failedPath || 'a dirty file';
  if (result.conflict) {
    return `${fileLabel} changed on disk. Resolve it before switching agents.`;
  }
  return `Could not save ${fileLabel}. Resolve it before switching agents.`;
}

function getInitialViewMode(canShowKanban: boolean): ViewMode {
  try {
    const saved = localStorage.getItem('nerve:viewMode');
    if (saved === 'kanban' && canShowKanban) return 'kanban';
  } catch {
    // ignore storage errors
  }

  return 'chat';
}

export default function App({ onLogout }: AppProps) {
  // Gateway state
  const {
    connectionState, connectError, reconnectAttempt, model, sparkline,
  } = useGateway();

  // Session state
  const {
    sessions, sessionsLoading, currentSession, setCurrentSession,
    busyState, agentStatus, unreadSessions, refreshSessions, spawnSession, deleteSession,
    agentName,
  } = useSessionContext();

  // Chat state
  const {
    messages, isGenerating, stream, processingStage,
    lastEventTimestamp, activityLog, currentToolDescription,
    handleSend, handleAbort, handleReset,
    loadMore, hasMore,
    showResetConfirm, confirmReset, cancelReset,
  } = useChat();

  // Settings state
  const {
    soundEnabled, toggleSound,
    ttsProvider, ttsModel, setTtsProvider, setTtsModel,
    sttProvider, setSttProvider, sttInputMode, setSttInputMode, sttModel, setSttModel,
    wakeWordEnabled, handleToggleWakeWord, handleWakeWordState,
    liveTranscriptionPreview, toggleLiveTranscriptionPreview,
    toggleEvents, toggleLog, toggleTelemetry,
    setTheme, setFont,
    kanbanVisible,
    commandPaletteButtonVisible,
  } = useSettings();

  // Connection management (extracted hook)
  const {
    dialogOpen,
    editableUrl, setEditableUrl,
    officialUrl,
    editableToken, setEditableToken,
    handleConnect, handleReconnect,
    serverSideAuth,
  } = useConnectionManager();

  // Track file change events for tree refresh. Sequence keeps repeated same-path updates visible.
  const [lastChangedEvent, setLastChangedEvent] = useState<FileTreeChangeEvent | null>(null);
  const [revealRequest, setRevealRequest] = useState<{
    id: number;
    path: string;
    kind: 'file' | 'directory';
    agentId: string;
  } | null>(null);
  const fileTreeChangeSequenceRef = useRef(0);

  const initialCompactLayout = typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches;
  const initialDesktopFileBrowserCollapsed = (() => {
    try {
      const saved = localStorage.getItem('nerve-file-tree-collapsed');
      if (saved !== null) return saved === 'true';
    } catch {
      // ignore storage errors and fall back to desktop default
    }

    return true;
  })();

  // File browser collapse state for mobile optimization
  const [fileBrowserCollapsed, setFileBrowserCollapsedState] = useState(() => (
    initialCompactLayout ? true : initialDesktopFileBrowserCollapsed
  ));
  const [desktopFileBrowserCollapsed, setDesktopFileBrowserCollapsed] = useState(initialDesktopFileBrowserCollapsed);

  // Responsive layout state (chat-first on smaller viewports)
  const [isCompactLayout, setIsCompactLayout] = useState(initialCompactLayout);

  const persistDesktopFileBrowserCollapsed = useCallback((collapsed: boolean) => {
    setDesktopFileBrowserCollapsed(collapsed);

    try {
      localStorage.setItem('nerve-file-tree-collapsed', String(collapsed));
    } catch {
      // ignore storage errors
    }
  }, []);

  const setFileBrowserCollapsed = useCallback((nextCollapsed: boolean | ((prev: boolean) => boolean)) => {
    setFileBrowserCollapsedState(prevCollapsed => {
      const resolvedCollapsed = typeof nextCollapsed === 'function'
        ? nextCollapsed(prevCollapsed)
        : nextCollapsed;

      if (!isCompactLayout) {
        persistDesktopFileBrowserCollapsed(resolvedCollapsed);
      }

      return resolvedCollapsed;
    });
  }, [isCompactLayout, persistDesktopFileBrowserCollapsed]);

  /** Toggle file browser collapse state (mobile). */
  const handleToggleFileBrowser = useCallback(() => {
    setFileBrowserCollapsed(prev => !prev);
  }, [setFileBrowserCollapsed]);

  const workspaceAgentId = useMemo(() => getWorkspaceAgentId(currentSession), [currentSession]);

  // File browser state
  const {
    openFiles, activeTab, setActiveTab,
    openFile, closeFile, updateContent, saveFile, reloadFile,
    handleFileChanged, remapOpenPaths, closeOpenPathsByPrefix,
    hasDirtyFiles, saveAllDirtyFiles, discardAllDirtyFiles,
  } = useOpenFiles(workspaceAgentId);

  // Save with workspace-scoped conflict toast
  const [saveToast, setSaveToast] = useState<{
    agentId: string;
    path: string;
    type: 'conflict';
    workspaceVersion: number;
  } | null>(null);
  const [workspaceVersion, bumpWorkspaceVersion] = useReducer((version: number) => version + 1, 0);
  const saveToastTimerRef = useRef<number | null>(null);
  const workspaceAgentIdRef = useRef(workspaceAgentId);
  const [pendingWorkspaceSwitch, setPendingWorkspaceSwitch] = useState<PendingWorkspaceSwitch | null>(null);
  const [workspaceSwitchAction, setWorkspaceSwitchAction] = useState<'save' | 'discard' | null>(null);
  const [workspaceSwitchError, setWorkspaceSwitchError] = useState<string | null>(null);

  const clearSaveToastTimer = useCallback(() => {
    if (saveToastTimerRef.current !== null) {
      window.clearTimeout(saveToastTimerRef.current);
      saveToastTimerRef.current = null;
    }
  }, []);

  const dismissSaveToast = useCallback(() => {
    clearSaveToastTimer();
    setSaveToast(null);
  }, [clearSaveToastTimer]);

  const showSaveToastForAgent = useCallback((
    targetAgentId: string,
    nextToast: { path: string; type: 'conflict' },
  ) => {
    if (workspaceAgentIdRef.current !== targetAgentId) return;

    clearSaveToastTimer();
    const toastForAgent = {
      ...nextToast,
      agentId: targetAgentId,
      workspaceVersion,
    };
    setSaveToast(toastForAgent);
    saveToastTimerRef.current = window.setTimeout(() => {
      setSaveToast((currentToast) => (currentToast === toastForAgent ? null : currentToast));
      saveToastTimerRef.current = null;
    }, 5000);
  }, [clearSaveToastTimer, workspaceVersion]);

  useEffect(() => {
    workspaceAgentIdRef.current = workspaceAgentId;
    bumpWorkspaceVersion();
    clearSaveToastTimer();
  }, [clearSaveToastTimer, workspaceAgentId]);

  useEffect(() => () => clearSaveToastTimer(), [clearSaveToastTimer]);

  const handleSaveFile = useCallback(async (filePath: string) => {
    const requestAgentId = workspaceAgentId;
    const result = await saveFile(filePath);

    if (workspaceAgentIdRef.current !== requestAgentId) {
      return;
    }

    if (!result.ok) {
      if (result.conflict) {
        showSaveToastForAgent(requestAgentId, { path: filePath, type: 'conflict' });
      }
      return;
    }

    dismissSaveToast();
  }, [dismissSaveToast, saveFile, showSaveToastForAgent, workspaceAgentId]);

  // Single file.changed handler, feeds both open files and tree refresh.
  const onFileChanged = useCallback((path: string, targetAgentId: string) => {
    handleFileChanged(path, targetAgentId);
    setLastChangedEvent({
      path,
      agentId: targetAgentId,
      sequence: ++fileTreeChangeSequenceRef.current,
    });
  }, [handleFileChanged]);

  // Dashboard data (extracted hook) — single SSE connection handles all events
  const { memories, memoriesLoading, remoteWorkspace, refreshMemories } = useDashboardData({
    agentId: workspaceAgentId,
    onFileChanged,
  });

  // Korg-e roster (bot profiles + group chats)
  const roster = useRoster();
  // Pending approvals badge for the phone tab bar.
  const { pendingCount: pendingApprovalCount } = useProposals();

  // Bot profile linked to the open conversation (drives its corgi + collar).
  const currentBot = useMemo(
    () => roster.roster.bots.find((b) => b.agentId && b.agentId === currentSession) ?? null,
    [roster.roster.bots, currentSession],
  );

  // Group chat = the Alpha bot's session. Resolving it here keeps group
  // context (title, members) separate from direct chats.
  const currentGroup = useMemo(() => {
    for (const g of roster.roster.groups) {
      if (!g.alphaBotId) continue;
      const alpha = roster.roster.bots.find((b) => b.id === g.alphaBotId);
      if (alpha?.agentId && alpha.agentId === currentSession) {
        const members = g.memberBotIds
          .map((id) => roster.roster.bots.find((b) => b.id === id))
          .filter((b): b is NonNullable<typeof b> => Boolean(b));
        return { group: g, alpha, members };
      }
    }
    return null;
  }, [roster.roster.groups, roster.roster.bots, currentSession]);

  // Delete the open bot: remove its session, then the profile (routines too).
  const [deleteBotConfirm, setDeleteBotConfirm] = useState(false);
  const handleDeleteCurrentBot = useCallback(async () => {
    setDeleteBotConfirm(false);
    if (!currentBot) return;
    try {
      await deleteSession(currentSession);
    } catch { /* session may already be gone */ }
    await roster.deleteBot(currentBot.id, true).catch(() => undefined);
    setMobileView('home');
  }, [currentBot, currentSession, deleteSession, roster]);

  // Mobile navigation (compact layout only): home | activity, or an open chat.
  const [mobileView, setMobileView] = useState<MobileDestination | 'chat'>('home');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [botDialog, setBotDialog] = useState<{ open: boolean; bot?: RosterBot }>({ open: false });
  const [groupDialog, setGroupDialog] = useState<{ open: boolean; group?: RosterGroup }>({ open: false });
  const [sectionDialog, setSectionDialog] = useState<{ open: boolean; section?: RosterSection }>({ open: false });

  // UI state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [booted, setBooted] = useState(false);
  const chatPanelRef = useRef<ChatPanelHandle>(null);

  // Gateway restart
  const {
    showGatewayRestartConfirm,
    gatewayRestarting,
    gatewayRestartNotice,
    handleGatewayRestart,
    cancelGatewayRestart,
    confirmGatewayRestart,
    dismissNotice,
  } = useGatewayRestart();

  // Command palette state
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [spawnDialogOpen, setSpawnDialogOpen] = useState(false);

  // View mode state (chat | kanban), persisted to localStorage
  const [viewMode, setViewModeRaw] = useState<ViewMode>(() => getInitialViewMode(kanbanVisible));
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [openBeads, setOpenBeads] = useState<OpenBeadTab[]>([]);
  const setViewMode = useCallback((mode: ViewMode) => {
    const nextMode = mode === 'kanban' && !kanbanVisible ? 'chat' : mode;
    setViewModeRaw(nextMode);

    if (nextMode === 'kanban' && isCompactLayout) {
      setFileBrowserCollapsed(true);
    }

    try { localStorage.setItem('nerve:viewMode', nextMode); } catch { /* ignore */ }
  }, [isCompactLayout, kanbanVisible, setFileBrowserCollapsed]);
  const openTaskInBoard = useCallback((taskId: string) => {
    setPendingTaskId(taskId);
    setViewMode('kanban');
  }, [setViewMode]);
  /** Turn a completed task into a reusable skill: ask the bot in chat. */
  const handleSaveTaskAsSkill = useCallback((task: { title: string; description?: string }) => {
    setViewMode('chat');
    const prompt = `Save the process we just used as a skill called "${task.title}". Include when to use it, required inputs and access, the sequence of work, how to validate the result, what to return, and what requires approval.${task.description ? ` Task context: ${task.description.slice(0, 500)}` : ''}`;
    // ChatPanel stays mounted when switching views — inject on next tick.
    setTimeout(() => chatPanelRef.current?.injectText(prompt, 'replace'), 60);
  }, [setViewMode]);
  const [chatPathLinkPrefixes, setChatPathLinkPrefixes] = useState<string[]>(
    DEFAULT_CHAT_PATH_LINKS_CONFIG.prefixes,
  );
  const [chatPathLinkAliases, setChatPathLinkAliases] = useState<Record<string, string>>(
    DEFAULT_CHAT_PATH_LINKS_CONFIG.aliases,
  );
  const [addToChatEnabled, setAddToChatEnabled] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams({ agentId: workspaceAgentId });
    const controller = new AbortController();

    void fetch(`/api/workspace/chatPathLinks?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        if (res.status === 404) {
          setChatPathLinkPrefixes(DEFAULT_CHAT_PATH_LINKS_CONFIG.prefixes);
          setChatPathLinkAliases(DEFAULT_CHAT_PATH_LINKS_CONFIG.aliases);
          return;
        }
        const data = await res.json() as { ok: boolean; content?: string };
        if (!data.ok || !data.content) {
          setChatPathLinkPrefixes(DEFAULT_CHAT_PATH_LINKS_CONFIG.prefixes);
          setChatPathLinkAliases(DEFAULT_CHAT_PATH_LINKS_CONFIG.aliases);
          return;
        }
        const parsed = parseChatPathLinksConfig(data.content);
        setChatPathLinkPrefixes(parsed.prefixes);
        setChatPathLinkAliases(parsed.aliases);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setChatPathLinkPrefixes(DEFAULT_CHAT_PATH_LINKS_CONFIG.prefixes);
          setChatPathLinkAliases(DEFAULT_CHAT_PATH_LINKS_CONFIG.aliases);
        }
      });

    return () => controller.abort();
  }, [workspaceAgentId]);

  useEffect(() => {
    const controller = new AbortController();
    let retryTimer: number | null = null;
    let attempts = 0;
    const maxAttempts = 3;

    const loadUploadConfig = () => {
      attempts += 1;

      void fetch('/api/upload-config', { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (controller.signal.aborted) return;

          if (data) {
            setAddToChatEnabled(Boolean(data.fileReferenceEnabled));
            return;
          }

          if (attempts >= maxAttempts) {
            setAddToChatEnabled(false);
            return;
          }

          retryTimer = window.setTimeout(loadUploadConfig, 1000);
        })
        .catch(() => {
          if (controller.signal.aborted) return;

          if (attempts >= maxAttempts) {
            setAddToChatEnabled(false);
            return;
          }

          retryTimer = window.setTimeout(loadUploadConfig, 1000);
        });
    };

    loadUploadConfig();

    return () => {
      controller.abort();
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, []);

  useEffect(() => {
    if (kanbanVisible || viewMode !== 'kanban') return;
    setViewMode('chat');
  }, [kanbanVisible, setViewMode, viewMode]);

  const openBeadId = useCallback((target: BeadLinkTarget) => {
    const normalizedBeadId = target.beadId.trim();
    if (!normalizedBeadId) return;

    const normalizedTarget: BeadLinkTarget = {
      beadId: normalizedBeadId,
      explicitTargetPath: target.explicitTargetPath?.trim() || undefined,
      currentDocumentPath: target.currentDocumentPath?.trim() || undefined,
      workspaceAgentId: target.workspaceAgentId?.trim() || workspaceAgentId,
    };

    const tabId = buildBeadTabId(normalizedTarget);
    setOpenBeads((prev) => {
      if (prev.some((bead) => bead.id === tabId)) return prev;
      return [...prev, {
        id: tabId,
        beadId: normalizedBeadId,
        name: normalizedBeadId,
        explicitTargetPath: normalizedTarget.explicitTargetPath,
        currentDocumentPath: normalizedTarget.currentDocumentPath,
        workspaceAgentId: normalizedTarget.workspaceAgentId,
      }];
    });
    setActiveTab(tabId);
  }, [setActiveTab, workspaceAgentId]);

  const visibleOpenBeads = useMemo(() => openBeads.filter((bead) => {
    const beadWorkspaceAgentId = bead.workspaceAgentId?.trim() || workspaceAgentId;
    return beadWorkspaceAgentId === workspaceAgentId;
  }), [openBeads, workspaceAgentId]);

  useEffect(() => {
    if (!activeTab.startsWith('bead:')) return;
    if (visibleOpenBeads.some((bead) => bead.id === activeTab)) return;
    setActiveTab('chat');
  }, [activeTab, setActiveTab, visibleOpenBeads]);

  const closeWorkspaceTab = useCallback((tabId: string) => {
    if (tabId.startsWith('bead:')) {
      setOpenBeads((prev) => prev.filter((bead) => bead.id !== tabId));
      if (activeTab === tabId) {
        setActiveTab('chat');
      }
      return;
    }

    closeFile(tabId);
  }, [activeTab, closeFile, setActiveTab]);

  const openWorkspacePath = useCallback(async (targetPath: string, basePath?: string) => {
    const params = new URLSearchParams({ path: targetPath, agentId: workspaceAgentId });
    if (basePath) {
      params.set('relativeTo', basePath);
    }
    const res = await fetch(`/api/files/resolve?${params.toString()}`);
    const data = await res.json().catch(() => null) as {
      ok?: boolean;
      path?: string;
      type?: 'file' | 'directory';
      binary?: boolean;
    } | null;

    if (!res.ok || !data?.ok || !data.path || !data.type) return;

    setFileBrowserCollapsed(false);
    setRevealRequest({ id: Date.now(), path: data.path, kind: data.type, agentId: workspaceAgentId });

    if (data.type === 'file' && (!data.binary || isImageFile(data.path))) {
      await openFile(data.path);
    }
  }, [openFile, setFileBrowserCollapsed, workspaceAgentId]);

  // Build command list with stable references
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  const openSpawnDialog = useCallback(() => setSpawnDialogOpen(true), []);

  // Keyboard shortcut handlers with useCallback
  const handleOpenPalette = useCallback(() => setPaletteOpen(true), []);
  const handleCtrlC = useCallback(() => {
    if (isGenerating) {
      handleAbort();
    }
  }, [isGenerating, handleAbort]);
  const toggleSearch = useCallback(() => setSearchOpen(prev => !prev), []);
  const handleEscape = useCallback(() => {
    if (paletteOpen) {
      setPaletteOpen(false);
    } else if (searchOpen) {
      setSearchOpen(false);
    } else if (isGenerating) {
      handleAbort();
    }
  }, [paletteOpen, searchOpen, isGenerating, handleAbort]);

  // Global keyboard shortcuts
  useKeyboardShortcuts([
    { key: 'k', meta: true, handler: handleOpenPalette },
    { key: 'b', meta: true, handler: handleToggleFileBrowser },  // Cmd+B → toggle file browser
    { key: 'f', meta: true, handler: toggleSearch, skipInEditor: true },  // Cmd+F → chat search (yields to CodeMirror search in editor)
    { key: 'c', ctrl: true, handler: handleCtrlC, preventDefault: false },  // Ctrl+C → abort (when generating), allow copy to still work
    { key: 'Escape', handler: handleEscape, skipInEditor: true },
  ]);

  // Get current session's context usage for StatusBar
  const currentSessionData = useMemo(() => {
    return sessions.find(s => getSessionKey(s) === currentSession);
  }, [sessions, currentSession]);

  // Get display name for current session (agent name for main, label for subagents)
  const currentSessionDisplayName = useMemo(() => {
    if (currentSessionData) return getSessionDisplayLabel(currentSessionData, agentName);
    return agentName;
  }, [currentSessionData, agentName]);

  const contextTokens = currentSessionData?.totalTokens ?? 0;
  const contextLimit = currentSessionData?.contextTokens || getContextLimit(model);

  const getWorkspaceSwitchLabel = useCallback((sessionKey: string) => {
    const targetSession = sessions.find((session) => getSessionKey(session) === sessionKey);
    if (targetSession) {
      return getSessionDisplayLabel(targetSession, agentName);
    }

    const targetAgentId = getWorkspaceAgentId(sessionKey);
    return targetAgentId === 'main' ? `${agentName} (main)` : `Agent ${targetAgentId}`;
  }, [agentName, sessions]);

  const requestWorkspaceTransition = useCallback((
    targetSessionKey: string,
    targetLabel: string,
    execute: () => Promise<void>,
  ) => {
    if (!shouldGuardWorkspaceSwitch(currentSession, targetSessionKey, hasDirtyFiles)) {
      return execute().then(() => true);
    }

    setWorkspaceSwitchAction(null);
    setWorkspaceSwitchError(null);

    return new Promise<boolean>((resolve, reject) => {
      setPendingWorkspaceSwitch({
        targetLabel,
        execute,
        resolve,
        reject,
      });
    });
  }, [currentSession, hasDirtyFiles]);

  const handleCancelWorkspaceSwitch = useCallback(() => {
    if (workspaceSwitchAction || !pendingWorkspaceSwitch) return;

    pendingWorkspaceSwitch.resolve(false);
    setPendingWorkspaceSwitch(null);
    setWorkspaceSwitchAction(null);
    setWorkspaceSwitchError(null);
  }, [pendingWorkspaceSwitch, workspaceSwitchAction]);

  const handleSaveAndSwitch = useCallback(async () => {
    if (!pendingWorkspaceSwitch || workspaceSwitchAction) return;

    const pendingSwitch = pendingWorkspaceSwitch;
    setWorkspaceSwitchAction('save');
    setWorkspaceSwitchError(null);

    const result = await saveAllDirtyFiles();
    if (!result.ok) {
      setWorkspaceSwitchAction(null);
      setWorkspaceSwitchError(buildWorkspaceSwitchErrorMessage(result));
      return;
    }

    try {
      await pendingSwitch.execute();
      pendingSwitch.resolve(true);
      setPendingWorkspaceSwitch(null);
      setWorkspaceSwitchError(null);
    } catch (error) {
      pendingSwitch.reject(error);
      setPendingWorkspaceSwitch(null);
      setWorkspaceSwitchError(null);
    } finally {
      setWorkspaceSwitchAction(null);
    }
  }, [pendingWorkspaceSwitch, saveAllDirtyFiles, workspaceSwitchAction]);

  const handleDiscardAndSwitch = useCallback(async () => {
    if (!pendingWorkspaceSwitch || workspaceSwitchAction) return;

    const pendingSwitch = pendingWorkspaceSwitch;
    setWorkspaceSwitchAction('discard');
    setWorkspaceSwitchError(null);
    discardAllDirtyFiles();

    try {
      await pendingSwitch.execute();
      pendingSwitch.resolve(true);
      setPendingWorkspaceSwitch(null);
      setWorkspaceSwitchError(null);
    } catch (error) {
      pendingSwitch.reject(error);
      setPendingWorkspaceSwitch(null);
      setWorkspaceSwitchError(null);
    } finally {
      setWorkspaceSwitchAction(null);
    }
  }, [discardAllDirtyFiles, pendingWorkspaceSwitch, workspaceSwitchAction]);

  const handleSessionChange = useCallback((key: string) => {
    void requestWorkspaceTransition(key, getWorkspaceSwitchLabel(key), async () => {
      setCurrentSession(key);
    });
  }, [getWorkspaceSwitchLabel, requestWorkspaceTransition, setCurrentSession]);

  const handleSpawnSession = useCallback((opts: SpawnSessionOpts) => {
    const targetSessionKey = opts.kind === 'root'
      ? buildAgentRootSessionKey(opts.agentName?.trim() || 'agent', sessions.map(getSessionKey))
      : opts.parentSessionKey?.trim() || getWorkspaceRootSessionKey(currentSession) || currentSession;
    const targetLabel = opts.kind === 'root'
      ? opts.agentName?.trim() || 'New agent'
      : getWorkspaceSwitchLabel(targetSessionKey);

    return requestWorkspaceTransition(targetSessionKey, targetLabel, async () => {
      await spawnSession(opts);
    });
  }, [currentSession, getWorkspaceSwitchLabel, requestWorkspaceTransition, sessions, spawnSession]);

  // Create/edit bot profiles from the new-item flow. Creating a bot spins up a
  // live session and links it back to the profile.
  // Create a bot profile and (unless adopting an existing agent) spin up a session.
  const createBotFromValues = useCallback(async (values: BotFormValues): Promise<RosterBot> => {
    const { agentId, enabledSkills, ...profile } = values;
    if (agentId) {
      return roster.createBot({ ...profile, agentId, enabledSkills });
    }
    const bot = await roster.createBot({ ...profile, enabledSkills });
    const task = values.description
      ? `You are ${values.name}. ${values.description} Introduce yourself briefly and ask what to work on first.`
      : `You are ${values.name}, a helpful teammate. Introduce yourself briefly and ask what to work on first.`;
    try {
      const key = buildAgentRootSessionKey(values.name, sessions.map(getSessionKey));
      await handleSpawnSession({ kind: 'root', task, agentName: values.name });
      await roster.updateBot(bot.id, { agentId: key }).catch(() => undefined);
      if (isCompactLayout) setMobileView('chat');
    } catch {
      // Profile is saved even when the spawn fails; the user can retry from the row.
    }
    return bot;
  }, [roster, sessions, handleSpawnSession, isCompactLayout]);

  const handleBotDialogSave = useCallback(async (values: BotFormValues) => {
    if (botDialog.bot) {
      const { agentId: _a, enabledSkills: _s, ...profile } = values;
      void _a; void _s;
      await roster.updateBot(botDialog.bot.id, profile);
      setBotDialog({ open: false });
      return;
    }
    await createBotFromValues(values);
    setBotDialog({ open: false });
  }, [botDialog.bot, roster, createBotFromValues]);

  // Command palette entries (roster bots/groups need handleSessionChange).
  const rosterCommands = useMemo(() => ({
    onSelectSession: handleSessionChange,
    botEntries: roster.roster.bots
      .filter((b) => b.agentId)
      .map((b) => ({ id: b.id, label: b.name, detail: b.title || 'Bot', sessionKey: b.agentId! })),
    groupEntries: roster.roster.groups.map((g) => {
      const firstLinked = g.memberBotIds
        .map((id) => roster.roster.bots.find((b) => b.id === id))
        .find((b) => b?.agentId);
      return {
        id: g.id,
        label: g.name,
        detail: `Group · ${g.memberBotIds.length} bots`,
        sessionKey: firstLinked?.agentId ?? undefined,
      };
    }),
  }), [handleSessionChange, roster.roster.bots, roster.roster.groups]);

  const commands = useMemo(() => createCommands({
    onNewSession: openSpawnDialog,
    onResetSession: handleReset,
    onToggleSound: toggleSound,
    onSettings: openSettings,
    onSearch: openSearch,
    onAbort: handleAbort,
    onSetTheme: setTheme,
    onSetFont: setFont,
    onTtsProviderChange: setTtsProvider,
    onToggleWakeWord: handleToggleWakeWord,
    onToggleEvents: toggleEvents,
    onToggleLog: toggleLog,
    onToggleTelemetry: toggleTelemetry,
    onOpenSettings: openSettings,
    onRefreshSessions: refreshSessions,
    onRefreshMemory: refreshMemories,
    onSetViewMode: setViewMode,
    canShowKanban: kanbanVisible,
    ...rosterCommands,
  }), [openSpawnDialog, handleReset, toggleSound, handleAbort, openSettings, openSearch,
    setTheme, setFont, setTtsProvider, handleToggleWakeWord, toggleEvents, toggleLog, toggleTelemetry,
    refreshSessions, refreshMemories, setViewMode, kanbanVisible, rosterCommands]);

  // Boot sequence: fade in panels when connected
  useEffect(() => {
    if (connectionState === 'connected' && !booted) {
      const timer = setTimeout(() => setBooted(true), 50);
      return () => clearTimeout(timer);
    }
  }, [connectionState, booted]);

  // Unread badge in the tab title (sidebar + dock attention parity).
  const unreadCount = useMemo(
    () => Object.values(unreadSessions ?? {}).filter(Boolean).length,
    [unreadSessions],
  );
  useEffect(() => {
    document.title = unreadCount > 0 ? `(${unreadCount}) Korg-e Bot` : 'Korg-e Bot';
  }, [unreadCount]);


  const handleCompactLayoutChange = useCallback((nextIsCompactLayout: boolean) => {
    setIsCompactLayout(nextIsCompactLayout);
    if (!nextIsCompactLayout) {
      setMobileView('home');
    }
    setFileBrowserCollapsedState(prevCollapsed => {
      if (nextIsCompactLayout) {
        persistDesktopFileBrowserCollapsed(prevCollapsed);
        return true;
      }

      return desktopFileBrowserCollapsed;
    });
  }, [desktopFileBrowserCollapsed, persistDesktopFileBrowserCollapsed]);

  // Responsive mode: switch to chat-first layout on smaller screens
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mq = window.matchMedia('(max-width: 900px)');
    const onChange = (event: MediaQueryListEvent) => {
      handleCompactLayoutChange(event.matches);
    };

    if (mq.addEventListener) {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }

    // Safari fallback
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, [handleCompactLayoutChange]);

  // Handlers for TTS provider/model changes
  const handleTtsProviderChange = useCallback((provider: TTSProvider) => {
    setTtsProvider(provider);
  }, [setTtsProvider]);

  const handleTtsModelChange = useCallback((model: string) => {
    setTtsModel(model);
  }, [setTtsModel]);

  const handleSttProviderChange = useCallback((provider: 'local' | 'openai') => {
    setSttProvider(provider);
  }, [setSttProvider]);

  const handleSttInputModeChange = useCallback((mode: STTInputMode) => {
    setSttInputMode(mode);
  }, [setSttInputMode]);

  const handleSttModelChange = useCallback((model: string) => {
    setSttModel(model);
  }, [setSttModel]);

  const visibleSaveToast = saveToast?.agentId === workspaceAgentId
    && saveToast.workspaceVersion === workspaceVersion
    ? saveToast
    : null;

  const chatContent = (
    <TabbedContentArea
      activeTab={activeTab}
      openFiles={openFiles}
      openBeads={visibleOpenBeads}
      workspaceAgentId={workspaceAgentId}
      onSelectTab={setActiveTab}
      onCloseTab={closeWorkspaceTab}
      onContentChange={updateContent}
      onSaveFile={handleSaveFile}
      saveToast={visibleSaveToast}
      onDismissToast={dismissSaveToast}
      onReloadFile={reloadFile}
      onRetryFile={reloadFile}
      onOpenWorkspacePath={openWorkspacePath}
      onOpenBeadId={openBeadId}
      pathLinkPrefixes={chatPathLinkPrefixes}
      pathLinkAliases={chatPathLinkAliases}
      chatPanel={
        <PanelErrorBoundary name="Chat">
          <ChatPanel
            ref={chatPanelRef}
            id="main-chat"
            messages={messages}
            onSend={handleSend}
            onAbort={handleAbort}
            isGenerating={isGenerating}
            stream={stream}
            processingStage={processingStage}
            lastEventTimestamp={lastEventTimestamp}
            currentToolDescription={currentToolDescription}
            activityLog={activityLog}
            onWakeWordState={handleWakeWordState}
            onReset={handleReset}
            searchOpen={searchOpen}
            onSearchClose={closeSearch}
            agentName={currentSessionDisplayName}
            loadMore={loadMore}
            hasMore={hasMore}
            onToggleFileBrowser={handleToggleFileBrowser}
            isFileBrowserCollapsed={fileBrowserCollapsed}
            onBack={isCompactLayout ? () => setMobileView('home') : undefined}
            onOpenDetails={() => setDetailsOpen(true)}
            agentVariant={currentBot && isCorgiVariant(currentBot.avatar) ? currentBot.avatar : undefined}
            agentCollar={currentBot?.color}
            onDelete={currentBot ? () => setDeleteBotConfirm(true) : undefined}
            groupSubtitle={currentGroup ? `${currentGroup.group.name} · ${currentGroup.members.length + 1} bots` : undefined}
            groupMembers={currentGroup?.members.map((m) => ({
              id: m.id,
              name: m.name,
              variant: isCorgiVariant(m.avatar) ? m.avatar : undefined,
              color: m.color,
            }))}
            onOpenWorkspacePath={openWorkspacePath}
            pathLinkPrefixes={chatPathLinkPrefixes}
            pathLinkAliases={chatPathLinkAliases}
            onOpenBeadId={openBeadId}
            showCommandPaletteButton={commandPaletteButtonVisible && !paletteOpen && !settingsOpen && viewMode === 'chat'}
            onOpenCommandPalette={handleOpenPalette}
          />
        </PanelErrorBoundary>
      }
    />
  );

  const showCompactFileBrowser = isCompactLayout && viewMode !== 'kanban' && !fileBrowserCollapsed;

  return (
    <div className="relative h-screen flex flex-col overflow-hidden" data-booted={booted}>
      {/* Skip to main content link for keyboard navigation */}
      <a 
        href="#main-chat" 
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:font-bold focus:text-sm"
      >
        Skip to chat
      </a>
      <ConnectDialog
        open={dialogOpen && connectionState !== 'connected' && connectionState !== 'reconnecting'}
        onConnect={handleConnect}
        error={connectError}
        defaultUrl={editableUrl}
        defaultToken={editableToken}
        officialUrl={officialUrl}
        serverSideAuth={serverSideAuth}
      />

      {/*
       * Gateway state banners.
       * Kept compact and centered so they read as transient shell notices instead of old alarm strips.
       */}
      {connectionState === 'reconnecting' && !gatewayRestarting && (
        <div className="fixed left-1/2 top-12 z-50 flex max-w-[calc(100vw-1.067rem)] -translate-x-1/2 items-start gap-2 rounded-2xl border border-destructive/25 bg-card/94 px-4 py-2 text-xs font-medium text-foreground shadow-[0_20px_48px_rgba(0,0,0,0.28)] backdrop-blur-xl">
          <span className="inline-flex size-7 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <AlertTriangle size={14} aria-hidden="true" />
          </span>
          <span className="min-w-0 text-left leading-5">
            Signal lost. Reconnecting{reconnectAttempt > 1 ? `, attempt ${reconnectAttempt}` : ''}.
          </span>
          <span className="size-2 rounded-full bg-destructive animate-pulse" aria-hidden="true" />
        </div>
      )}

      {gatewayRestarting && (
        <div className="fixed left-1/2 top-12 z-50 flex max-w-[calc(100vw-1.067rem)] -translate-x-1/2 items-start gap-2 rounded-2xl border border-orange/25 bg-card/94 px-4 py-2 text-xs font-medium text-foreground shadow-[0_20px_48px_rgba(0,0,0,0.28)] backdrop-blur-xl">
          <span className="inline-flex size-7 items-center justify-center rounded-xl bg-orange/10 text-orange">
            <RotateCw size={14} className="animate-spin" aria-hidden="true" />
          </span>
          <span className="min-w-0 text-left leading-5">Gateway restarting…</span>
        </div>
      )}

      {!gatewayRestarting && gatewayRestartNotice && (
        <button
          type="button"
          onClick={dismissNotice}
          className={`fixed left-1/2 top-12 z-50 flex max-w-[calc(100vw-1.067rem)] -translate-x-1/2 cursor-pointer items-start gap-2 rounded-2xl border px-4 py-2 text-xs font-medium shadow-[0_20px_48px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-transform hover:-translate-x-1/2 hover:-translate-y-px ${
            gatewayRestartNotice.ok
              ? 'border-green/25 bg-card/94 text-foreground'
              : 'border-destructive/25 bg-card/94 text-foreground'
          }`}
        >
          <span className={`inline-flex size-7 items-center justify-center rounded-xl ${
            gatewayRestartNotice.ok ? 'bg-green/10 text-green' : 'bg-destructive/10 text-destructive'
          }`}>
            {gatewayRestartNotice.ok ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}
          </span>
          <span className="min-w-0 text-left leading-5">{gatewayRestartNotice.message}</span>
        </button>
      )}
      
      <PanelErrorBoundary name="Settings">
        <Suspense fallback={null}>
          <SettingsDrawer
            open={settingsOpen}
            onClose={closeSettings}
            gatewayUrl={editableUrl}
            gatewayToken={editableToken}
            onUrlChange={setEditableUrl}
            onTokenChange={setEditableToken}
            onReconnect={handleReconnect}
            connectionState={connectionState}
            soundEnabled={soundEnabled}
            onToggleSound={toggleSound}
            ttsProvider={ttsProvider}
            ttsModel={ttsModel}
            onTtsProviderChange={handleTtsProviderChange}
            onTtsModelChange={handleTtsModelChange}
            sttProvider={sttProvider}
            sttInputMode={sttInputMode}
            sttModel={sttModel}
            onSttProviderChange={handleSttProviderChange}
            onSttInputModeChange={handleSttInputModeChange}
            onSttModelChange={handleSttModelChange}
            wakeWordEnabled={wakeWordEnabled}
            onToggleWakeWord={handleToggleWakeWord}
            liveTranscriptionPreview={liveTranscriptionPreview}
            onToggleLiveTranscriptionPreview={toggleLiveTranscriptionPreview}
            agentName={agentName}
            onLogout={onLogout}
            onGatewayRestart={handleGatewayRestart}
            gatewayRestarting={gatewayRestarting}
          />
        </Suspense>
      </PanelErrorBoundary>

      {/* ── Messaging shell: Home roster · Conversation · Details ── */}
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden px-2 pt-1.5 pb-2 sm:px-4 sm:pt-2 sm:pb-2">
        {/* Home / roster — sidebar on desktop, full screen on phones */}
        <aside
          className={`glass boot-panel flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[28px] ${
            isCompactLayout
              ? (mobileView === 'home' ? 'flex flex-1' : 'hidden')
              : 'flex w-[300px] shrink-0 xl:w-[336px]'
          }`}
        >
          <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Loading bots…</div>}>
            <PanelErrorBoundary name="Home">
              <RosterSidebar
                sessions={sessions}
                currentSession={currentSession}
                busyState={busyState}
                agentStatus={agentStatus}
                unreadSessions={unreadSessions}
                onSelect={(key) => {
                  void handleSessionChange(key);
                  if (isCompactLayout) setMobileView('chat');
                }}
                onRefresh={refreshSessions}
                onSpawn={handleSpawnSession}
                isLoading={sessionsLoading}
                agentName={agentName}
                roster={roster}
                onNewBot={() => setBotDialog({ open: true })}
                onNewGroup={() => setGroupDialog({ open: true })}
                onEditBot={(bot) => setBotDialog({ open: true, bot })}
                onEditGroup={(group) => setGroupDialog({ open: true, group })}
                onEditSection={(section) => setSectionDialog({ open: true, section })}
                onOpenGroupChat={(key) => {
                  void handleSessionChange(key);
                  if (isCompactLayout) setMobileView('chat');
                }}
                onOpenTasks={() => {
                  setViewMode('kanban');
                  if (isCompactLayout) setMobileView('chat');
                }}
              />
            </PanelErrorBoundary>
          </Suspense>
        </aside>

        {/* Desktop file explorer column */}
        {!isCompactLayout && viewMode !== 'kanban' && !fileBrowserCollapsed && (
          <aside className="glass boot-panel hidden min-h-0 w-[280px] shrink-0 overflow-hidden rounded-[28px] sm:flex">
            <PanelErrorBoundary name="File Explorer">
              <FileTreePanel
                workspaceAgentId={workspaceAgentId}
                onOpenFile={openFile}
                onAddToChat={(path, kind, agentId) => chatPanelRef.current?.addWorkspacePath(path, kind, agentId ?? workspaceAgentId)}
                addToChatEnabled={addToChatEnabled}
                lastChangedEvent={lastChangedEvent}
                revealRequest={revealRequest}
                onRemapOpenPaths={remapOpenPaths}
                onCloseOpenPaths={closeOpenPathsByPrefix}
                isCompactLayout={false}
                collapsed={false}
                onCollapseChange={setFileBrowserCollapsed}
              />
            </PanelErrorBoundary>
          </aside>
        )}

        {/* Conversation / Tasks — hidden on phones unless selected */}
        <section
          className={`boot-panel flex min-h-0 min-w-0 flex-1 flex-col ${
            isCompactLayout && mobileView === 'chat' ? 'flex' : isCompactLayout ? 'hidden' : 'flex'
          }`}
        >
          <div className="shell-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px]">
            <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-2 py-1.5 sm:px-3">
              <button
                type="button"
                onClick={() => setViewMode('chat')}
                aria-pressed={viewMode === 'chat'}
                className={`shell-chip min-h-9 flex-1 justify-center text-2xs sm:flex-none`}
                data-active={viewMode === 'chat'}
              >
                <MessageSquare size={13} aria-hidden="true" /> Chat
              </button>
              {kanbanVisible && (
                <button
                  type="button"
                  onClick={() => setViewMode('kanban')}
                  aria-pressed={viewMode === 'kanban'}
                  className="shell-chip min-h-9 flex-1 justify-center text-2xs sm:flex-none"
                  data-active={viewMode === 'kanban'}
                >
                  <LayoutGrid size={13} aria-hidden="true" /> Tasks
                </button>
              )}
            </div>
            {viewMode === 'kanban' ? (
              <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading board…</div>}>
                <KanbanPanel initialTaskId={pendingTaskId} onInitialTaskConsumed={() => setPendingTaskId(null)} onSaveAsSkill={handleSaveTaskAsSkill} />
              </Suspense>
            ) : (
              <div className="min-h-0 flex-1 overflow-hidden">{chatContent}</div>
            )}
          </div>
        </section>

        {/* Desktop details column */}
        {!isCompactLayout && detailsOpen && (
          <aside className="glass boot-panel flex w-[336px] shrink-0 flex-col overflow-hidden rounded-[28px]">
            <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-2">
              <span className="t-title">Details</span>
              <button
                type="button"
                onClick={() => setDetailsOpen(false)}
                aria-label="Close details"
                className="shell-icon-button size-9 px-0"
              >
                <PanelRightClose size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Loading…</div>}>
                <PanelErrorBoundary name="Details">
                  <WorkspacePanel
                    workspaceAgentId={workspaceAgentId}
                    memories={memories}
                    onRefreshMemories={refreshMemories}
                    memoriesLoading={memoriesLoading}
                    remoteWorkspace={remoteWorkspace}
                    compact
                    onOpenBoard={() => setViewMode('kanban')}
                    onOpenTask={openTaskInBoard}
                  />
                </PanelErrorBoundary>
              </Suspense>
            </div>
          </aside>
        )}

        {/* Phone Activity destination */}
        {isCompactLayout && mobileView === 'activity' && (
          <section className="shell-panel boot-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[28px]">
            <ActivityFeed
              sessions={sessions}
              unreadSessions={unreadSessions}
              onSelectSession={(key) => {
                void handleSessionChange(key);
                setMobileView('chat');
              }}
              onOpenTasks={() => {
                setViewMode('kanban');
                setMobileView('chat');
              }}
            />
          </section>
        )}

        {/* Phone details sheet (bot profile, skills, routines, files) */}
        {isCompactLayout && detailsOpen && (
          <div className="glass-strong fixed inset-0 z-50 flex flex-col" role="dialog" aria-modal="true" aria-label="Bot details">
            <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))]">
              <span className="t-title">Details</span>
              <button
                type="button"
                onClick={() => setDetailsOpen(false)}
                aria-label="Close details"
                className="shell-icon-button min-h-11 min-w-11 justify-center rounded-xl"
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Loading…</div>}>
                <PanelErrorBoundary name="Details">
                  <WorkspacePanel
                    workspaceAgentId={workspaceAgentId}
                    memories={memories}
                    onRefreshMemories={refreshMemories}
                    memoriesLoading={memoriesLoading}
                    remoteWorkspace={remoteWorkspace}
                    compact
                    onOpenBoard={() => { setViewMode('kanban'); setDetailsOpen(false); }}
                    onOpenTask={(id) => { setDetailsOpen(false); openTaskInBoard(id); }}
                  />
                </PanelErrorBoundary>
              </Suspense>
            </div>
          </div>
        )}

        {/* Mobile file explorer drawer (overlay) */}
        {showCompactFileBrowser && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-30 bg-black/48 backdrop-blur-sm"
              onClick={() => setFileBrowserCollapsed(true)}
              aria-label="Close file explorer"
            />
            <div className="pointer-events-none fixed inset-0 z-40 flex px-2 pb-[5rem] pt-2">
              <div className="pointer-events-auto h-full w-[min(88vw,340px)] max-w-full animate-in slide-in-from-left-4 duration-200">
                <PanelErrorBoundary name="File Explorer">
                  <FileTreePanel
                    workspaceAgentId={workspaceAgentId}
                    onOpenFile={openFile}
                    onAddToChat={(path, kind, agentId) => chatPanelRef.current?.addWorkspacePath(path, kind, agentId ?? workspaceAgentId)}
                    addToChatEnabled={addToChatEnabled}
                    lastChangedEvent={lastChangedEvent}
                    revealRequest={revealRequest}
                    onRemapOpenPaths={remapOpenPaths}
                    onCloseOpenPaths={closeOpenPathsByPrefix}
                    isCompactLayout={isCompactLayout}
                    collapsed={false}
                    onCollapseChange={setFileBrowserCollapsed}
                  />
                </PanelErrorBoundary>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Status Bar (desktop) */}
      {!isCompactLayout && (
        <div className="boot-panel" style={{ transitionDelay: '200ms' }}>
          <StatusBar
            connectionState={connectionState}
            sessionCount={sessions.length}
            sparkline={sparkline}
            contextTokens={contextTokens}
            contextLimit={contextLimit}
          />
        </div>
      )}

      {/* Phone bottom navigation */}
      {isCompactLayout && (
        <MobileTabBar
          active={mobileView === 'activity' ? 'activity' : 'home'}
          onHome={() => setMobileView('home')}
          onSearch={handleOpenPalette}
          onNew={() => setBotDialog({ open: true })}
          onActivity={() => setMobileView('activity')}
          onSettings={openSettings}
          unreadCount={unreadCount}
          activityCount={pendingApprovalCount}
        />
      )}

      {/* Command Palette */}
      <PanelErrorBoundary name="Command Palette">
        <Suspense fallback={null}>
          <CommandPalette
            open={paletteOpen}
            onClose={closePalette}
            commands={commands}
          />
        </Suspense>
      </PanelErrorBoundary>

      {/* Reset Session Confirmation */}
      <ConfirmDialog
        open={showResetConfirm}
        title="Reset Session"
        message="This will start fresh and clear all context."
        confirmLabel="Reset"
        cancelLabel="Cancel"
        onConfirm={confirmReset}
        onCancel={cancelReset}
        variant="danger"
      />

      {/* Delete Bot Confirmation */}
      <ConfirmDialog
        open={deleteBotConfirm}
        title={`Delete ${currentBot?.name ?? 'bot'}?`}
        message="The bot profile, its session, and its routines are removed. This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => void handleDeleteCurrentBot()}
        onCancel={() => setDeleteBotConfirm(false)}
        variant="danger"
      />

      {/* Gateway Restart Confirmation */}
      <ConfirmDialog
        open={showGatewayRestartConfirm}
        title="Restart OpenClaw Gateway"
        message="This will briefly interrupt gateway connectivity. Continue?"
        confirmLabel="Restart"
        cancelLabel="Cancel"
        onConfirm={confirmGatewayRestart}
        onCancel={cancelGatewayRestart}
        variant="warning"
      />

      <WorkspaceSwitchDialog
        open={pendingWorkspaceSwitch !== null}
        targetLabel={pendingWorkspaceSwitch?.targetLabel || 'the other agent'}
        pendingAction={workspaceSwitchAction}
        error={workspaceSwitchError}
        onSaveAndSwitch={handleSaveAndSwitch}
        onDiscardAndSwitch={handleDiscardAndSwitch}
        onCancel={handleCancelWorkspaceSwitch}
      />

      {/* Spawn Agent Dialog (from command palette) */}
      <SpawnAgentDialog
        open={spawnDialogOpen}
        onOpenChange={setSpawnDialogOpen}
        onSpawn={handleSpawnSession}
      />

      {/* Roster dialogs (new/edit bot, group, section) */}
      {botDialog.open && (
        <BotDialog
          bot={botDialog.bot}
          bots={roster.roster.bots}
          onClose={() => setBotDialog({ open: false })}
          onSave={handleBotDialogSave}
          onCreateGroup={async (values) => {
            // Group chat = Alpha session. Create the Alpha first so the group
            // can reference it, then wire members via the API (native
            // subagents.allowAgents delegation).
            let alphaBotId: string | null = null;
            if (values.alphaEnabled) {
              const team = values.memberBotIds
                .map((id) => {
                  const b = roster.roster.bots.find((x) => x.id === id);
                  if (!b) return null;
                  // sessionKey `agent:<slug>:main` → OpenClaw agent id `<slug>`
                  const agentSlug = b.agentId?.split(':')[1] ?? null;
                  return agentSlug ? `${b.name} (agentId: ${agentSlug})` : b.name;
                })
                .filter(Boolean)
                .join('; ');
              const alpha = await createBotFromValues({
                name: `${values.name} Alpha`,
                title: 'Group coordinator',
                description: `You coordinate the "${values.name}" group. Team roster: ${team || 'to be assigned'}. Delegate bounded tasks with sessions_spawn using the teammate's agentId, one owner per step, verify their artifacts, then report a coherent result. Never delegate further than this team, and require approval before any external action.`,
                color: '#0A84FF',
                avatar: 'cardigan',
              });
              alphaBotId = alpha.id;
            }
            const group = await roster.createGroup({
              name: values.name,
              memberBotIds: values.memberBotIds,
              alphaBotId,
            });
            setBotDialog({ open: false });
            // Open the group chat (Alpha session).
            if (alphaBotId) {
              const alpha = roster.roster.bots.find((b) => b.id === alphaBotId);
              if (alpha?.agentId) {
                await handleSessionChange(alpha.agentId);
                if (isCompactLayout) setMobileView('chat');
              }
            } else {
              void group;
            }
          }}
        />
      )}
      {groupDialog.open && (
        <GroupWizard
          group={groupDialog.group}
          bots={roster.roster.bots}
          onClose={() => setGroupDialog({ open: false })}
          createBot={createBotFromValues}
          onRequestCreateBot={() => setBotDialog({ open: true })}
          onSave={async (values) => {
            if (groupDialog.group) await roster.updateGroup(groupDialog.group.id, values);
            else await roster.createGroup({ name: values.name, memberBotIds: values.memberBotIds, alphaBotId: values.alphaBotId ?? null });
            setGroupDialog({ open: false });
          }}
        />
      )}
      {sectionDialog.open && sectionDialog.section && (
        <SectionDialog
          section={sectionDialog.section}
          onClose={() => setSectionDialog({ open: false })}
          onSave={async (name) => {
            await roster.renameSection(sectionDialog.section!.id, name);
            setSectionDialog({ open: false });
          }}
        />
      )}
    </div>
  );
}
