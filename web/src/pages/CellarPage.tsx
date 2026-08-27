import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert, Button, Dialog, Heading, Label, Link, Radio, Select, Spinner, Tabs, Tag,
} from '@digdir/designsystemet-react';
import { Input } from '@digdir/designsystemet-react';
import { api } from '../api';
import type { CellarItem, Product } from '../types';
import { BottleThumb, CustomItemForm, ProductFacts, useDebounce } from '../components/ui';

type SortKey = 'recent' | 'shelf' | 'name' | 'price';

export default function CellarPage({ items, onRefresh, showToast, goScan }: {
  items: CellarItem[];
  onRefresh: () => Promise<void>;
  showToast: (m: string) => void;
  goScan: () => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [selected, setSelected] = useState<CellarItem | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = items.filter((it) => {
      if (!q) return true;
      const hay = [it.customName, it.product?.name, it.product?.longName, it.product?.category, it.product?.country]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
    const label = (it: CellarItem) => it.customName ?? it.product?.name ?? it.product?.longName ?? '';
    switch (sort) {
      case 'shelf': return [...list].sort((a, b) => a.addedAt.localeCompare(b.addedAt));
      case 'name': return [...list].sort((a, b) => label(a).localeCompare(label(b), 'nb'));
      case 'price': return [...list].sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
      default: return [...list].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    }
  }, [items, filter, sort]);

  const totalValue = useMemo(
    () => items.reduce((s, it) => s + (it.price ?? 0), 0),
    [items],
  );

  return (
    <div>
      <div className="row mb">
        <Heading level={1} data-size="lg">{t('cellar.title')}</Heading>
        <span className="spacer" />
        <span className="muted">{t('cellar.value')}: <strong>{Math.round(totalValue)} kr</strong></span>
      </div>

      {items.length > 0 && (
        <div className="row mb" style={{ flexWrap: 'wrap' }}>
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('cellar.filter_ph')}
            aria-label={t('cellar.filter_ph')}
            style={{ flex: 1, minWidth: 200 }}
          />
          <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label={t('cellar.sort_recent')} style={{ width: 200 }}>
            <option value="recent">{t('cellar.sort_recent')}</option>
            <option value="shelf">{t('cellar.sort_shelf')}</option>
            <option value="name">{t('cellar.sort_name')}</option>
            <option value="price">{t('cellar.sort_price')}</option>
          </Select>
        </div>
      )}

      {items.length === 0 ? (
        <Alert data-color="info">
          {t('cellar.empty')}
          <div className="mt">
            <Button variant="primary" onClick={goScan}>{t('nav.scan')}</Button>
          </div>
        </Alert>
      ) : (
        <div className="bottle-grid">
          {filtered.map((it) => (
            <BottleCard key={it.id} item={it} onClick={() => setSelected(it)} />
          ))}
        </div>
      )}

      <div className="mt">
        <Button variant="secondary" onClick={() => setShowAdd(true)}>＋ {t('cellar.add')}</Button>
      </div>

      <Dialog open={showAdd} onClose={() => setShowAdd(false)}>
        <AddDialog
          onClose={() => setShowAdd(false)}
          showToast={showToast}
          onDone={async () => { await onRefresh(); setShowAdd(false); showToast('✔'); }}
        />
      </Dialog>

      {selected && (
        <Dialog open onClose={() => setSelected(null)}>
          <BottleDialog
            item={selected}
            onClose={() => setSelected(null)}
            onTakenOut={async (reason) => {
              await api.removeBottle(selected.id, reason);
              setSelected(null);
              await onRefresh();
            }}
          />
        </Dialog>
      )}
    </div>
  );
}

function pseudoItem(p: Product): CellarItem {
  return {
    id: 'pseudo-' + p.vmProductId,
    source: 'vm',
    vmProductId: p.vmProductId,
    customName: null, customType: null, customAbv: null, customVolumeCl: null,
    price: p.price, photoUrl: null, note: null,
    addedAt: new Date().toISOString(), removedAt: null, removedReason: null,
    product: p,
  };
}

