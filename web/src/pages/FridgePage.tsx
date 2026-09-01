import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Heading, Input, Spinner, Switch } from '@digdir/designsystemet-react';
import { api } from '../api';
import type { CellarItem } from '../types';
import { isFridgeItem } from '../lib/match';
import nb from '../i18n/nb.json';

/** The fridge: non-alcoholics (orange juice, water, sugar, …) as simple
 *  toggles. Stored as cellar items, so cellar members and share-link
 *  guests see exactly what's in the fridge — and the drink check counts
 *  an ON item as available (infinite supply, no cl-math). */
export default function FridgePage({ items, onRefresh, showToast }: {
  items: CellarItem[];
  onRefresh: () => Promise<void>;
  showToast: (m: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fridge = items
    .filter(isFridgeItem)
    .sort((a, b) => (a.customName ?? '').localeCompare(b.customName ?? '', 'nb'));

  async function add() {
    const n = name.trim();
    if (!n) return;
    // same juice twice? flip the toggle instead
    const existing = fridge.find((f) => (f.customName ?? '').trim().toLowerCase() === n.toLowerCase());
    if (existing) {
      if (existing.fridgeOn === 1) {
        showToast(t('fridge.dupe'));
        return;
      }
      await toggle(existing);
      setName('');
      return;
    }
    setBusy(true);
    try {
      await api.addBottle({ source: 'custom', customName: n, fridge: true });
      setName('');
      await onRefresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(item: CellarItem) {
    setTogglingId(item.id);
    try {
      await api.updateBottle(item.id, { fridgeOn: item.fridgeOn !== 1 });
      await onRefresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setTogglingId(null);
    }
  }

  async function remove(item: CellarItem) {
    try {
      await api.removeBottle(item.id, 'removed');
      await onRefresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('common.error'));
    }
  }

  return (
    <div>
      <div className="row mb" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Heading level={1} data-size="lg">{t('fridge.title')}</Heading>
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>{t('fridge.hint')}</p>

      <div className="row" style={{ marginBottom: 16 }}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          list="fridge-names"
          placeholder={t('fridge.add_ph')}
          aria-label={t('fridge.add_ph')}
          style={{ flex: 1 }}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
        />
        <datalist id="fridge-names">
          {Object.keys(nb.ing).map((k) => (
            <option key={k} value={t('ing.' + k)} />
          ))}
        </datalist>
        <Button variant="secondary" loading={busy} onClick={add}>＋ {t('fridge.add')}</Button>
      </div>

      {fridge.length === 0 ? (
        <Alert data-color="info">{t('fridge.empty')}</Alert>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {fridge.map((f) => {
            const on = f.fridgeOn === 1;
            return (
              <div
                key={f.id}
                className="row"
                style={{
                  justifyContent: 'space-between', alignItems: 'center', gap: 12,
                  border: '1px solid var(--ds-color-border-subtle)', borderRadius: 12, padding: '8px 14px',
                  opacity: on ? 1 : 0.6,
                }}
              >
                <div>
                  <strong style={{ fontSize: 15, textDecoration: on ? 'none' : 'line-through' }}>
                    {on ? '✅' : '⬜'} {f.customName}
                  </strong>
                  <div className="muted" style={{ fontSize: 12 }}>{on ? t('fridge.on') : t('fridge.off')}</div>
                </div>
                <div className="row" style={{ gap: 4 }}>
                  {togglingId === f.id && <Spinner aria-label={t('common.loading')} />}
                  <Switch
                    checked={on}
                    aria-label={`${f.customName} ${t('fridge.toggle')}`}
                    onChange={() => toggle(f)}
                  />
                  <Button variant="tertiary" onClick={() => remove(f)} aria-label={t('common.close')} style={{ padding: 4 }}>✕</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
