import { useCallback, useEffect, useRef, useState } from 'react';

export interface PluginItem {
  key: string;
  name: string;
  title: string;
  summary: string;
  version?: string;
  official: boolean;
  owner?: string;
  downloads?: number;
  categories: string[];
  icon?: string;
  installSpec: string;
}

export interface SkillItem {
  key: string;
  name: string;
  title: string;
  summary: string;
  owner?: string;
  downloads?: number;
  installRef: string;
  canonicalUrl?: string;
}

export type MarketplaceMode = 'plugins' | 'skills';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function normalizePlugin(raw: unknown): PluginItem | null {
  const r = asRecord(raw);
  // Feed entries carry { label, id, version, install.clawhubSpec }.
  const feedInstall = asRecord(r.install);
  if (typeof feedInstall.clawhubSpec === 'string') {
    return {
      key: String(r.id ?? feedInstall.clawhubSpec),
      name: String(r.id ?? r.label ?? ''),
      title: String(r.label ?? r.id ?? ''),
      summary: '',
      version: typeof r.version === 'string' ? r.version : undefined,
      official: false,
      categories: [],
      installSpec: feedInstall.clawhubSpec,
    };
  }
  // Search results carry { score, package: {...} }.
  const pkg = asRecord(r.package ?? r);
  const name = pkg.name;
  if (typeof name !== 'string') return null;
  const stats = asRecord(pkg.stats);
  return {
    key: name,
    name,
    title: String(pkg.displayName ?? name),
    summary: String(pkg.summary ?? ''),
    version: typeof pkg.latestVersion === 'string' ? pkg.latestVersion : undefined,
    official: pkg.isOfficial === true || pkg.ownerOfficial === true,
    owner: typeof pkg.ownerHandle === 'string' ? pkg.ownerHandle : undefined,
    downloads: typeof stats.downloads === 'number' ? stats.downloads : undefined,
    categories: Array.isArray(pkg.categories) ? pkg.categories.map(String) : [],
    icon: typeof pkg.icon === 'string' ? pkg.icon : undefined,
    installSpec: name,
  };
}

function normalizeSkill(raw: unknown): SkillItem | null {
  const r = asRecord(raw);
  const native = asRecord(r.native);
  const skill = asRecord(native.skill);
  const owner = typeof native.ownerHandle === 'string' ? native.ownerHandle : undefined;
  const slug = typeof skill.slug === 'string' ? skill.slug : undefined;
  const id = typeof r.id === 'string' ? r.id : undefined;
  if (!id) return null;
  return {
    key: id,
    name: id,
    title: String(r.displayName ?? skill.displayName ?? id),
    summary: String(skill.summary ?? '').replace(/\*\*/g, '').slice(0, 240),
    owner,
    downloads: typeof r.downloads === 'number' ? r.downloads : undefined,
    installRef: owner && slug ? `@${owner}/${slug}` : id,
    canonicalUrl: typeof r.canonicalUrl === 'string' ? r.canonicalUrl : undefined,
  };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** OpenClaw / ClawHub marketplace data + install actions. */
export function useMarketplace() {
  const [mode, setMode] = useState<MarketplaceMode>('plugins');
  const [query, setQuery] = useState('');
  const [plugins, setPlugins] = useState<PluginItem[]>([]);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reqRef = useRef(0);

  const load = useCallback(async (nextMode: MarketplaceMode, nextQuery: string, opts: { refresh?: boolean } = {}) => {
    const version = ++reqRef.current;
    setLoading(true);
    setError(null);
    try {
      if (nextMode === 'plugins') {
        const params = new URLSearchParams();
        if (nextQuery.trim()) params.set('q', nextQuery.trim());
        if (opts.refresh) params.set('refresh', '1');
        const res = await fetch(`/api/marketplace/plugins?${params.toString()}`);
        const body = await readJson(res);
        if (!res.ok || body.ok === false) throw new Error(String(body.error ?? `HTTP ${res.status}`));
        if (version !== reqRef.current) return;
        setPlugins((Array.isArray(body.results) ? body.results : []).map(normalizePlugin).filter((x): x is PluginItem => x !== null));
        setSource(typeof body.source === 'string' ? body.source : null);
      } else {
        const params = new URLSearchParams();
        if (nextQuery.trim()) params.set('q', nextQuery.trim());
        const res = await fetch(`/api/marketplace/skills?${params.toString()}`);
        const body = await readJson(res);
        if (!res.ok || body.ok === false) throw new Error(String(body.error ?? `HTTP ${res.status}`));
        if (version !== reqRef.current) return;
        setSkills((Array.isArray(body.results) ? body.results : []).map(normalizeSkill).filter((x): x is SkillItem => x !== null));
      }
    } catch (err) {
      if (version === reqRef.current) setError(err instanceof Error ? err.message : 'Failed to load marketplace');
    } finally {
      if (version === reqRef.current) setLoading(false);
    }
  }, []);

  // Initial feed load, then debounce search as the query changes.
  useEffect(() => {
    const handle = setTimeout(() => { void load(mode, query); }, query ? 350 : 0);
    return () => clearTimeout(handle);
  }, [mode, query, load]);

  const installPlugin = useCallback(async (spec: string) => {
    setInstalling(spec);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/marketplace/plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec }),
      });
      const body = await readJson(res);
      if (!res.ok || body.ok === false) throw new Error(String(body.error ?? `HTTP ${res.status}`));
      setNotice(`Installed ${spec}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Install failed');
    } finally {
      setInstalling(null);
    }
  }, []);

  const installSkill = useCallback(async (ref: string, agentId?: string) => {
    setInstalling(ref);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/marketplace/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref, agentId }),
      });
      const body = await readJson(res);
      if (!res.ok || body.ok === false) throw new Error(String(body.error ?? `HTTP ${res.status}`));
      setNotice(`Installed ${ref}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Install failed');
    } finally {
      setInstalling(null);
    }
  }, []);

  const refreshFeed = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/marketplace/plugins/refresh', { method: 'POST' });
      const body = await readJson(res);
      if (!res.ok || body.ok === false) throw new Error(String(body.error ?? `HTTP ${res.status}`));
      setPlugins((Array.isArray(body.results) ? body.results : []).map(normalizePlugin).filter((x): x is PluginItem => x !== null));
      setMode('plugins');
      setQuery('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    mode, setMode,
    query, setQuery,
    plugins, skills, source,
    loading, error, installing, notice,
    reload: () => load(mode, query),
    installPlugin, installSkill, refreshFeed,
  };
}

export type MarketplaceApi = ReturnType<typeof useMarketplace>;