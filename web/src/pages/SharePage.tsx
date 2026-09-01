import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Heading, Tag } from '@digdir/designsystemet-react';
import { api } from '../api';
import type { CellarItem } from '../types';
import { parseBrewInfo } from '../types';
import { BottleThumb } from '../components/ui';

/** Read-only guest view behind a share link (/j/<token>). No login. */
export default function SharePage({ token }: { token: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<{ cellarName: string | null; expiresAt: string | null; items: CellarItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        {data.items.length === 0 ? (
          <Alert data-color="info">{t('share.empty')}</Alert>
        ) : (
          <div className="bottle-grid">
            {data.items.map((it, idx) => (
              <GuestCard key={it.id} item={it} index={idx} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function GuestCard({ item, index }: { item: CellarItem; index: number }) {
  const b = parseBrewInfo(item.brewInfo);
  const name = item.customName ?? item.product?.name ?? item.vmProductId ?? '';
  const sub = [
    b?.style,
    item.customAbv != null ? `${item.customAbv}%` : item.product?.abv != null ? `${item.product.abv}%` : null,
    item.customType ?? item.product?.subCategory ?? item.product?.category ?? null,
  ].filter(Boolean).join(' · ');

  return (
    <div
      style={{
        '--i': index,
        display: 'flex', flexDirection: 'column', gap: 8,
        border: '1px solid var(--ds-color-border-subtle)', borderRadius: 12,
        padding: 12, background: 'var(--ds-color-accent-background-default)',
      } as React.CSSProperties}
    >
      <BottleThumb item={item} />
      <strong style={{ fontSize: 14, lineHeight: 1.3 }}>{b ? '🍺 ' : ''}{name}</strong>
      {sub && <span className="muted" style={{ fontSize: 12 }}>{sub}</span>}
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {item.product?.vintage && <Tag variant="outline">{item.product.vintage}</Tag>}
        {b?.brewDate && <Tag variant="outline">🍺 {b.brewDate}</Tag>}
      </div>
    </div>
  );
}
