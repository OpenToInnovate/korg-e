import { Bell, Home, Plus, Search, User } from 'lucide-react';
import { cn } from '@/lib/utils';

export type MobileDestination = 'home' | 'activity';

interface MobileTabBarProps {
  active: MobileDestination;
  onHome: () => void;
  onSearch: () => void;
  onNew: () => void;
  onActivity: () => void;
  onSettings: () => void;
  unreadCount: number;
  activityCount: number;
}

/**
 * Floating Liquid-Glass tab bar (iOS 26 style) with Material pill indicators.
 * Five labeled destinations, all of which resolve to a real view:
 * Home, Search, New, Activity, You.
 */
export function MobileTabBar({
  active,
  onHome,
  onSearch,
  onNew,
  onActivity,
  onSettings,
  unreadCount,
  activityCount,
}: MobileTabBarProps) {
  const tab = (isActive: boolean) =>
    cn(
      'pressable relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-full py-1.5 min-h-11 text-2xs font-semibold',
      isActive ? 'bg-primary/15 text-primary' : 'text-muted-foreground',
    );

  return (
    <nav
      aria-label="Primary"
      className="shrink-0 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5"
    >
      <div className="glass mx-auto flex max-w-md items-stretch gap-0.5 rounded-full p-1.5">
        <button type="button" onClick={onHome} aria-label="Home" aria-current={active === 'home' ? 'page' : undefined} className={tab(active === 'home')}>
          <span className="relative">
            <Home size={20} />
            {unreadCount > 0 && (
              <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </span>
          Home
        </button>
        <button type="button" onClick={onSearch} aria-label="Search" className={tab(false)}>
          <Search size={20} />
          Search
        </button>
        <button
          type="button"
          onClick={onNew}
          aria-label="New bot or group"
          className="pressable flex flex-1 flex-col items-center justify-center gap-0.5 rounded-full py-1 text-2xs font-semibold text-muted-foreground"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-1)]">
            <Plus size={18} />
          </span>
          New
        </button>
        <button type="button" onClick={onActivity} aria-label="Activity" aria-current={active === 'activity' ? 'page' : undefined} className={tab(active === 'activity')}>
          <span className="relative">
            <Bell size={20} />
            {activityCount > 0 && (
              <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                {activityCount > 9 ? '9+' : activityCount}
              </span>
            )}
          </span>
          Activity
        </button>
        <button type="button" onClick={onSettings} aria-label="Settings" className={tab(false)}>
          <User size={20} />
          You
        </button>
      </div>
    </nav>
  );
}