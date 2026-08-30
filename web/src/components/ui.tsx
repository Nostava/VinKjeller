import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Heading, Label, Input } from '@digdir/designsystemet-react';
import { api } from '../api';
import type { CellarItem, Product } from '../types';

export function useDebounce<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function thumbUrl(product: Product | null | undefined): string | null {
  if (!product?.imageUrls) return null;
  try {
    const arr = JSON.parse(product.imageUrls) as string[];
    const t = arr.find((u) => u.includes('300x300')) ?? arr[0];
    return t ?? null;
  } catch {
    return null;
  }
}

export function BottleThumb({ item, size = 'bottle-thumb' }: { item: CellarItem; size?: string }) {
  const url = item.photoUrl ?? thumbUrl(item.product);
  if (url) {
    return <img className={size} src={url} alt="" loading="lazy" />;
  }
  return (
    <div className={`${size} bottle-thumb-ph`} aria-hidden="true">
      🍾
    </div>
  );
}

/** Form for custom (non-Vinmonopol) items: homebrew beer, imported whiskey… */
export function CustomItemForm({ prefill, onSaved, onCancel }: {
  prefill?: string;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(prefill ?? '');
  const [type, setType] = useState('');
  const [abv, setAbv] = useState('');
  const [vol, setVol] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.addBottle({
        source: 'custom',
        customName: name.trim(),
        customType: type.trim() || null,
        customAbv: abv ? Number(abv) : null,
        customVolumeCl: vol ? Number(vol) : null,
        price: price ? Number(price) : null,
        note: note.trim() || null,
      });
      onSaved();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
      <div>
        <Label htmlFor="c-name">{t('custom.name')}</Label>
        <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div>
        <Label htmlFor="c-type">{t('custom.type')}</Label>
        <Input id="c-type" value={type} onChange={(e) => setType(e.target.value)} placeholder="Øl, whisky, juice…" />
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <div>
          <Label htmlFor="c-abv">{t('custom.abv')}</Label>
          <Input id="c-abv" type="number" step="0.1" min="0" max="100" value={abv} onChange={(e) => setAbv(e.target.value)} style={{ width: 120 }} />
        </div>
        <div>
          <Label htmlFor="c-vol">{t('custom.volume')}</Label>
          <Input id="c-vol" type="number" step="1" min="0" value={vol} onChange={(e) => setVol(e.target.value)} style={{ width: 120 }} />
        </div>
        <div>
          <Label htmlFor="c-price">{t('custom.price')}</Label>
          <Input id="c-price" type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 120 }} />
        </div>
      </div>
      <div>
        <Label htmlFor="c-note">{t('custom.note')}</Label>
        <Input id="c-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {err && <span className="muted" style={{ color: 'var(--ds-color-error-default)' }}>{err}</span>}
      <div className="row">
        <Button type="submit" variant="primary" loading={busy}>{t('custom.save')}</Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>{t('common.cancel')}</Button>
        )}
      </div>
    </form>
  );
}

/** Details for a product (vm) — shared by cellar/scan pages. */
export function ProductFacts({ product }: { product: Product }) {
  const { t } = useTranslation();
  const row = (label: string, value: string | number | null) =>
    value === null || value === undefined || value === '' ? null : (
      <div className="ing-row" key={label}>
        <span className="muted">{label}</span>
        <strong>{value}</strong>
      </div>
    );
  return (
    <div>
      {row(t('bottle.category'), [product.category, product.subCategory].filter(Boolean).join(' / '))}
      {row(t('bottle.abv'), product.abv !== null ? product.abv + ' %' : null)}
      {row(t('bottle.volume'), product.volumeCl !== null ? product.volumeCl + ' cl' : null)}
      {row(t('bottle.price'), product.price !== null ? product.price + ' kr' : null)}
      {row(t('bottle.country'), [product.country, product.region, product.subRegion].filter(Boolean).join(' / '))}
      {row(t('bottle.vintage'), product.vintage)}
      {product.description && (
        <p className="muted" style={{ marginTop: 12 }}>{product.description}</p>
      )}
    </div>
  );
}

export function Heading3({ children }: { children: React.ReactNode }) {
  return <Heading level={3} data-size="md">{children}</Heading>;
}

/** "Lager i butikk" line — live stock (my-products v1). Graceful hints in thin mode. */
export function StockLine({ productId, storeId }: { productId: string; storeId: string | null }) {
  const { t } = useTranslation();
  const [data, setData] = useState<{ stock: number | null; storeName: string | null; available: boolean } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!productId || !storeId) { setData(null); setFailed(false); return; }
    let on = true;
    setFailed(false);
    api.stock(productId, storeId)
      .then((r) => { if (on) setData({ stock: r.stock, storeName: r.storeName, available: r.available }); })
      .catch(() => { if (on) setFailed(true); });
    return () => { on = false; };
  }, [productId, storeId]);

  if (!productId) return null;
  if (!storeId) return <div className="ing-row"><span className="muted">🏬 {t('stock.pick_store')}</span></div>;
  if (failed || !data) return <div className="ing-row"><span className="muted">🏬 …</span></div>;
  if (!data.available || data.stock === null) return <div className="ing-row"><span className="muted">🏬 {t('stock.unavailable')}</span></div>;
  const store = data.storeName ?? '';
  return (
    <div className="ing-row">
      <span className="muted">🏬</span>
      <strong>{data.stock > 0 ? t('stock.at_store', { count: data.stock, store }) : t('stock.none', { store })}</strong>
    </div>
  );
}
