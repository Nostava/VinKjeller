import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from './api';
import type { Cellar, CellarItem, Recipe, Round, User } from './types';
import AuthPage from './pages/AuthPage';
import CellarPage from './pages/CellarPage';
import DrinksPage from './pages/DrinksPage';
import ScanPage from './pages/ScanPage';
import BrewPage from './pages/BrewPage';
import SettingsPage from './pages/SettingsPage';
import { IconBrew, IconCellar, IconDrinks, IconScan, IconSettings } from './components/icons';

export type Tab = 'cellar' | 'drinks' | 'scan' | 'settings' | 'brew';

const CELLAR_KEY = 'vk_cellar';

export default function App() {
  const { t } = useTranslation();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('cellar');
  const [cellars, setCellars] = useState<Cellar[]>([]);
  const [cellarId, setCellarId] = useState<string | null>(null);
  const [items, setItems] = useState<CellarItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  // Loads cellars, keeps the active one valid, then loads its items.
  // `cid` is the preferred cellar id (falls back to the first cellar).
  const refreshAll = useCallback(async (cid: string | null) => {
    const cs = await api.cellars();
    setCellars(cs.items);
    const active = cs.items.some((c) => c.id === cid) ? cid : cs.items[0]?.id ?? null;
    if (active !== cid) {
      setCellarId(active);
      if (active) localStorage.setItem(CELLAR_KEY, active);
    }
    const [c, r, ro] = await Promise.all([api.cellar(active), api.recipes(), api.rounds()]);
    setItems(c.items);
    setRecipes(r.items);
    setRounds(ro.items);
  }, []);

  const refresh = useCallback(() => refreshAll(cellarId), [refreshAll, cellarId]);

  function switchCellar(id: string) {
    setCellarId(id);
    localStorage.setItem(CELLAR_KEY, id);
    refreshAll(id).catch(() => {});
  }

  useEffect(() => {
    (async () => {
      try {
        const u = await api.me();
        setUser(u);
        if (u) await refreshAll(localStorage.getItem(CELLAR_KEY));
      } catch { /* not logged in */ } finally {
        setLoading(false);
      }
    })();
  }, [refreshAll]);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  }

  function onAuthed(u: User) {
    setUser(u);
    refreshAll(localStorage.getItem(CELLAR_KEY)).catch(() => {});
  }

  if (loading) {
    return (
      <div className="app">
        <div className="app-main"><span className="muted">{t('common.loading')}</span></div>
      </div>
    );
  }

  if (!user) {
    return <AuthPage onAuthed={onAuthed} />;
  }

  const navItems: { id: Tab; icon: React.ComponentType; label: string }[] = [
    { id: 'cellar', icon: IconCellar, label: t('nav.cellar') },
    { id: 'brew', icon: IconBrew, label: t('nav.brew') },
    { id: 'drinks', icon: IconDrinks, label: t('nav.drinks') },
    { id: 'scan', icon: IconScan, label: t('nav.scan') },
    { id: 'settings', icon: IconSettings, label: t('nav.settings') },
  ];

  return (
    <div className="app">
      <header className="app-header">
        <h1>{t('app.name')}</h1>
        <span className="muted">{user.name ?? user.email}</span>
      </header>
      <main className="app-main">
        <div className="tab-page" key={tab}>
          {tab === 'cellar' && <CellarPage items={items} cellars={cellars} cellarId={cellarId} onSwitchCellar={switchCellar} onCellarsChanged={refresh} storeId={user.storeId} onRefresh={refresh} showToast={showToast} goScan={() => setTab('scan')} />}
          {tab === 'brew' && <BrewPage items={items} onRefresh={refresh} showToast={showToast} />}
          {tab === 'drinks' && <DrinksPage items={items} recipes={recipes} rounds={rounds} onRefresh={refresh} showToast={showToast} />}
          {tab === 'scan' && <ScanPage items={items} storeId={user.storeId} onRefresh={refresh} showToast={showToast} />}
          {tab === 'settings' && <SettingsPage user={user} onLogout={() => setUser(null)} showToast={showToast} onSaved={(u) => setUser(u)} />}
        </div>
      </main>
      <nav className="bottom-nav">
        {navItems.map((n) => (
          <button key={n.id} onClick={() => setTab(n.id)} aria-current={tab === n.id ? 'page' : undefined}>
            <n.icon />
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
      {toast && (
        <div className="toast" role="status">
          <div style={{ padding: '12px 20px', borderRadius: 12, background: 'var(--ds-color-accent-base-default)', color: 'var(--ds-color-accent-base-contrast-default)', fontWeight: 600 }}>
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}
