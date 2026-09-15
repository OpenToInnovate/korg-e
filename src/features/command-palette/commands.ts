import type { Command } from './types';
import { themes, type ThemeName } from '@/lib/themes';
import { fonts, type FontName } from '@/lib/fonts';
import type { TTSProvider } from '@/features/tts/useTTS';

export type ViewMode = 'chat' | 'kanban';

export interface CommandActions {
  onNewSession: () => void;
  onResetSession: () => void;
  onToggleSound: () => void;
  onSettings: () => void;
  onSearch: () => void;
  onAbort: () => void;
  onSetTheme: (theme: ThemeName) => void;
  onSetFont: (font: FontName) => void;
  onTtsProviderChange: (provider: TTSProvider) => void;
  onToggleWakeWord: () => void;
  onToggleEvents: () => void;
  onToggleLog: () => void;
  onToggleTelemetry: () => void;
  onOpenSettings: () => void;
  onRefreshSessions: () => void;
  onRefreshMemory: () => void;
  onSetViewMode?: (mode: ViewMode) => void;
  canShowKanban?: boolean;
  /** Jump to a session (roster bots / groups). */
  onSelectSession?: (key: string) => void;
  /** Roster entries for global search: bots and groups. */
  botEntries?: Array<{ id: string; label: string; detail: string; sessionKey?: string }>;
  groupEntries?: Array<{ id: string; label: string; detail: string; sessionKey?: string }>;
}

const THEME_LABELS: Record<ThemeName, string> = {
  'corgi': 'Dark',
  'corgi-light': 'Light',
};

const FONT_LABELS: Record<FontName, string> = {
  'system': 'System',
  'inter': 'Inter',
  'instrument-sans': 'Instrument Sans',
  'space-grotesk': 'Space Grotesk',
  'jetbrains-mono': 'JetBrains Mono',
};

