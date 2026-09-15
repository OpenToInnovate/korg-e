// Theme definitions for Nerve UI

export type ThemeName =
  | 'corgi'
  | 'corgi-light';

export interface Theme {
  name: ThemeName;
  label: string;
  colors: Record<string, string>;
}

export const themes: Record<ThemeName, Theme> = {
  'corgi': {
    name: 'corgi',
    label: 'Dark',
    colors: {
      '--color-background': '#000000',
      '--color-foreground': '#FFFFFF',
      '--color-card': '#1C1C1E',
      '--color-card-foreground': '#FFFFFF',
      '--color-popover': '#2C2C2E',
      '--color-popover-foreground': '#FFFFFF',
      '--color-primary': '#0A84FF',
      '--color-primary-foreground': '#FFFFFF',
      '--color-secondary': '#2C2C2E',
      '--color-secondary-foreground': '#FFFFFF',
      '--color-muted': '#1C1C1E',
      '--color-muted-foreground': '#8E8E93',
      '--color-accent': '#2C2C2E',
      '--color-accent-foreground': '#FFFFFF',
      '--color-destructive': '#FF453A',
      '--color-destructive-foreground': '#FFFFFF',
      '--color-border': '#38383A',
      '--color-input': '#2C2C2E',
      '--color-ring': '#0A84FF',
      '--color-green': '#30D158',
      '--color-red': '#FF453A',
      '--color-orange': '#FF9F0A',
      '--color-purple': '#BF5AF2',
      '--color-info': '#64D2FF',
      '--color-message-user': '#0A84FF',
      '--color-message-user-foreground': '#FFFFFF',
      '--color-message-assistant': '#26262A',
      '--color-message-system': '#1C1C1E',
      '--color-scrollbar': '#3A3A3C',
      '--color-scrollbar-hover': '#48484A',
      // Sidebar colors
      '--color-sidebar': '#1C1C1E',
      '--color-sidebar-foreground': '#FFFFFF',
      '--color-sidebar-primary': '#0A84FF',
      '--color-sidebar-primary-foreground': '#FFFFFF',
      '--color-sidebar-accent': '#2C2C2E',
      '--color-sidebar-accent-foreground': '#FFFFFF',
      '--color-sidebar-border': '#38383A',
      '--color-sidebar-ring': '#0A84FF',
      // Chart colors
      '--color-chart-1': '#0A84FF',
      '--color-chart-2': '#30D158',
      '--color-chart-3': '#BF5AF2',
      '--color-chart-4': '#FF9F0A',
      '--color-chart-5': '#64D2FF',
    },
  },
  'corgi-light': {
    name: 'corgi-light',
    label: 'Light',
    colors: {
      '--color-background': '#FFFFFF',
      '--color-foreground': '#000000',
      '--color-card': '#F2F2F7',
      '--color-card-foreground': '#000000',
      '--color-popover': '#FFFFFF',
      '--color-popover-foreground': '#000000',
      '--color-primary': '#007AFF',
      '--color-primary-foreground': '#FFFFFF',
      '--color-secondary': '#E5E5EA',
      '--color-secondary-foreground': '#000000',
      '--color-muted': '#F2F2F7',
      '--color-muted-foreground': '#8E8E93',
      '--color-accent': '#E5E5EA',
      '--color-accent-foreground': '#000000',
      '--color-destructive': '#FF3B30',
      '--color-destructive-foreground': '#FFFFFF',
      '--color-border': '#C6C6C8',
      '--color-input': '#E5E5EA',
      '--color-ring': '#007AFF',
      '--color-green': '#34C759',
      '--color-red': '#FF3B30',
      '--color-orange': '#FF9500',
      '--color-purple': '#AF52DE',
      '--color-info': '#5AC8FA',
      '--color-message-user': '#007AFF',
      '--color-message-user-foreground': '#FFFFFF',
      '--color-message-assistant': '#E9E9EB',
      '--color-message-system': '#F2F2F7',
      '--color-scrollbar': '#C6C6C8',
      '--color-scrollbar-hover': '#AEAEB2',
      // Sidebar colors
      '--color-sidebar': '#F2F2F7',
      '--color-sidebar-foreground': '#000000',
      '--color-sidebar-primary': '#007AFF',
      '--color-sidebar-primary-foreground': '#FFFFFF',
      '--color-sidebar-accent': '#E5E5EA',
      '--color-sidebar-accent-foreground': '#000000',
      '--color-sidebar-border': '#C6C6C8',
      '--color-sidebar-ring': '#007AFF',
      // Chart colors
      '--color-chart-1': '#007AFF',
      '--color-chart-2': '#34C759',
      '--color-chart-3': '#AF52DE',
      '--color-chart-4': '#FF9500',
      '--color-chart-5': '#5AC8FA',
    },
  },
};

/** All available theme names as a typed array. */
export const themeNames = Object.keys(themes) as ThemeName[];

// Highlight.js theme mapping
const hljsThemes: Record<ThemeName, string> = {
  'corgi': 'github-dark-dimmed',
  'corgi-light': 'github',
};

/** Apply a theme by setting CSS custom properties on the document root and loading the matching highlight.js stylesheet. */
export function applyTheme(themeName: ThemeName): void {
  const theme = themes[themeName];
  if (!theme) return;
  
  const root = document.documentElement;
  Object.entries(theme.colors).forEach(([property, value]) => {
    // Set the --color-* property
    root.style.setProperty(property, value);
    
    // Also set the base property (without --color- prefix) for :root vars
    // e.g., --color-background -> --background
    if (property.startsWith('--color-')) {
      const baseProperty = '--' + property.slice(8); // Remove '--color-' prefix
      root.style.setProperty(baseProperty, value);
    }
  });

  // Apply highlight.js theme (vendored locally to avoid CDN dependency)
  const hljsTheme = hljsThemes[themeName];
  const existingLink = document.getElementById('hljs-theme') as HTMLLinkElement | null;
  const hljsHref = `/hljs/${hljsTheme}.min.css`;
  
  if (existingLink) {
    if (existingLink.getAttribute('href') !== hljsHref) {
      existingLink.href = hljsHref;
    }
  } else {
    const link = document.createElement('link');
    link.id = 'hljs-theme';
    link.rel = 'stylesheet';
    link.href = hljsHref;
    document.head.appendChild(link);
  }
}
