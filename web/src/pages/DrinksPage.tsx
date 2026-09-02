import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert, Button, Dialog, Heading, Label, Radio, Select, Spinner, Tabs,
} from '@digdir/designsystemet-react';
import { Input } from '@digdir/designsystemet-react';
import { api } from '../api';
import type { CellarItem, Recipe, Round } from '../types';
import { estimateEmpty, recipeStatus, type RecipeStatus } from '../lib/match';
import nb from '../i18n/nb.json';

export default function DrinksPage({ items, recipes, rounds, onRefresh, showToast }: {
  items: CellarItem[];
  recipes: Recipe[];
  rounds: Round[];
  onRefresh: () => Promise<void>;
  showToast: (m: string) => void;
}) {
  const { t } = useTranslation();
  const [active, setActive] = useState<'make' | 'missing' | 'mine'>('make');
  const [making, setMaking] = useState<Recipe | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [fav, setFav] = useState<Record<string, boolean>>({});

  const statuses = useMemo(
    () => recipes.map((r) => ({ status: recipeStatus(r, items), fav: fav[r.id] ?? false })),
    [recipes, items, fav],
  );
  const makeList = statuses.filter((s) => s.status.canMake);
  const missingList = statuses.filter((s) => !s.status.canMake);

  const estimates = useMemo(() => {
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
    const recent = rounds.filter((r) => r.at >= cutoff);
    return estimateEmpty(items, consumedMap(recent)).slice(0, 8);
  }, [items, rounds]);

  const hasRounds = rounds.length > 0;

  return (
    <div>
      <div className="row mb">
        <Heading level={1} data-size="lg">{t('drinks.title')}</Heading>
      </div>

      {/* Estimert til tom */}
      <div className="mb">
        <Heading level={2} data-size="md">{t('drinks.est_title')}</Heading>
        {!hasRounds ? (
          <p className="muted">{t('drinks.est_hint')}</p>
        ) : estimates.length === 0 ? (
          <p className="muted">{t('drinks.est_none')}</p>
        ) : (
          <div>
            {estimates.map((e) => (
              <div className="ing-row" key={e.label}>
                <span>{e.label}</span>
                <strong>
                  {e.days === null ? t('drinks.est_rare') : e.days >= 7
                    ? t('drinks.est_weeks', { count: Math.round(e.days / 7) })
                    : t('drinks.est_days', { count: e.days })}
                </strong>
              </div>
            ))}
          </div>
        )}
      </div>

      <Tabs value={active} onChange={(v) => setActive(v as 'make' | 'missing' | 'mine')}>
        <Tabs.List aria-label={t('drinks.title')}>
          <Tabs.Tab value="make">{t('drinks.make')}</Tabs.Tab>
          <Tabs.Tab value="missing">{t('drinks.missing')}</Tabs.Tab>
          <Tabs.Tab value="mine">{t('drinks.mine')}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="make">
          {makeList.length === 0 ? (
            <Alert data-color="info">{t('drinks.empty')}</Alert>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {makeList.map(({ status, fav }) => (
                <RecipeCard key={status.recipe.id} status={status} fav={fav} onMake={() => setMaking(status.recipe)} onFav={toggleFav} />
              ))}
            </div>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="missing">
          {missingList.length === 0 ? (
            <Alert data-color="success">🎉 {t('drinks.make')}</Alert>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {missingList.map(({ status, fav }) => (
                <RecipeCard key={status.recipe.id} status={status} fav={fav} onFav={toggleFav} />
              ))}
            </div>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="mine">
          <div className="row mb">
            <span className="muted">{t('drinks.mine')}</span>
            <span className="spacer" />
            <Button variant="secondary" onClick={() => setShowNew(true)}>＋ {t('drinks.new_recipe')}</Button>
          </div>
          {statuses.filter((s) => s.status.recipe.userId).length === 0 && (
            <Alert data-color="info">{t('drinks.empty')}</Alert>
          )}
          <div style={{ display: 'grid', gap: 12 }}>
            {statuses.filter((s) => s.status.recipe.userId).map(({ status, fav }) => (
              <RecipeCard key={status.recipe.id} status={status} fav={fav} onMake={() => setMaking(status.recipe)} onFav={toggleFav} />
            ))}
          </div>
        </Tabs.Panel>
      </Tabs>

      {making && (
        <Dialog open closedby="any" onClose={() => setMaking(null)}>
          <MakeRoundDialog
            status={statuses.find((s) => s.status.recipe.id === making.id)?.status!}
            onClose={() => setMaking(null)}
            onDone={async () => {
              setMaking(null);
              await onRefresh();
              showToast(t('drinks.round_done'));
            }}
            showToast={showToast}
          />
        </Dialog>
      )}

      {showNew && (
        <Dialog open closedby="any" onClose={() => setShowNew(false)}>
          <NewRecipeDialog
            onClose={() => setShowNew(false)}
            onSaved={async () => { await onRefresh(); setShowNew(false); }}
            showToast={showToast}
          />
        </Dialog>
      )}
    </div>
  );

  async function toggleFav(r: Recipe) {
    const next = !(fav[r.id] ?? false);
    setFav({ ...fav, [r.id]: next });
    try {
      await api.setFavorite(r.id, next);
    } catch { /* keep local state */ }
  }
}

function consumedMap(rounds: Round[]) {
  const map = new Map<string, number>();
  for (const r of rounds) for (const c of r.consumed) map.set(c.cellarItemId, (map.get(c.cellarItemId) ?? 0) + c.cl);
  return map;
}

function RecipeCard({ status, fav, onMake, onFav }: {
  status: RecipeStatus;
  fav: boolean;
  onMake?: () => void;
  onFav: (r: Recipe) => void;
}) {
  const { t } = useTranslation();
  const r = status.recipe;
  const name = r.nameKey.startsWith('recipe.') ? t(r.nameKey) : r.nameKey;

  return (
    <div style={{ border: '1px solid var(--ds-color-border-subtle)', borderRadius: 12, padding: 16 }}>
      <div className="row">
        <Heading level={3} data-size="md">{name}</Heading>
        <span className="spacer" />
        {r.glass && <span className="muted">{t('drinks.glass')}: {t(r.glass)}</span>}
        <Button
          variant="tertiary"
          aria-label="favoritt"
          onClick={() => onFav(r)}
          style={{ padding: 4 }}
        >
          {fav ? '❤️' : '🤍'}
        </Button>
      </div>
      <div className="mt">
        {status.ingredients.map((i) => (
          <div className="ing-row" key={i.ing.nameKey}>
            <span>
              {i.ok ? '✅' : '❌'} {t(i.ing.nameKey)}
              <span className="muted"> · {i.ing.cl} cl{i.ing.optional ? ` (${t('drinks.optional')})` : ''}</span>
            </span>
            {/* 🧊 = satisfied by an ON fridge item (no bottles involved) */}
            <span className="muted" title={i.fridge ? t('drinks.fridge_ok') : undefined}>
              {i.fridge ? '🧊' : i.matches.length}
            </span>
          </div>
        ))}
      </div>
      {status.canMake && onMake && (
        <div className="mt">
          <Button variant="primary" onClick={onMake}>
            {t('drinks.make_round')}
            {status.maxRounds > 0 && <span className="muted"> · {t('drinks.rounds', { count: status.maxRounds })}</span>}
          </Button>
        </div>
      )}
    </div>
  );
}

function MakeRoundDialog({ status, onClose, onDone, showToast }: {
  status: RecipeStatus;
  onClose: () => void;
  onDone: () => void;
  showToast: (m: string) => void;
}) {
  const { t } = useTranslation();
  const r = status.recipe;
  const name = r.nameKey.startsWith('recipe.') ? t(r.nameKey) : r.nameKey;
  // fridge-satisfied ingredients need no bottle pick — the juice is there
  const required = status.ingredients.filter((i) => !i.ing.optional && i.ing.cl > 0 && !i.fridge);
  const [picks, setPicks] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const i of required) init[i.ing.nameKey] = i.matches[0]?.id ?? '';
    return init;
  });
  const [busy, setBusy] = useState(false);

  async function log() {
    setBusy(true);
    try {
      await api.addRound(r.id, required.map((i) => ({
        cellarItemId: picks[i.ing.nameKey],
        cl: i.ing.cl,
      })));
      onDone();
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('common.error'));
      setBusy(false);
    }
  }

  return (
    <div>
      <Heading level={2} data-size="lg">{name}</Heading>
      <Heading level={3} data-size="md" className="mt">{t('drinks.select_bottles')}</Heading>
      {required.map((i) => (
        <div key={i.ing.nameKey} className="mt">
          <Label htmlFor={`pick-${i.ing.nameKey}`}>
            {t(i.ing.nameKey)} ({i.ing.cl} cl)
          </Label>
          <Select id={`pick-${i.ing.nameKey}`} value={picks[i.ing.nameKey]} onChange={(e) => setPicks({ ...picks, [i.ing.nameKey]: e.target.value })}>
            {i.matches.map((m) => (
              <option key={m.id} value={m.id}>
                {m.customName ?? m.product?.name ?? m.id}
              </option>
            ))}
          </Select>
        </div>
      ))}
      <div className="mt row">
        <Button variant="primary" loading={busy} onClick={log} disabled={Object.values(picks).some((p) => !p)}>
          {t('drinks.make_round')}
        </Button>
        <Button variant="tertiary" onClick={onClose}>{t('common.cancel')}</Button>
      </div>
    </div>
  );
}

