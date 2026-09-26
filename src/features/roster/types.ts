/** Shared roster types (mirror server/lib/roster-store.ts). */

export interface RosterBot {
  id: string;
  agentId: string | null;
  /** Sidebar section id (project/client grouping). Null = Unassigned. */
  sectionId: string | null;
  /** Corgi variant id (front-end registry). Empty = derive from name. */
  avatar: string;
  name: string;
  title: string;
  description: string;
  color: string;
  pinned: boolean;
  hidden: boolean;
  notifications: boolean;
  enabledSkills: string[];
  createdAt: number;
  updatedAt: number;
}

export interface RosterSection {
  id: string;
  name: string;
  order: number;
  createdAt: number;
}

export interface RosterGroup {
  id: string;
  name: string;
  memberBotIds: string[];
  /** Bot that owns the group chat and delegates to members (the "Alpha"). */
  alphaBotId: string | null;
  pinned: boolean;
  hidden: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface RosterData {
  version: number;
  bots: RosterBot[];
  groups: RosterGroup[];
  sections: RosterSection[];
  /** Active profile this roster belongs to. Null on older servers. */
  profileId?: string | null;
}

export type RosterSelection =
  | { kind: 'bot'; botId: string }
  | { kind: 'group'; groupId: string }
  | { kind: 'session'; sessionKey: string };