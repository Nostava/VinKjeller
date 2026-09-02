import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Dialog, Heading, Link, Tag } from '@digdir/designsystemet-react';
import { api } from '../api';
import type { CellarItem } from '../types';
import { parseBrewInfo } from '../types';
import { BottleThumb } from '../components/ui';

/** Read-only guest view behind a share link (/j/<token>). No login. */
export default function SharePage({ token }: { token: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<{ cellarName: string | null; expiresAt: string | null; items: CellarItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<CellarItem | null>(null);

  useEffect(() => {
    let live = true;
    api.shareView(token)
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'error'); });
    return () => { live = false; };
  }, [token]);

  if (error) {
    const expired = error === 'expired';
    return (
      <div className="app">
        <main className="app-main" style={{ padding: 24 }}>
          <Alert data-color={expired ? 'warning' : 'error'}>
            {expired ? t('share.expired_title') : t('share.notfound_title')}
          </Alert>
        </main>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="app">
        <main className="app-main" style={{ padding: 24 }}>
          <span className="muted">{t('common.loading')}</span>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>🍷 {data.cellarName ?? t('share.title')}</h1>
        <span className="muted">{t('share.badge')}</span>
      </header>
      <main className="app-main" style={{ paddingBottom: 24 }}>
        {data.expiresAt && (
          <p className="muted" style={{ fontSize: 13 }}>
            {t('share.until', { date: new Date(data.expiresAt).toLocaleString() })}
          </p>
        )}
        <p style={{ fontSize: 14 }}>{t('share.note')}</p>
        {(() => {
          // fridge items are toggles, not bottles — shown as chips above the grid
          const fridge = data.items
            .filter((i) => i.fridgeOn !== null && i.fridgeOn !== undefined)
            .sort((a, b) => (a.customName ?? '').localeCompare(b.customName ?? '', 'nb'));
          const bottles = data.items.filter((i) => i.fridgeOn === null || i.fridgeOn === undefined);
          if (fridge.length === 0 && bottles.length === 0) {
            return <Alert data-color="info">{t('share.empty')}</Alert>;
          }
          return (
            <>
              {fridge.length > 0 && (
                <div className="mb">
                  <Heading level={2} data-size="md">🧊 {t('share.fridge')}</Heading>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                    {fridge.map((f) => {
                      const on = f.fridgeOn === 1;
                      return (
                        <span
                          key={f.id}
                          title={on ? t('fridge.on') : t('fridge.off')}
                          style={{
                            border: '1px solid var(--ds-color-border-subtle)', borderRadius: 999,
                            padding: '4px 12px', fontSize: 13,
                            opacity: on ? 1 : 0.55,
                            textDecoration: on ? 'none' : 'line-through',
                          }}
                        >
                          {f.customName}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
              {bottles.length > 0 && (
                <div className="bottle-grid">
                  {bottles.map((it, idx) => (
                    <GuestCard key={it.id} item={it} index={idx} onClick={() => setSel(it)} />
                  ))}
                </div>
              )}
            </>
          );
        })()}
      </main>

      {sel && (
        <Dialog open closedby="any" onClose={() => setSel(null)}>
          <GuestDetail item={data.items.find((i) => i.id === sel.id) ?? sel} />
        </Dialog>
      )}
    </div>
  );
}

function GuestCard({ item, index, onClick }: { item: CellarItem; index: number; onClick: () => void }) {
  const b = parseBrewInfo(item.brewInfo);
  const name = item.customName ?? item.product?.name ?? item.vmProductId ?? '';
  const sub = [
    b?.style,
    item.customAbv != null ? `${item.customAbv}%` : item.product?.abv != null ? `${item.product.abv}%` : null,
    item.customType ?? item.product?.subCategory ?? item.product?.category ?? null,
  ].filter(Boolean).join(' · ');

  return (
    <button
      onClick={onClick}
      style={{
        '--i': index,
        display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left',
        border: '1px solid var(--ds-color-border-subtle)', borderRadius: 12,
        padding: 12, background: 'var(--ds-color-accent-background-default)', cursor: 'pointer',
      } as React.CSSProperties}
    >
      <BottleThumb item={item} />
      <strong style={{ fontSize: 14, lineHeight: 1.3 }}>{b ? '🍺 ' : ''}{name}</strong>
      {sub && <span className="muted" style={{ fontSize: 12 }}>{sub}</span>}
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {item.product?.vintage && <Tag variant="outline">{item.product.vintage}</Tag>}
        {b?.brewDate && <Tag variant="outline">🍺 {b.brewDate}</Tag>}
      </div>
    </button>
  );
}

/** Read-only detail for guests: the facts, no actions. */
function GuestDetail({ item }: { item: CellarItem }) {
  const { t } = useTranslation();
  const b = parseBrewInfo(item.brewInfo);
  const name = item.customName ?? item.product?.longName ?? item.product?.name ?? item.vmProductId ?? '';
  const added = new Date(item.addedAt).toLocaleDateString('nb-NO');
  const abv = item.customAbv ?? item.product?.abv;
  const vol = item.customVolumeCl ?? item.product?.volumeCl;
  const row = (label: string, value: string | number | null) =>
    value === null || value === undefined || value === '' ? null : (
      <div className="ing-row" key={label}>
        <span className="muted">{label}</span>
        <strong>{value}</strong>
      </div>
    );

  return (
    <div>
      <div className="row">
        <BottleThumb item={item} />
        <div style={{ flex: 1 }}>
          <Heading level={2} data-size="lg">{b ? '🍺 ' : ''}{name}</Heading>
          <span className="muted">{item.customType ?? item.product?.subCategory ?? item.product?.category}</span>
          <div className="mt">
            {item.product && (
              <Link href={`https://www.vinmonopolet.no/p/${item.product.vmProductId}`} target="_blank" rel="noopener noreferrer">
                {t('bottle.se_vm')} ↗
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="mt">
        {row(t('bottle.abv'), abv != null ? abv + ' %' : null)}
        {row(t('bottle.volume'), vol != null ? vol + ' cl' : null)}
        {row(t('bottle.category'), item.product?.subCategory ?? item.product?.category ?? null)}
        {row(t('bottle.country'), [item.product?.country, item.product?.region, item.product?.subRegion].filter(Boolean).join(' / '))}
        {row(t('bottle.vintage'), item.product?.vintage ?? null)}
        {b && <>
          {row(t('brew.style'), b.style ?? null)}
          {row(t('brew.gravity'), [b.og != null ? 'OG ' + b.og : null, b.fg != null ? 'FG ' + b.fg : null].filter(Boolean).join(' · ') || null)}
          {row(t('brew.ibu'), b.ibu ?? null)}
          {row(t('brew.brewed'), b.brewDate ?? null)}
          {row(t('brew.carbonation'), b.carbonation === 'light' ? t('brew.carb_light') : b.carbonation === 'full' ? t('brew.carb_full') : t('brew.carb_medium'))}
          {row(t('brew.malt'), b.malt ?? null)}
          {row(t('brew.hops'), b.hops ?? null)}
          {row(t('brew.yeast'), b.yeast ?? null)}
        </>}
        {row(t('bottle.added'), added)}
        {item.note && <div className="ing-row"><span className="muted">{t('bottle.note')}</span><span>{item.note}</span></div>}
      </div>
    </div>
  );
}
