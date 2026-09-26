/**
 * ProfileSwitcher — pick which household profile owns the roster.
 *
 * Sits in the shell's top bar. The active profile drives every group and bot
 * in the sidebar, so switching wipes the previous profile's data (handled by
 * the host via `onProfileActivated`) before anything new is rendered.
 *
 * Visual language is borrowed from the existing cockpit chrome: `glass-strong`
 * menus, `animate-menu-in`, 2xl radii, and the KorgeAvatar corgi system.
 * @module
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Pencil, Plus, Trash2, Users, X } from 'lucide-react';
import KorgeAvatar from '@/components/KorgeAvatar';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { isLastProfileError, type Profile, type ProfilesApi } from './useProfiles';

/** Palette matches the app's existing semantic colors (no new color system). */
const PROFILE_COLORS = ['#0A84FF', '#30D158', '#FF9F0A', '#BF5AF2', '#FF453A', '#64D2FF'] as const;

/** A small, deliberately fixed set — no full emoji picker. */
const PROFILE_EMOJI = ['🐶', '🐕', '🦊', '🐺', '🐻', '🐼', '🦁', '🐨', '🧒', '👧'] as const;

const MENU_WIDTH = 264;

export interface ProfileSwitcherProps {
  profiles: ProfilesApi;
  className?: string;
}

/** Emoji or corgi avatar, tinted with the profile color. */
function ProfileAvatar({ profile, size = 22 }: { profile: Profile; size?: number }) {
  if (profile.emoji) {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-full"
        style={{
          width: size,
          height: size,
          fontSize: Math.round(size * 0.6),
          background: `color-mix(in srgb, ${profile.color} 22%, transparent)`,
        }}
        aria-hidden="true"
      >
        {profile.emoji}
      </span>
    );
  }
  return <KorgeAvatar name={profile.id} collar={profile.color} size={size} />;
}