function NewRecipeDialog({ onClose, onSaved, showToast }: {
  onClose: () => void;
  onSaved: () => void;
  showToast: (m: string) => void;
}) {
  const { t } = useTranslation();
  const ingKeys = Object.keys(nb.ing);
  const [name, setName] = useState('');
  const [rows, setRows] = useState<{ key: string; customKw: string; cl: string; optional: boolean }[]>([
    { key: ingKeys[0], customKw: '', cl: '3', optional: false },
  ]);
  const [busy, setBusy] = useState(false);

  function setRow(i: number, patch: Partial<{ key: string; customKw: string; cl: string; optional: boolean }>) {
    const next = [...rows];
    next[i] = { ...next[i], ...patch };
    setRows(next);
  }

  async function save() {
    if (!name.trim() || rows.length === 0) return;
    setBusy(true);
    try {
      await api.addRecipe({
        nameKey: name.trim(),
        glass: null,
        image: null,
        ingredients: rows.map((row) => {
          if (row.key === '__custom__') {
            const kws = row.customKw.split(',').map((k) => k.trim()).filter(Boolean);
            return { nameKey: kws[0] ?? 'custom', keywords: kws, cl: Number(row.cl) || 0, optional: row.optional };
          }
          const label = (nb.ing as Record<string, string>)[row.key];
          return {
            nameKey: 'ing.' + row.key,
            keywords: [label.toLowerCase()],
            cl: Number(row.cl) || 0,
            optional: row.optional,
          };
        }),
      });
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('common.error'));
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Heading level={2} data-size="lg">{t('drinks.new_recipe')}</Heading>
      <div>
        <Label htmlFor="nr-name">{t('drinks.recipe_name')}</Label>
        <Input id="nr-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {rows.map((row, i) => (
        <div key={i} className="row" style={{ flexWrap: 'wrap' }}>
          <Select value={row.key} onChange={(e) => setRow(i, { key: e.target.value })} aria-label={t('drinks.ingredient')} style={{ flex: 1, minWidth: 150 }}>
            {ingKeys.map((k) => (
              <option key={k} value={k}>{(nb.ing as Record<string, string>)[k]}</option>
            ))}
            <option value="__custom__">…</option>
          </Select>
          {row.key === '__custom__' && (
            <Input
              value={row.customKw}
              onChange={(e) => setRow(i, { customKw: e.target.value })}
              placeholder="nøkkelord, kommaseparert"
              aria-label={t('drinks.ingredient')}
              style={{ width: 180 }}
            />
          )}
          <Input
            type="number"
            step="0.1"
            min="0"
            value={row.cl}
            onChange={(e) => setRow(i, { cl: e.target.value })}
            aria-label={t('drinks.amount_cl')}
            style={{ width: 90 }}
          />
          <Radio id={`opt-${i}`} label={t('drinks.optional')} checked={row.optional} onChange={() => setRow(i, { optional: !row.optional })} />
          {rows.length > 1 && (
            <Button variant="tertiary" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={t('common.close')}>✕</Button>
          )}
        </div>
      ))}
      <Button variant="secondary" onClick={() => setRows([...rows, { key: ingKeys[0], customKw: '', cl: '2', optional: false }])}>
        ＋ {t('drinks.add_ingredient')}
      </Button>
      <div className="row">
        <Button variant="primary" loading={busy} onClick={save}>{t('drinks.save_recipe')}</Button>
        <Button variant="tertiary" onClick={onClose}>{t('common.cancel')}</Button>
      </div>
    </div>
  );
}
