import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert, Button, Dialog, Heading, Label, Link, Radio, Select, Spinner, Tabs, Tag,
} from '@digdir/designsystemet-react';
import { Input } from '@digdir/designsystemet-react';
import { api } from '../api';
import type { Cellar, CellarItem, Product } from '../types';
import { BottleThumb, CustomItemForm, ProductFacts, StockLine, imageUrlFromSet, useDebounce } from '../components/ui';

type SortKey = 'recent' | 'shelf' | 'name';

export default function CellarPage({ items, cellars, cellarId, onSwitchCellar, onCellarsChanged, storeId, onRefresh, showToast, goScan }: {
  items: CellarItem[];
  cellars: Cellar[];
  cellarId: string | null;
  onSwitchCellar: (id: string) => void;
  onCellarsChanged: () => void;
  storeId: string | null;
  onRefresh: () => Promise<void>;
  showToast: (m: string) => void;
  goScan: () => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const [cat, setCat] = useState('');
  const [country, setCountry] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [selected, setSelected] = useState<CellarItem | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showPick, setShowPick] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const activeCellar = cellars.find((c) => c.id === cellarId) ?? null;

  // Filter options derived from what's actually in the cellar (they "light up"
  // as data becomes available — thin-mode products have no category/country).
  const cats = useMemo(
    () => [...new Set(items.map((i) => i.product?.category ?? (i.source === 'custom' ? i.customType : null)).filter(Boolean) as string[])]
      .sort((a, b) => a.localeCompare(b, 'nb')),
    [items]
  );
  const countries = useMemo(
    () => [...new Set(items.map((i) => i.product?.country).filter(Boolean) as string[])]
      .sort((a, b) => a.localeCompare(b, 'nb')),
    [items]
  );
  const hasFilters = !!(cat || country);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = items.filter((it) => {
      if (q) {
        const hay = [it.customName, it.product?.name, it.product?.longName, it.product?.category, it.product?.country]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (cat) {
        const c = it.product?.category ?? (it.source === 'custom' ? it.customType : null);
        if (c !== cat) return false;
      }
      if (country && it.product?.country !== country) return false;
      return true;
    });
    const label = (it: CellarItem) => it.customName ?? it.product?.name ?? it.product?.longName ?? '';
    switch (sort) {
      case 'shelf': return [...list].sort((a, b) => a.addedAt.localeCompare(b.addedAt));
      case 'name': return [...list].sort((a, b) => label(a).localeCompare(label(b), 'nb'));
      default: return [...list].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    }
  }, [items, filter, cat, country, sort]);

  return (
    <div>
      <div className="row mb" style={{ flexWrap: 'wrap' }}>
        <Heading level={1} data-size="lg">{t('cellar.title')}</Heading>
        {activeCellar && (
          <button
            onClick={() => setShowPick(true)}
            style={{
              border: '1px solid var(--ds-color-border-subtle)', borderRadius: 999, padding: '4px 12px',
              background: 'var(--ds-color-background-subtle)', color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: 13,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            🍷 {activeCellar.name}
            <span className="muted" aria-hidden>▾</span>
          </button>
        )}
        {activeCellar && (
          <Button variant="tertiary" onClick={() => setShowShare(true)}>🎉 {t('share.short')}</Button>
        )}
        <span className="spacer" />
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
          </Select>
        </div>
      )}

      {(cats.length > 0 || countries.length > 0) && items.length > 0 && (
        <div className="row mb" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {cats.length > 0 && (
            <Select value={cat} onChange={(e) => setCat(e.target.value)} aria-label={t('cellar.filter_category')} style={{ width: 'auto', maxWidth: 220 }}>
              <option value="">{t('cellar.filter_category')}: {t('cellar.filter_all')}</option>
              {cats.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          )}
          {countries.length > 0 && (
            <Select value={country} onChange={(e) => setCountry(e.target.value)} aria-label={t('cellar.filter_country')} style={{ width: 'auto', maxWidth: 220 }}>
              <option value="">{t('cellar.filter_country')}: {t('cellar.filter_all')}</option>
              {countries.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          )}
          {hasFilters && (
            <Button variant="tertiary" onClick={() => { setCat(''); setCountry(''); }}>✕ {t('cellar.clear_filters')}</Button>
          )}
        </div>
      )}

      {items.length === 0 ? (
        <>
          <Alert data-color="info">
            {t('cellar.empty')}
            <div className="mt">
              <Button variant="primary" onClick={goScan}>{t('nav.scan')}</Button>
            </div>
          </Alert>
          {/* you may be looking at the wrong cellar (e.g. your own empty home
              cellar while you're a member of someone else's) */}
          {cellars.filter((c) => c.id !== cellarId && c.itemCount > 0).map((c) => (
            <div key={c.id} className="row mt" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 13, flex: 1, overflowWrap: 'anywhere' }}>
                {t(`cellar.other_cellar_${c.itemCount === 1 ? 'one' : 'other'}`, {
                  name: c.name,
                  count: c.itemCount,
                  role: c.role === 'member' ? t('cellar.role_member') : t('cellar.role_owner'),
                })}
              </span>
              <Button variant="secondary" onClick={() => onSwitchCellar(c.id)}>{t('cellar.switch')}</Button>
            </div>
          ))}
        </>
      ) : (
        <div className="bottle-grid">
          {filtered.map((it, idx) => (
            <BottleCard key={it.id} item={it} index={idx} onClick={() => setSelected(it)} />
          ))}
        </div>
      )}

      <div className="mt">
        <Button variant="secondary" onClick={() => setShowAdd(true)}>＋ {t('cellar.add')}</Button>
      </div>

      <Dialog open={showAdd} onClose={() => setShowAdd(false)}>
        <AddDialog
          onClose={() => setShowAdd(false)}
          onRefresh={onRefresh}
          showToast={showToast}
          onDone={async () => { await onRefresh(); setShowAdd(false); showToast('✔'); }}
        />
      </Dialog>

      {activeCellar && (
        <Dialog open={showPick} onClose={() => setShowPick(false)}>
          <CellarPicker
            cellars={cellars}
            cellarId={cellarId}
            onSwitch={(id) => { onSwitchCellar(id); setShowPick(false); }}
            onChanged={onCellarsChanged}
            showToast={showToast}
          />
        </Dialog>
      )}

      {activeCellar && (
        <Dialog open={showShare} onClose={() => setShowShare(false)}>
          <ShareDialog cellarId={activeCellar.id} cellarName={activeCellar.name} showToast={showToast} />
        </Dialog>
      )}

      {selected && (
        <Dialog open onClose={() => setSelected(null)}>
          <BottleDialog
            item={items.find((i) => i.id === selected.id) ?? selected}
            storeId={storeId}
            onClose={() => setSelected(null)}
            onChanged={onRefresh}
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
    price: p.price, photoUrl: null, note: null, brewInfo: null, boughtAt: null,
    addedAt: new Date().toISOString(), removedAt: null, removedReason: null,
    product: p,
  };
}

function BottleCard({ item, index, onClick }: { item: CellarItem; index: number; onClick: () => void }) {
  const { t } = useTranslation();
  const name = item.customName ?? item.product?.name ?? t('bottle.no_data');
  const sub = item.customType ?? item.product?.subCategory ?? item.product?.category ?? '';
  const isBrew = !!item.brewInfo;
  // shelf age counts from the (editable) buy date, falling back to addedAt
  const months = Math.max(0, Math.floor((Date.now() - new Date(item.boughtAt ?? item.addedAt).getTime()) / (30.44 * 86400000)));

  return (
    <button
      onClick={onClick}
      style={{
        '--i': index, // stagger delay for the entrance animation (app.css)
        display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left',
        border: '1px solid var(--ds-color-border-subtle)', borderRadius: 12,
        padding: 12, background: 'var(--ds-color-accent-background-default)', cursor: 'pointer',
      } as React.CSSProperties}
    >
      <BottleThumb item={item} />
      <strong style={{ fontSize: 14, lineHeight: 1.3 }}>{isBrew ? '🍺 ' : ''}{name}</strong>
      <span className="muted" style={{ fontSize: 12 }}>{sub}</span>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <Tag variant="outline">{t('cellar.shelf')} {t('cellar.shelf_months', { count: months })}</Tag>
      </div>
    </button>
  );
}

function AddDialog({ onClose, onDone, onRefresh, showToast }: { onClose: () => void; onDone: () => void; onRefresh: () => Promise<void>; showToast: (m: string) => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'vm' | 'custom'>('vm');
  const [q, setQ] = useState('');
  const dq = useDebounce(q);
  const [results, setResults] = useState<{ vmProductId: string; name: string | null; imageUrls: string | null }[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState<Product | null>(null);
  const [loadingProd, setLoadingProd] = useState(false);
  const [qty, setQty] = useState(1);
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

  async function pick(prod: { vmProductId: string; name: string | null; imageUrls: string | null }) {
    setLoadingProd(true);
    setMode('product');
    setQty(1);
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
      await api.addBottle({ source: 'vm', vmProductId: chosen.vmProductId, price: chosen.price, qty });
      // stay open and reset for the next product — adding a full shelf
      // should not mean hunting for the button 20 times
      setQ('');
      setLastQ('');
      setResults(null);
      setChosen(null);
      setMode('search');
      setQty(1);
      await onRefresh();
      showToast('✔');
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
                    {results.slice(0, 10).map((r) => {
                      // thumbnails matter: same name, different bottle
                      const img = imageUrlFromSet(r.imageUrls);
                      return (
                        <li key={r.vmProductId}>
                          <Button variant="secondary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 8 }} onClick={() => pick(r)}>
                            {img && (
                              <img
                                src={img}
                                alt=""
                                style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 6, background: 'var(--ds-color-background-tinted)', flexShrink: 0 }}
                              />
                            )}
                            <span style={{ textAlign: 'left' }}>{r.name ?? r.vmProductId}</span>
                          </Button>
                        </li>
                      );
                    })}
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
                    <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                      <div className="row" style={{ alignItems: 'center', gap: 4 }}>
                        <Button variant="tertiary" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="−">−</Button>
                        <span style={{ minWidth: 24, textAlign: 'center', fontWeight: 600 }}>{qty}</span>
                        <Button variant="tertiary" onClick={() => setQty(Math.min(99, qty + 1))} aria-label="＋">＋</Button>
                      </div>
                      <Button variant="primary" onClick={addVm}>＋ {t('scan.add')}{qty > 1 ? ` ×${qty}` : ''}</Button>
                    </div>
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

function BottleDialog({ item, storeId, onClose, onChanged, onTakenOut }: {
  item: CellarItem;
  storeId: string | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onTakenOut: (reason: string) => void;
}) {
  const { t } = useTranslation();
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState('drank');
  const [bought, setBought] = useState((item.boughtAt ?? item.addedAt).slice(0, 10));
  const [savingDate, setSavingDate] = useState(false);
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
          <>
            <ProductFacts product={item.product} />
            <StockLine productId={item.product.vmProductId} storeId={storeId} />
          </>
        ) : (
          <>
            {item.customAbv !== null && <div className="ing-row"><span className="muted">{t('bottle.abv')}</span><strong>{item.customAbv}%</strong></div>}
            {item.customVolumeCl !== null && <div className="ing-row"><span className="muted">{t('bottle.volume')}</span><strong>{item.customVolumeCl} cl</strong></div>}
            <div className="ing-row"><span className="muted">{t('bottle.added')}</span><strong>{added}</strong></div>
          </>
        )}
        <div className="ing-row" style={{ alignItems: 'flex-start' }}>
          <span className="muted">{t('cellar.bought')}</span>
          <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Input type="date" value={bought} onChange={(e) => setBought(e.target.value)} aria-label={t('cellar.bought')} style={{ width: 'auto' }} />
            <Button
              variant="tertiary"
              loading={savingDate}
              onClick={async () => {
                setSavingDate(true);
                try {
                  await api.updateBottle(item.id, { boughtAt: bought });
                  await onChanged();
                } catch { /* keep the dialog open on failure */ }
                finally { setSavingDate(false); }
              }}
            >
              {t('common.save')}
            </Button>
          </span>
        </div>
        <div className="ing-row"><span className="muted">{t('bottle.added')}</span><strong>{added}</strong></div>
        {item.note && <div className="ing-row"><span className="muted">{t('bottle.note')}</span><span>{item.note}</span></div>}
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

/** Party mode: create/read-only share links (/j/<token>), list and revoke.
 *  Guests need no account — the token is the credential. */
function ShareDialog({ cellarId, cellarName, showToast }: {
  cellarId: string;
  cellarName: string;
  showToast: (m: string) => void;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState('');
  const [exp, setExp] = useState('1d');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ token: string; url: string; expiresAt: string | null } | null>(null);
  const [shares, setShares] = useState<{ token: string; label: string | null; expiresAt: string | null; createdAt: string }[] | null>(null);
  const [qr, setQr] = useState<{ label: string; dataUrl: string } | null>(null);

  const load = () => api.listShares(cellarId).then((r) => setShares(r.items)).catch(() => {});
  useEffect(() => { load(); }, [cellarId]);

  function fullUrl(path: string) { return window.location.origin + path; }

  // QR is generated locally (qrcode package, no API call) — the URL is the
  // whole payload, so a camera scan opens the guest view directly.
  async function showQr(label: string, path: string) {
    try {
      const dataUrl = await QRCode.toDataURL(fullUrl(path), { width: 240, margin: 1, errorCorrectionLevel: 'M' });
      setQr({ label, dataUrl });
    } catch {
      setQr(null);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(t('share.copied'));
    } catch {
      window.prompt(t('share.copy'), text);
    }
  }

  async function create() {
    setBusy(true);
    try {
      const ms = exp === 'never' ? null
        : exp === '2h' ? 2 * 3600e3
        : exp === '1w' ? 7 * 86400e3
        : Number(exp.slice(0, -1)) * 86400e3;
      const r = await api.createShare(cellarId, {
        label: label.trim() || null,
        expiresAt: ms ? new Date(Date.now() + ms).toISOString() : null,
      });
      setFresh(r);
      setLabel('');
      load();
      showQr(label.trim() || t('share.title'), r.url);
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(token: string) {
    setBusy(true);
    try {
      await api.revokeShare(cellarId, token);
      load();
      if (fresh?.token === token) setFresh(null);
      if (qr && shares?.some((s) => s.token === token)) setQr(null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Heading level={2} data-size="lg">🎉 {t('share.title')} — {cellarName}</Heading>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>{t('share.host_note')}</p>

      {fresh && (
        <div style={{ border: '1px solid var(--ds-color-border-subtle)', borderRadius: 10, padding: 10, display: 'grid', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{t('share.link')}</span>
          <div className="row" style={{ gap: 8 }}>
            <Input readOnly value={fullUrl(fresh.url)} aria-label={t('share.link')} style={{ flex: 1, fontSize: 13 }} />
            <Button variant="secondary" onClick={() => copy(fullUrl(fresh.url))}>{t('share.copy_btn')}</Button>
          </div>
        </div>
      )}

      {qr && (
        <div style={{ display: 'grid', justifyItems: 'center', gap: 6, padding: '4px 0' }}>
          <img
            src={qr.dataUrl}
            alt={t('share.qr_alt')}
            width={220}
            height={220}
            style={{ borderRadius: 10, border: '1px solid var(--ds-color-border-subtle)', background: '#fff', padding: 8 }}
          />
          <span className="muted" style={{ fontSize: 12, textAlign: 'center' }}>{t('share.qr_hint')}</span>
        </div>
      )}

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('share.label_ph')} aria-label={t('share.label_ph')} style={{ flex: 1, minWidth: 140 }} />
        <Select value={exp} onChange={(e) => setExp(e.target.value)} aria-label={t('share.expiry')} style={{ width: 'auto' }}>
          <option value="2h">{t('share.exp_2h')}</option>
          <option value="1d">{t('share.exp_1d')}</option>
          <option value="3d">{t('share.exp_3d')}</option>
          <option value="1w">{t('share.exp_1w')}</option>
          <option value="never">{t('share.exp_never')}</option>
        </Select>
        <Button variant="primary" loading={busy} onClick={create}>{t('share.create')}</Button>
      </div>

      {shares && (
        <div style={{ display: 'grid', gap: 6 }}>
          <Heading level={3} data-size="sm">{t('share.active')}</Heading>
          {shares.length === 0 && <span className="muted" style={{ fontSize: 13 }}>{t('share.none')}</span>}
          {shares.map((s) => (
            <div key={s.token} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, flex: 1, overflowWrap: 'anywhere' }}>
                <strong>{s.label ?? s.token.slice(0, 6) + '…'}</strong>{' '}
                <span className="muted">
                  {s.expiresAt ? t('share.until', { date: new Date(s.expiresAt).toLocaleString() }) : t('share.exp_never')}
                </span>
              </span>
              <Button variant="tertiary" onClick={() => copy(fullUrl('/j/' + s.token))}>⧉</Button>
              <Button variant="tertiary" onClick={() => showQr(s.label ?? s.token.slice(0, 6), '/j/' + s.token)}>📷</Button>
              <Button variant="tertiary" loading={busy} onClick={() => revoke(s.token)}>✕</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Pick / create / manage a cellar: switch between your cellars, invite
 *  members (owner), rename, delete. */
function CellarPicker({ cellars, cellarId, onSwitch, onChanged, showToast }: {
  cellars: Cellar[];
  cellarId: string | null;
  onSwitch: (id: string) => void;
  onChanged: () => void;
  showToast: (m: string) => void;
}) {
  const { t } = useTranslation();
  const active = cellars.find((c) => c.id === cellarId) ?? null;
  const isOwner = active?.role === 'owner';
  const [newName, setNewName] = useState('');
  const [invite, setInvite] = useState('');
  const [rename, setRename] = useState('');
  const [showRename, setShowRename] = useState(false);
  const [members, setMembers] = useState<{ userId: string; name: string; role: 'owner' | 'member' }[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOwner || !active) return;
    let live = true;
    api.cellarMembers(active.id)
      .then((r) => { if (live) setMembers(r.items); })
      .catch(() => {});
    return () => { live = false; };
  }, [active?.id, isOwner]);

  const errText = (e: unknown): string => {
    const m = e instanceof Error ? e.message : '';
    if (m === 'no_such_user') return t('cellar.err_user');
    if (m === 'not_owner') return t('cellar.err_owner');
    return t('common.error');
  };

  async function create() {
    const n = newName.trim();
    if (!n) return;
    setBusy(true);
    try {
      const r = await api.createCellar(n);
      setNewName('');
      onChanged();
      onSwitch(r.id);
    } catch (e) {
      showToast(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function doInvite() {
    const q = invite.trim();
    if (!q || !active) return;
    setBusy(true);
    try {
      const r = await api.inviteToCellar(active.id, q);
      showToast(`${t('cellar.invited')}: ${r.name ?? q}`);
      setInvite('');
      setMembers(await api.cellarMembers(active.id).then((m) => m.items));
    } catch (e) {
      showToast(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function doRemoveMember(userId: string) {
    if (!active) return;
    setBusy(true);
    try {
      await api.removeFromCellar(active.id, userId);
      setMembers(await api.cellarMembers(active.id).then((m) => m.items));
    } catch (e) {
      showToast(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function doRename() {
    const n = rename.trim();
    if (!n || !active) return;
    setBusy(true);
    try {
      await api.renameCellar(active.id, n);
      setShowRename(false);
      onChanged();
    } catch (e) {
      showToast(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (!active) return;
    if (!window.confirm(t('cellar.delete_confirm', { name: active.name }))) return;
    setBusy(true);
    try {
      await api.deleteCellar(active.id);
      onChanged(); // App falls back to the remaining first cellar
    } catch (e) {
      showToast(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Heading level={2} data-size="lg">{t('cellar.pick')}</Heading>

      <div style={{ display: 'grid', gap: 6 }}>
        {cellars.map((c) => (
          <button
            key={c.id}
            onClick={() => onSwitch(c.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', textAlign: 'left', font: 'inherit',
              border: c.id === cellarId ? '2px solid var(--ds-color-accent-base-default)' : '1px solid var(--ds-color-border-subtle)',
              borderRadius: 10, background: 'var(--ds-color-background-subtle)', color: 'inherit', cursor: 'pointer',
            }}
          >
            <span aria-hidden>{c.id === cellarId ? '✓' : '🍷'}</span>
            <span style={{ fontWeight: 600, flex: 1, overflowWrap: 'anywhere' }}>{c.name}</span>
            <span className="muted" style={{ fontSize: 12 }}>{t(`cellar.count_${c.itemCount === 1 ? 'one' : 'other'}`, { count: c.itemCount })}</span>
            <Tag variant="outline">{t(`cellar.role_${c.role}`)}</Tag>
          </button>
        ))}
      </div>

      <div className="row" style={{ gap: 8 }}>
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('cellar.name_ph')} aria-label={t('cellar.name_ph')} style={{ flex: 1 }} />
        <Button variant="secondary" loading={busy} disabled={!newName.trim()} onClick={create}>＋ {t('cellar.create')}</Button>
      </div>

      {active && isOwner && (
        <div style={{ display: 'grid', gap: 12, borderTop: '1px solid var(--ds-color-border-subtle)', paddingTop: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Heading level={3} data-size="sm">{t('cellar.members')}</Heading>
            <div className="row" style={{ gap: 6 }}>
              <Button variant="tertiary" onClick={() => { setShowRename(!showRename); setRename(active.name); }}>✏️ {t('cellar.rename')}</Button>
              <Button variant="tertiary" loading={busy} onClick={doDelete}>🗑 {t('cellar.delete_short')}</Button>
            </div>
          </div>
          {showRename && (
            <div className="row" style={{ gap: 8 }}>
              <Input value={rename} onChange={(e) => setRename(e.target.value)} aria-label={t('cellar.rename')} style={{ flex: 1 }} />
              <Button variant="secondary" loading={busy} onClick={doRename}>{t('common.save')}</Button>
            </div>
          )}
          <div className="row" style={{ gap: 8 }}>
            <Input value={invite} onChange={(e) => setInvite(e.target.value)} placeholder={t('cellar.invite_ph')} aria-label={t('cellar.invite_ph')} style={{ flex: 1 }} />
            <Button variant="secondary" loading={busy} disabled={!invite.trim()} onClick={doInvite}>＋ {t('cellar.invite')}</Button>
          </div>
          {members && (
            <div style={{ display: 'grid', gap: 4 }}>
              {members.map((m) => (
                <div key={m.userId} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14 }}>{m.name} <Tag variant="outline">{t(`cellar.role_${m.role}`)}</Tag></span>
                  {m.role !== 'owner' && (
                    <Button variant="tertiary" loading={busy} onClick={() => doRemoveMember(m.userId)}>✕</Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
