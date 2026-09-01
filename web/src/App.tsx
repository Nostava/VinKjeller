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
import SharePage from './pages/SharePage';
import FridgePage from './pages/FridgePage';
import { IconBrew, IconCellar, IconDrinks, IconScan, IconWaffle } from './components/icons';
import { Dialog, Heading } from '@digdir/designsystemet-react';

export type Tab = 'cellar' | 'drinks' | 'scan' | 'settings' | 'brew' | 'fridge';

// Party share links: /j/<token> is a public read-only cellar view (no login).
const shareMatch = () => window.location.pathname.match(/^\/j\/([a-z0-9]{8,})$/i);

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
  const [menuOpen, setMenuOpen] = useState(false);

  // Loads cellars, keeps the active one valid, then loads its items.
  // `cid` is the preferred cellar id. When none is (yet) chosen, prefer a
  // cellar that actually has bottles — a freshly invited member otherwise
  // lands on their own empty home cellar instead of the shared one.
  const refreshAll = useCallback(async (cid: string | null) => {
    const cs = await api.cellars();
    setCellars(cs.items);
    const active = cs.items.some((c) => c.id === cid)
      ? cid
      : (cs.items.find((c) => c.itemCount > 0) ?? cs.items[0])?.id ?? null;
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

  const sh = shareMatch();
  if (sh) {
    return <SharePage token={sh[1]} />;
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
  ];

  return (
    <div className="app">
      <header className="app-header">
        <button
          className="app-title"
          onClick={() => setTab('cellar')}
          aria-label={t('nav.cellar')}
          title={t('nav.cellar')}
        >
          <h1>{t('app.name')}</h1>
        </button>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <span className="muted">{user.name ?? user.email}</span>
          <button
            onClick={() => setMenuOpen(true)}
            aria-label={t('menu.title')}
            title={t('menu.title')}
            className="header-icon-btn"
          >
            <IconWaffle />
          </button>
        </span>
      </header>

      {/* waffle menu: settings + fridge (kept out of the bottom nav on purpose) */}
      <Dialog open={menuOpen} onClose={() => setMenuOpen(false)}>
        <Heading level={2} data-size="lg">{t('menu.title')}</Heading>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }} className="mt">
          <button
            onClick={() => { setMenuOpen(false); setTab('fridge'); }}
            style={{ border: '1px solid var(--ds-color-border-subtle)', borderRadius: 12, padding: 16, background: 'var(--ds-color-background-subtle)', cursor: 'pointer', font: 'inherit', textAlign: 'center' }}
          >
            <div style={{ fontSize: 28 }} aria-hidden>🧊</div>
            <div style={{ fontWeight: 600, marginTop: 6 }}>{t('menu.fridge')}</div>
          </button>
          <button
            onClick={() => { setMenuOpen(false); setTab('settings'); }}
            style={{ border: '1px solid var(--ds-color-border-subtle)', borderRadius: 12, padding: 16, background: 'var(--ds-color-background-subtle)', cursor: 'pointer', font: 'inherit', textAlign: 'center' }}
          >
            <div style={{ fontSize: 28 }} aria-hidden>⚙️</div>
            <div style={{ fontWeight: 600, marginTop: 6 }}>{t('menu.settings')}</div>
          </button>
        </div>
      </Dialog>
      <main className="app-main">
        <div className="tab-page" key={tab}>
          {tab === 'cellar' && <CellarPage items={items} cellars={cellars} cellarId={cellarId} onSwitchCellar={switchCellar} onCellarsChanged={refresh} storeId={user.storeId} onRefresh={refresh} showToast={showToast} goScan={() => setTab('scan')} />}
          {tab === 'brew' && <BrewPage items={items} onRefresh={refresh} showToast={showToast} />}
          {tab === 'drinks' && <DrinksPage items={items} recipes={recipes} rounds={rounds} onRefresh={refresh} showToast={showToast} />}
          {tab === 'scan' && <ScanPage items={items} storeId={user.storeId} onRefresh={refresh} showToast={showToast} />}
          {tab === 'fridge' && <FridgePage items={items} onRefresh={refresh} showToast={showToast} />}
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