function BottleCard({ item, onClick }: { item: CellarItem; onClick: () => void }) {
  const { t } = useTranslation();
  const name = item.customName ?? item.product?.name ?? t('bottle.no_data');
  const sub = item.customType ?? item.product?.subCategory ?? item.product?.category ?? '';
  const months = Math.max(0, Math.floor((Date.now() - new Date(item.addedAt).getTime()) / (30.44 * 86400000)));
  const pop = item.popularity;

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left',
        border: '1px solid var(--ds-color-border-subtle)', borderRadius: 12,
        padding: 12, background: 'var(--ds-color-accent-background-default)', cursor: 'pointer',
      }}
    >
      <BottleThumb item={item} />
      <strong style={{ fontSize: 14, lineHeight: 1.3 }}>{name}</strong>
      <span className="muted" style={{ fontSize: 12 }}>{sub}</span>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <Tag variant="outline">{t('cellar.shelf')} {t('cellar.shelf_months', { count: months })}</Tag>
        {pop && pop.items > 500 && (
          <Tag>⭐ {t('cellar.popular')}</Tag>
        )}
      </div>
    </button>
  );
}

function AddDialog({ onClose, onDone, showToast }: { onClose: () => void; onDone: () => void; showToast: (m: string) => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'vm' | 'custom'>('vm');
  const [q, setQ] = useState('');
  const dq = useDebounce(q);
  const [results, setResults] = useState<{ vmProductId: string; name: string | null }[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState<Product | null>(null);
  const [loadingProd, setLoadingProd] = useState(false);
  const [mode, setMode] = useState<'search' | 'product'>('search');

  async function doSearch() {
    if (dq.trim().length < 2) return;
    setSearching(true);
    try {
      const res = await api.searchProducts(dq.trim());
      setResults(res.items);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function pick(prod: { vmProductId: string; name: string | null }) {
    setLoadingProd(true);
    setMode('product');
    try {
      const res = await api.product(prod.vmProductId);
      setChosen(res.product ?? { ...prod, longName: null, category: null, subCategory: null, country: null, region: null, subRegion: null, abv: null, volumeCl: null, price: null, vintage: null, grapes: null, description: null, imageUrls: null, extra: null, fetchedAt: null });
    } catch {
      setChosen({ ...prod, longName: null, category: null, subCategory: null, country: null, region: null, subRegion: null, abv: null, volumeCl: null, price: null, vintage: null, grapes: null, description: null, imageUrls: null, extra: null, fetchedAt: null });
    } finally {
      setLoadingProd(false);
    }
  }

  async function addVm() {
    if (!chosen) return;
    try {
      await api.addBottle({ source: 'vm', vmProductId: chosen.vmProductId, price: chosen.price });
      onDone();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Feil');
    }
  }

  // trigger search on debounced text
  const [lastQ, setLastQ] = useState('');
  if (dq !== lastQ && dq.trim().length >= 2 && mode === 'search') {
    setLastQ(dq);
    doSearch();
  }

  return (
    <div>
      <Heading level={2} data-size="lg">{t('cellar.add')}</Heading>
      <div className="mt">
        <Tabs defaultValue="vm">
          <Tabs.List aria-label={t('cellar.add')}>
            <Tabs.Tab value="vm">Vinmonopol</Tabs.Tab>
            <Tabs.Tab value="custom">{t('scan.add_custom')}</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="vm">
            {mode === 'search' ? (
              <div style={{ display: 'grid', gap: 12 }}>
                <Input
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setResults(null); }}
                  placeholder="Søk i Vinmonopol… (f.eks. Angostura)"
                  aria-label={t('common.search')}
                  autoFocus
                />
                {searching && <Spinner aria-label={t('common.loading')} />}
                {results && results.length === 0 && (
                  <Alert data-color="warning">
                    <strong>{t('scan.not_found')}</strong><br />
                    {t('scan.not_found_hint')}
                  </Alert>
                )}
                {results && results.length > 0 && (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
                    {results.slice(0, 10).map((r) => (
                      <li key={r.vmProductId}>
                        <Button variant="secondary" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => pick(r)}>
                          {r.name ?? r.vmProductId}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                {loadingProd ? <Spinner aria-label={t('common.loading')} /> : chosen && (
                  <>
                    <BottleThumb item={pseudoItem(chosen)} />
                    <strong>{chosen.longName ?? chosen.name}</strong>
                    <ProductFacts product={chosen} />
                    <Button variant="primary" onClick={addVm}>＋ {t('scan.add')}</Button>
                  </>
                )}
                <Button variant="tertiary" onClick={() => { setMode('search'); setChosen(null); }}>{t('common.cancel')}</Button>
              </div>
            )}
          </Tabs.Panel>
          <Tabs.Panel value="custom">
            <CustomItemForm onSaved={onDone} onCancel={onClose} />
          </Tabs.Panel>
        </Tabs>
      </div>
    </div>
  );
}

function BottleDialog({ item, onClose, onTakenOut }: {
  item: CellarItem;
  onClose: () => void;
  onTakenOut: (reason: string) => void;
}) {
  const { t } = useTranslation();
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState('drank');
  const name = item.customName ?? item.product?.longName ?? item.product?.name ?? item.vmProductId ?? '';
  const added = new Date(item.addedAt).toLocaleDateString('nb-NO');

  return (
    <div>
      <div className="row">
        <BottleThumb item={item} />
        <div style={{ flex: 1 }}>
          <Heading level={2} data-size="lg">{name}</Heading>
          <span className="muted">{item.customType ?? item.product?.category}</span>
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
        {item.product ? (
          <ProductFacts product={item.product} />
        ) : (
          <>
            {item.customAbv !== null && <div className="ing-row"><span className="muted">{t('bottle.abv')}</span><strong>{item.customAbv}%</strong></div>}
            {item.customVolumeCl !== null && <div className="ing-row"><span className="muted">{t('bottle.volume')}</span><strong>{item.customVolumeCl} cl</strong></div>}
            <div className="ing-row"><span className="muted">{t('bottle.added')}</span><strong>{added}</strong></div>
          </>
        )}
        {item.price !== null && <div className="ing-row"><span className="muted">{t('bottle.price')}</span><strong>{item.price} kr</strong></div>}
        <div className="ing-row"><span className="muted">{t('bottle.added')}</span><strong>{added}</strong></div>
        {item.note && <div className="ing-row"><span className="muted">{t('bottle.note')}</span><span>{item.note}</span></div>}
        {item.popularity && item.popularity.items > 0 && (
          <div className="ing-row"><span className="muted">Salg siste 12 mnd</span><strong>{item.popularity.liters.toLocaleString('nb-NO')} L / {item.popularity.items.toLocaleString('nb-NO')} flasker</strong></div>
        )}
      </div>

      <div className="mt" style={{ display: 'grid', gap: 12 }}>
        <Heading level={3} data-size="md">{t('cellar.out_title')}</Heading>
        {(['drank', 'given', 'spoiled', 'other'] as const).map((r) => (
          <Radio
            key={r}
            id={`reason-${r}`}
            name="reason"
            label={t(`cellar.reason_${r}`)}
            checked={reason === r}
            onChange={() => setReason(r)}
          />
        ))}
        <div className="row">
          <Button variant="primary" loading={removing} onClick={async () => { setRemoving(true); onTakenOut(reason); }}>
            {t('cellar.out')}
          </Button>
          <Button variant="tertiary" onClick={onClose}>{t('common.close')}</Button>
        </div>
      </div>
    </div>
  );
}