/** Build the full list of command-palette commands from action callbacks. */
export function createCommands(actions: CommandActions): Command[] {
  const themeCommands: Command[] = (Object.keys(themes) as ThemeName[]).map((key) => ({
    id: `theme-${key}`,
    label: `Theme: ${THEME_LABELS[key] || key}`,
    action: () => actions.onSetTheme(key),
    category: 'appearance' as const,
    keywords: ['theme', 'color', 'dark', 'light', key.replace(/-/g, ' ')],
  }));

  const fontCommands: Command[] = (Object.keys(fonts) as FontName[]).map((key) => ({
    id: `font-${key}`,
    label: `Font: ${FONT_LABELS[key] || key}`,
    action: () => actions.onSetFont(key),
    category: 'appearance' as const,
    keywords: ['font', 'typeface', 'typography', key.replace(/-/g, ' ')],
  }));

  return [
    {
      id: 'search',
      label: 'Search messages',
      shortcut: '⌘F',
      action: actions.onSearch,
      category: 'navigation',
      keywords: ['find', 'filter'],
    },
    {
      id: 'abort',
      label: 'Stop generation',
      shortcut: 'Esc',
      action: actions.onAbort,
      category: 'actions',
      keywords: ['cancel', 'stop', 'abort'],
    },
    {
      id: 'new-session',
      label: 'Create session',
      action: actions.onNewSession,
      category: 'actions',
      keywords: ['new', 'session', 'agent', 'subagent', 'spawn', 'create', 'launch'],
    },
    {
      id: 'reset',
      label: 'Reset session',
      action: actions.onResetSession,
      category: 'actions',
      keywords: ['clear', 'new', 'fresh'],
    },
    {
      id: 'refresh-sessions',
      label: 'Refresh Sessions',
      action: actions.onRefreshSessions,
      category: 'actions',
      keywords: ['refresh', 'reload', 'sessions'],
    },
    {
      id: 'refresh-memory',
      label: 'Refresh Memory',
      action: actions.onRefreshMemory,
      category: 'actions',
      keywords: ['refresh', 'reload', 'memory'],
    },
    {
      id: 'toggle-events',
      label: 'Toggle Events Panel',
      action: actions.onToggleEvents,
      category: 'navigation',
      keywords: ['events', 'log', 'panel'],
    },
    {
      id: 'toggle-log',
      label: 'Toggle Log Panel',
      action: actions.onToggleLog,
      category: 'navigation',
      keywords: ['activity', 'log', 'panel'],
    },
    {
      id: 'toggle-telemetry',
      label: 'Toggle Usage Panel',
      action: actions.onToggleTelemetry,
      category: 'navigation',
      keywords: ['telemetry', 'usage', 'tokens', 'panel'],
    },
    {
      id: 'open-settings',
      label: 'Open Settings',
      action: actions.onOpenSettings,
      category: 'navigation',
      keywords: ['settings', 'config', 'preferences'],
    },
    {
      id: 'sound',
      label: 'Toggle sound effects',
      action: actions.onToggleSound,
      category: 'settings',
      keywords: ['audio', 'mute', 'sfx'],
    },
    {
      id: 'settings',
      label: 'Connection settings',
      action: actions.onSettings,
      category: 'settings',
      keywords: ['config', 'connect', 'gateway'],
    },
    // TTS commands
    {
      id: 'tts-openai',
      label: 'TTS: Switch to OpenAI',
      action: () => actions.onTtsProviderChange('openai' as TTSProvider),
      category: 'voice',
      keywords: ['tts', 'voice', 'speech', 'openai'],
    },
    {
      id: 'tts-replicate',
      label: 'TTS: Switch to Replicate',
      action: () => actions.onTtsProviderChange('replicate' as TTSProvider),
      category: 'voice',
      keywords: ['tts', 'voice', 'speech', 'replicate', 'qwen'],
    },
    {
      id: 'tts-edge',
      label: 'TTS: Switch to Edge (Free)',
      action: () => actions.onTtsProviderChange('edge' as TTSProvider),
      category: 'voice',
      keywords: ['tts', 'voice', 'speech', 'edge', 'free'],
    },
    {
      id: 'tts-xiaomi',
      label: 'TTS: Switch to Xiaomi Mimo',
      action: () => actions.onTtsProviderChange('xiaomi' as TTSProvider),
      category: 'voice',
      keywords: ['tts', 'voice', 'speech', 'xiaomi', 'mimo'],
    },
    {
      id: 'toggle-wake-word',
      label: 'Toggle Wake Word',
      action: actions.onToggleWakeWord,
      category: 'voice',
      keywords: ['wake', 'voice', 'microphone', 'hey'],
    },
    // Kanban commands
    ...(actions.onSetViewMode && actions.canShowKanban !== false ? [      {
        id: 'open-kanban',
        label: 'Open Tasks View',
        action: () => actions.onSetViewMode!('kanban'),
        category: 'kanban' as const,
        keywords: ['kanban', 'board', 'tasks', 'view'],
      },
      {
        id: 'open-chat',
        label: 'Open Chat View',
        action: () => actions.onSetViewMode!('chat'),
        category: 'kanban' as const,
        keywords: ['chat', 'conversation', 'view'],
      },
      {
        id: 'create-kanban-task',
        label: 'Create Task',
        action: () => actions.onSetViewMode!('kanban'),
        category: 'kanban' as const,
        keywords: ['kanban', 'task', 'create', 'new', 'add'],
      },
    ] : []),
    // Roster: jump to bots and groups (global search parity)
    ...((actions.onSelectSession && (actions.botEntries?.length || actions.groupEntries?.length)) ? [
      ...(actions.botEntries ?? [])
        .filter((b) => b.sessionKey)
        .map((b) => ({
          id: `bot-${b.id}`,
          label: `Bot: ${b.label}`,
          action: () => actions.onSelectSession!(b.sessionKey!),
          category: 'navigation' as const,
          keywords: ['bot', 'agent', 'chat', b.label.toLowerCase(), ...(b.detail ? [b.detail.toLowerCase()] : [])],
        })),
      ...(actions.groupEntries ?? [])
        .filter((g) => g.sessionKey)
        .map((g) => ({
          id: `group-${g.id}`,
          label: `Group: ${g.label}`,
          action: () => actions.onSelectSession!(g.sessionKey!),
          category: 'navigation' as const,
          keywords: ['group', 'pack', 'team', 'chat', g.label.toLowerCase(), ...(g.detail ? [g.detail.toLowerCase()] : [])],
        })),
    ] : []),
    ...themeCommands,
    ...fontCommands,
  ];
}

const CATEGORY_ORDER: Record<string, number> = {
  actions: 0,
  navigation: 1,
  kanban: 2,
  settings: 3,
  appearance: 4,
  voice: 5,
};

/** Filter commands by fuzzy-matching against a search query. */
export function filterCommands(commands: Command[], query: string): Command[] {
  const candidates = query.trim()
    ? commands.filter(cmd => {
        const q = query.toLowerCase();
        if (cmd.label.toLowerCase().includes(q)) return true;
        if (cmd.keywords?.some(k => k.toLowerCase().includes(q))) return true;
        return false;
      })
    : commands;
  
  // Always sort by category order so display order matches flat index
  return candidates.sort((a, b) => {
    const orderA = CATEGORY_ORDER[a.category || 'actions'] ?? 99;
    const orderB = CATEGORY_ORDER[b.category || 'actions'] ?? 99;
    return orderA - orderB;
  });
}
