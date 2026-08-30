import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from './api';
import type { CellarItem, Recipe, Round, User } from './types';
import AuthPage from './pages/AuthPage';
import CellarPage from './pages/CellarPage';
import DrinksPage from './pages/DrinksPage';
import ScanPage from './pages/ScanPage';
import SettingsPage from './pages/SettingsPage';
import { IconCellar, IconDrinks, IconScan, IconSettings } from './components/icons';

export type Tab = 'cellar' | 'drinks' | 'scan' | 'settings';

export default function App() {
  const { t } = useTranslation();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('cellar');
  const [items, setItems] = useState<CellarItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [c, r, ro] = await Promise.all([api.cellar(), api.recipes(), api.rounds()]);
    setItems(c.items);
    setRecipes(r.items);
    setRounds(ro.items);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const u = await api.me();
        setUser(u);
        if (u) await refresh();
      } catch { /* not logged in */ } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  }

  if (loading) {
    return (
      <div className="app">
        <div className="app-main"><span className="muted">{t('common.loading')}</span></div>
      </div>
    );
  }

  if (!user) {
    return <AuthPage onAuthed={(u) => { setUser(u); refresh().catch(() => {}); }} />;
  }

  const navItems: { id: Tab; icon: React.ComponentType; label: string }[] = [
    { id: 'cellar', icon: IconCellar, label: t('nav.cellar') },
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
        {tab === 'cellar' && <CellarPage items={items} storeId={user.storeId} onRefresh={refresh} showToast={showToast} goScan={() => setTab('scan')} />}
        {tab === 'drinks' && <DrinksPage items={items} recipes={recipes} rounds={rounds} onRefresh={refresh} showToast={showToast} />}
        {tab === 'scan' && <ScanPage items={items} storeId={user.storeId} onRefresh={refresh} showToast={showToast} />}
        {tab === 'settings' && <SettingsPage user={user} onLogout={() => setUser(null)} showToast={showToast} onSaved={(u) => setUser(u)} />}
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
