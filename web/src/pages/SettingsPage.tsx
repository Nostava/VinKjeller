import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Dialog, Heading, Label, Select, Input } from '@digdir/designsystemet-react';
import { api } from '../api';
import type { User } from '../types';
import { setLang } from '../i18n';

export default function SettingsPage({ user, onLogout, showToast, onSaved }: {
  user: User;
  onLogout: () => void;
  showToast: (m: string) => void;
  onSaved: (u: User) => void;
}) {
  const { t, i18n } = useTranslation();
  const [name, setName] = useState(user.name ?? '');
  const [lang, setLangState] = useState(i18n.language.slice(0, 2));
  const [theme, setThemeState] = useState(localStorage.getItem('vk_theme') ?? 'auto');
  const [storeId, setStoreId] = useState(user.storeId ?? '');
  const [storeQ, setStoreQ] = useState('');
  const [stores, setStores] = useState<{ storeId: string; name: string; city: string }[]>([]);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [purging, setPurging] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    api.stores().then((r) => setStores(r.stores)).catch(() => {});
  }, []);

  function applyTheme(v: string) {
    setThemeState(v);
    localStorage.setItem('vk_theme', v);
    // 'auto' is a real value — the DS theme follows the OS via
    // @media (prefers-color-scheme) when data-color-scheme='auto'.
    document.documentElement.dataset.colorScheme = v;
  }

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    try {
      const u = await api.updateMe({ name: name.trim() || undefined, storeId: storeId || null });
      onSaved(u);
      showToast(t('settings.saved'));
    } catch (ex) {
      showToast(ex instanceof Error ? ex.message : t('common.error'));
    }
  }

  const q = storeQ.trim().toLowerCase();
  const visibleStores = q
    ? stores.filter((s) => (s.name + ' ' + s.city).toLowerCase().includes(q))
    : stores;

  return (
    <div>
      <div className="row mb">
        <Heading level={1} data-size="lg">{t('settings.title')}</Heading>
      </div>

      <section className="mb">
        <Heading level={2} data-size="md">{t('settings.profile')}</Heading>
        <form onSubmit={saveName} className="mt" style={{ display: 'grid', gap: 12 }}>
          <div>
            <Label htmlFor="s-name">{t('settings.name')}</Label>
            <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="s-lang">{t('settings.lang')}</Label>
            <Select
              id="s-lang"
              value={lang}
              onChange={(e) => {
                const v = e.target.value;
                setLangState(v);
                setLang(v);
              }}
            >
              <option value="nb">Bokmål</option>
              <option value="nn">Nynorsk</option>
              <option value="en">English</option>
              <option value="vi">Tiếng Việt</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="s-theme">{t('settings.theme')}</Label>
            <Select id="s-theme" value={theme} onChange={(e) => applyTheme(e.target.value)}>
              <option value="auto">{t('settings.theme_auto')}</option>
              <option value="light">{t('settings.theme_light')}</option>
              <option value="dark">{t('settings.theme_dark')}</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="s-store">{t('settings.store')}</Label>
            <Input id="s-store-q" value={storeQ} onChange={(e) => setStoreQ(e.target.value)} placeholder={t('settings.store_search')} style={{ marginBottom: 8 }} />
            <Select id="s-store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="">{t('settings.store_none')}</option>
              {visibleStores.map((s) => (
                <option key={s.storeId} value={s.storeId}>{s.name}, {s.city}</option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="primary">{t('common.save')}</Button>
        </form>
      </section>

      <section className="mb">
        <Heading level={2} data-size="md">{t('settings.data')}</Heading>
        <p className="muted">{t('settings.purge_confirm')}</p>
        <Button variant="primary" onClick={() => setConfirmPurge(true)}>{t('settings.purge')}</Button>
      </section>

      <section className="mb">
        <Heading level={2} data-size="md">{t('settings.about')}</Heading>
        <p className="muted">{t('settings.about_text')}</p>
        <p className="muted">{t('settings.version')} 0.1.0</p>
      </section>

      <Button
        variant="tertiary"
        loading={loggingOut}
        onClick={async () => {
          setLoggingOut(true);
          try { await api.logout(); } catch { /* ignore */ }
          onLogout();
        }}
      >
        {t('settings.logout')}
      </Button>

      {confirmPurge && (
        <Dialog open onClose={() => setConfirmPurge(false)}>
          <Heading level={2} data-size="lg">{t('settings.purge')}</Heading>
          <p className="mt muted">{t('settings.purge_confirm')}</p>
          <div className="mt row">
            <Button
              variant="primary"
              loading={purging}
              onClick={async () => {
                setPurging(true);
                try {
                  await api.purge();
                  showToast(t('settings.purge_done'));
                } catch (e) {
                  showToast(e instanceof Error ? e.message : t('common.error'));
                } finally {
                  setPurging(false);
                  setConfirmPurge(false);
                }
              }}
            >
              {t('settings.purge')}
            </Button>
            <Button variant="tertiary" onClick={() => setConfirmPurge(false)}>{t('common.cancel')}</Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