export function ProfileSwitcher({ profiles, className }: ProfileSwitcherProps) {
  const { profiles: list, activeProfile, loading, switching, error, createProfile, updateProfile, deleteProfile, activateProfile } = profiles;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  // Per-row UI state: which profile is being renamed / confirmed for delete.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftColor, setDraftColor] = useState<string>(PROFILE_COLORS[0]);
  const [draftEmoji, setDraftEmoji] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Track the trigger so the menu can follow it (resize / scroll).
  const updateAnchor = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = MENU_WIDTH;
    // Keep the menu on screen: clamp horizontally, flip above if it would
    // overflow the bottom of the viewport.
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
    const below = rect.bottom + 6;
    const top = below + MENU_HEIGHT_ESTIMATE > window.innerHeight && rect.top - MENU_HEIGHT_ESTIMATE > 8
      ? Math.max(8, rect.top - MENU_HEIGHT_ESTIMATE - 6)
      : below;
    setAnchor({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    updateAnchor();
    window.addEventListener('resize', updateAnchor);
    window.addEventListener('scroll', updateAnchor, true);
    return () => {
      window.removeEventListener('resize', updateAnchor);
      window.removeEventListener('scroll', updateAnchor, true);
    };
  }, [open, updateAnchor, list.length]);

  // Click-away + Escape close the menu.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
      setConfirmId(null);
      setRenamingId(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      setConfirmId(null);
      setRenamingId(null);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const ordered = useMemo(() => [...list].sort((a, b) => a.order - b.order), [list]);

  const startRename = (profile: Profile) => {
    setConfirmId(null);
    setMenuError(null);
    setRenamingId(profile.id);
    setRenameDraft(profile.name);
  };

  const commitRename = async (id: string) => {
    const name = renameDraft.trim();
    setRenamingId(null);
    if (!name) return;
    try {
      await updateProfile(id, { name });
      setMenuError(null);
    } catch {
      // Error already surfaced by the hook.
    }
  };

  const confirmDelete = async (profile: Profile) => {
    setConfirmId(null);
    try {
      await deleteProfile(profile.id);
      setMenuError(null);
    } catch (err) {
      // 409 (last profile) becomes a friendly inline note; anything else is
      // already normalized by the hook.
      if (isLastProfileError(err)) setMenuError('You need at least one profile — add another before removing this one.');
      setOpen(true);
    }
  };

  const handleActivate = async (profile: Profile) => {
    setOpen(false);
    setMenuError(null);
    setConfirmId(null);
    setRenamingId(null);
    if (profile.id === profiles.activeProfileId) return;
    await activateProfile(profile.id).catch(() => undefined);
  };

  const submitCreate = async () => {
    const name = draftName.trim();
    if (!name) {
      setCreateError('Give the profile a name.');
      return;
    }
    setCreating(true);
    try {
      await createProfile({ name, color: draftColor, emoji: draftEmoji });
      setCreateOpen(false);
      setDraftName('');
      setDraftEmoji(null);
      setDraftColor(PROFILE_COLORS[0]);
      setCreateError(null);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create profile');
    } finally {
      setCreating(false);
    }
  };

  const label = activeProfile?.name ?? (loading ? 'Loading…' : 'No profile');

  return (
    <div className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Profile: ${label}. Switch profile`}
        data-testid="profile-switcher-trigger"
        disabled={switching}
        className="shell-icon-button min-h-9 max-w-[190px] gap-2 rounded-xl px-2.5"
      >
        {activeProfile ? (
          <ProfileAvatar profile={activeProfile} size={20} />
        ) : (
          <Users size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold">{label}</span>
        <ChevronDown
          size={14}
          className={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
        {switching && <span className="sr-only">Switching…</span>}
      </button>

      {open && anchor && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="Profiles"
          data-testid="profile-switcher-menu"
          style={{ top: anchor.top, left: anchor.left, width: MENU_WIDTH }}
          className="glass-strong animate-menu-in fixed z-[60] overflow-hidden rounded-2xl"
        >
          <div className="px-2.5 pt-2.5 pb-1.5 text-2xs font-bold uppercase tracking-wide text-muted-foreground/80">
            Profiles
          </div>

          {ordered.length === 0 && (
            <div className="px-3 py-3 text-sm text-muted-foreground">No profiles yet.</div>
          )}

          <div className="max-h-[min(52vh,420px)] overflow-y-auto pb-1">
            {ordered.map((profile) => {
              const isActive = profile.id === profiles.activeProfileId;
              const isRenaming = renamingId === profile.id;
              const isConfirming = confirmId === profile.id;

              return (
                <div key={profile.id} className="px-1.5">
                  {isRenaming ? (
                    <div className="flex items-center gap-1.5 px-1.5 py-1.5">
                      <Input
                        autoFocus
                        value={renameDraft}
                        aria-label={`Rename ${profile.name}`}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitRename(profile.id);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        className="h-9 text-sm"
                      />
                      <button
                        type="button"
                        aria-label={`Save name for ${profile.name}`}
                        onClick={() => void commitRename(profile.id)}
                        className="shell-icon-button size-9 shrink-0 justify-center rounded-xl"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label="Cancel rename"
                        onClick={() => setRenamingId(null)}
                        className="shell-icon-button size-9 shrink-0 justify-center rounded-xl"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : isConfirming ? (
                    <div className="rounded-xl bg-secondary/60 px-2.5 py-2" data-testid={`profile-confirm-${profile.id}`}>
                      <p className="text-xs leading-5 text-foreground">
                        Remove <span className="font-semibold">{profile.name}</span> and its bots?
                      </p>
                      <div className="mt-2 flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => setConfirmId(null)}
                          className="shell-icon-button min-h-8 flex-1 justify-center rounded-lg text-xs"
                        >
                          Keep
                        </button>
                        <button
                          type="button"
                          onClick={() => void confirmDelete(profile)}
                          className="shell-icon-button min-h-8 flex-1 justify-center rounded-lg text-xs text-destructive"
                          data-tone="danger"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      role="menuitem"
                      tabIndex={0}
                      aria-current={isActive}
                      data-testid={`profile-row-${profile.id}`}
                      onClick={() => void handleActivate(profile)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          void handleActivate(profile);
                        }
                      }}
                      className={cn(
                        'flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-2 text-left',
                        isActive ? 'bg-secondary' : 'hover:bg-secondary/60',
                      )}
                    >
                      <ProfileAvatar profile={profile} size={26} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-foreground">{profile.name}</span>
                        {isActive && <span className="block text-2xs text-muted-foreground">Active</span>}
                      </span>
                      {isActive && <Check size={14} className="shrink-0 text-primary" aria-hidden="true" />}
                      {!isActive && (
                        <span className="flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            aria-label={`Rename ${profile.name}`}
                            onClick={(e) => { e.stopPropagation(); startRename(profile); }}
                            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-background hover:text-foreground"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${profile.name}`}
                            onClick={(e) => { e.stopPropagation(); setMenuError(null); setConfirmId(profile.id); }}
                            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-background hover:text-destructive"
                          >
                            <Trash2 size={13} />
                          </button>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {(menuError || (open && error)) && (
            <div
              role="alert"
              data-testid="profile-menu-error"
              className="mx-2.5 mb-1.5 rounded-xl border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs leading-5 text-destructive"
            >
              {menuError ?? error}
            </div>
          )}

          <div className="border-t border-border/60 p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setMenuError(null);
                setCreateError(null);
                setCreateOpen(true);
              }}
              data-testid="profile-new"
              className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left text-sm font-semibold text-foreground hover:bg-secondary"
            >
              <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
                <Plus size={14} />
              </span>
              New profile
            </button>
          </div>
        </div>,
        document.body,
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>New profile</DialogTitle>
            <DialogDescription>
              Each profile gets its own bots and groups. Nothing is shared between profiles.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <label htmlFor="profile-name" className="text-xs font-semibold text-muted-foreground">Name</label>
              <Input
                id="profile-name"
                autoFocus
                value={draftName}
                placeholder="e.g. Sam"
                onChange={(e) => { setDraftName(e.target.value); setCreateError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') void submitCreate(); }}
                aria-invalid={createError ? 'true' : undefined}
              />
            </div>

            <div className="grid gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground">Color</span>
              <div className="flex flex-wrap gap-2">
                {PROFILE_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Color ${color}`}
                    aria-pressed={draftColor === color}
                    onClick={() => setDraftColor(color)}
                    className={cn(
                      'size-8 rounded-full border-2 transition-transform',
                      draftColor === color ? 'border-foreground scale-105' : 'border-transparent',
                    )}
                    style={{ background: color }}
                  />
                ))}
              </div>
            </div>

            <div className="grid gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground">Icon</span>
              <div className="flex flex-wrap gap-1.5">
                {PROFILE_EMOJI.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={`Icon ${emoji}`}
                    aria-pressed={draftEmoji === emoji}
                    onClick={() => setDraftEmoji((cur) => (cur === emoji ? null : emoji))}
                    className={cn(
                      'flex size-9 items-center justify-center rounded-xl text-lg transition-transform',
                      draftEmoji === emoji ? 'bg-secondary scale-105' : 'hover:bg-secondary/60',
                    )}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <p className="text-2xs text-muted-foreground">Optional — leave empty for a corgi avatar.</p>
            </div>
          </div>

          {createError && (
            <p role="alert" data-testid="profile-create-error" className="text-sm text-destructive">{createError}</p>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => void submitCreate()} disabled={creating}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ProfileSwitcher;

/** Rough menu height used only to decide whether to flip above the trigger. */
const MENU_HEIGHT_ESTIMATE = 320;
