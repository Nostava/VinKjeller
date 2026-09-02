import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Dialog, Heading, Label, Select, Tag } from '@digdir/designsystemet-react';
import { Input } from '@digdir/designsystemet-react';
import { api } from '../api';
import type { BrewInfo, CellarItem } from '../types';
import { parseBrewInfo } from '../types';
import { BottleThumb } from '../components/ui';

const DAY = 86400000;

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

export default function BrewPage({ items, onRefresh, showToast }: {
  items: CellarItem[];
  onRefresh: () => Promise<void>;
  showToast: (m: string) => void;
}) {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CellarItem | null>(null);

  const brews = useMemo(
    () => items
      .filter((i) => parseBrewInfo(i.brewInfo) !== null)
      .sort((a, b) => (parseBrewInfo(b.brewInfo)?.brewDate ?? '').localeCompare(parseBrewInfo(a.brewInfo)?.brewDate ?? '')),
    [items],
  );

  return (
    <div>
      <div className="row mb">
        <Heading level={1} data-size="lg">🍺 {t('brew.title')}</Heading>
        <span className="spacer" />
        <Button variant="secondary" onClick={() => { setEditing(null); setShowForm(true); }}>＋ {t('brew.add')}</Button>
      </div>

      {brews.length === 0 ? (
        <Alert data-color="info">{t('brew.empty')}</Alert>
      ) : (
        <div className="bottle-grid">
          {brews.map((it, idx) => (
            <BrewCard key={it.id} item={it} index={idx} onClick={() => { setEditing(it); setShowForm(true); }} />
          ))}
        </div>
      )}

      <Dialog open={showForm} closedby="any" onClose={() => { setShowForm(false); setEditing(null); }}>
        <BrewForm
          key={editing?.id ?? 'new'}
          item={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={async () => {
            await onRefresh();
            setShowForm(false);
            setEditing(null);
            showToast('✔');
          }}
        />
      </Dialog>
    </div>
  );
}

function BrewCard({ item, index, onClick }: { item: CellarItem; index: number; onClick: () => void }) {
  const { t } = useTranslation();
  const b = parseBrewInfo(item.brewInfo) ?? {};
  const name = item.customName ?? t('bottle.no_data');
  const sub = [b.style, item.customAbv != null ? `${item.customAbv}%` : null, b.ibu != null ? `IBU ${b.ibu}` : null]
    .filter(Boolean).join(' · ');
  const days = b.brewDate
    ? Math.max(0, Math.floor((Date.now() - new Date(b.brewDate + 'T12:00:00').getTime()) / DAY))
    : null;
  const gravity = b.og != null && b.fg != null ? `${b.og} → ${b.fg}` : b.og != null ? String(b.og) : null;
  const recipe = [b.malt, b.hops, b.yeast].filter(Boolean).join(' · ');

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
      <strong style={{ fontSize: 14, lineHeight: 1.3 }}>🍺 {name}</strong>
      {sub && <span className="muted" style={{ fontSize: 12 }}>{sub}</span>}
      {gravity && <span className="muted" style={{ fontSize: 12 }}>{t('brew.gravity')}: {gravity}</span>}
      {recipe && <span className="muted" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{recipe}</span>}
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {b.brewDate && <Tag variant="outline">{t('brew.brewed')} {fmtDate(b.brewDate)}</Tag>}
        {days !== null && <Tag>{t(`brew.days_${days === 1 ? 'one' : 'other'}`, { count: days })}</Tag>}
        {b.carbonation && <Tag variant="outline">{t(`brew.carb_${b.carbonation}`)}</Tag>}
      </div>
    </button>
  );
}

/** Add/edit a homebrew batch. The bottle is a normal cellar item (source
 *  'custom') with the batch details in `brewInfo` JSON. */
function BrewForm({ item, onClose, onSaved }: {
  item: CellarItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const b = item ? parseBrewInfo(item.brewInfo) ?? {} : {};
  const [name, setName] = useState(item?.customName ?? '');
  const [style, setStyle] = useState(b.style ?? '');
  const [abv, setAbv] = useState(item?.customAbv != null ? String(item.customAbv) : '');
  const [og, setOg] = useState(b.og != null ? String(b.og) : '');
  const [fg, setFg] = useState(b.fg != null ? String(b.fg) : '');
  const [ibu, setIbu] = useState(b.ibu != null ? String(b.ibu) : '');
  const [brewDate, setBrewDate] = useState(b.brewDate ?? new Date().toISOString().slice(0, 10));
  const [vol, setVol] = useState(item?.customVolumeCl != null ? String(item.customVolumeCl) : '500');
  const [carb, setCarb] = useState<string>(b.carbonation ?? '');
  const [malt, setMalt] = useState(b.malt ?? '');
  const [hops, setHops] = useState(b.hops ?? '');
  const [yeast, setYeast] = useState(b.yeast ?? '');
  const [note, setNote] = useState(item?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const num = (s: string): number | null => {
    if (s.trim() === '') return null;
    const v = Number(s);
    return Number.isFinite(v) && v >= 0 ? v : null;
  };

  const brewInfo: BrewInfo = {
    style: style.trim() || null,
    og: num(og),
    fg: num(fg),
    ibu: num(ibu),
    malt: malt.trim() || null,
    hops: hops.trim() || null,
    yeast: yeast.trim() || null,
    carbonation: carb === 'light' || carb === 'medium' || carb === 'full' ? carb : null,
    brewDate: brewDate || null,
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr('');
    try {
      const fields = {
        customName: name.trim(),
        customType: style.trim() || null,
        customAbv: num(abv),
        customVolumeCl: num(vol),
        note: note.trim() || null,
        brewInfo,
      };
      if (item) await api.updateBottle(item.id, fields);
      else await api.addBottle({ source: 'custom', ...fields });
      onSaved();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  const cell = (label: string, input: React.ReactNode) => (
    <div>
      <Label>{label}</Label>
      {input}
    </div>
  );

  return (
    <form onSubmit={save}>
      <Heading level={2} data-size="lg">{item ? t('brew.edit') : t('brew.add')}</Heading>
      {err && <p style={{ color: 'var(--ds-color-status-error-text-default)', fontSize: 13 }}>{err}</p>}
      <div style={{ display: 'grid', gap: 12 }}>
        <div>
          <Label htmlFor="b-name">{t('brew.name')}</Label>
          <Input id="b-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Klubb-IPA #12" autoFocus required />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {cell(t('brew.style'), <Input value={style} onChange={(e) => setStyle(e.target.value)} placeholder={t('brew.style_ph')} />)}
          {cell(t('brew.abv'), <Input type="number" step="0.1" min="0" max="99" value={abv} onChange={(e) => setAbv(e.target.value)} placeholder="5.2" />)}
          {cell(t('brew.og'), <Input type="number" step="0.001" min="0" max="2" value={og} onChange={(e) => setOg(e.target.value)} placeholder="1.052" />)}
          {cell(t('brew.fg'), <Input type="number" step="0.001" min="0" max="2" value={fg} onChange={(e) => setFg(e.target.value)} placeholder="1.010" />)}
          {cell(t('brew.ibu'), <Input type="number" step="1" min="0" max="200" value={ibu} onChange={(e) => setIbu(e.target.value)} placeholder="45" />)}
          {cell(t('brew.volume'), <Input type="number" step="1" min="1" max="2000" value={vol} onChange={(e) => setVol(e.target.value)} />)}
          {cell(t('brew.brew_date'), <Input type="date" value={brewDate} onChange={(e) => setBrewDate(e.target.value)} />)}
          <div>
            <Label>{t('brew.carbonation')}</Label>
            <Select value={carb} onChange={(e) => setCarb(e.target.value)} aria-label={t('brew.carbonation')}>
              <option value="">{t('brew.carb_none')}</option>
              <option value="light">{t('brew.carb_light')}</option>
              <option value="medium">{t('brew.carb_medium')}</option>
              <option value="full">{t('brew.carb_full')}</option>
            </Select>
          </div>
        </div>
        {cell(t('brew.malt'), <Input value={malt} onChange={(e) => setMalt(e.target.value)} placeholder="Maris Otter, Carapils…" />)}
        {cell(t('brew.hops'), <Input value={hops} onChange={(e) => setHops(e.target.value)} placeholder="Citra, Magnum…" />)}
        {cell(t('brew.yeast'), <Input value={yeast} onChange={(e) => setYeast(e.target.value)} placeholder="S-04, US-05…" />)}
        {cell(t('brew.note'), <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Klubbmøte, gjenbruk av gær…" />)}
      </div>
      <div className="mt row">
        <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>{t('common.save')}</Button>
        <Button type="button" variant="tertiary" onClick={onClose}>{t('common.cancel')}</Button>
      </div>
    </form>
  );
}
