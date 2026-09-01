import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Dialog, Heading, Input, Link, ListOrdered, ListItem, Paragraph, Spinner } from '@digdir/designsystemet-react';
import { api } from '../api';
import { extractQueries, ocrImage, type OcrResult } from '../lib/ocr';
import type { CellarItem, Product } from '../types';
import { BottleThumb, CustomItemForm, ProductFacts, StockLine } from '../components/ui';

type LabelState =
  | { phase: 'reading'; img: string; progress: number }
  | {
      phase: 'candidates';
      img: string;
      text: string;
      query: string;
      candidates: { vmProductId: string; name: string | null }[];
    }
  | { phase: 'notfound'; img: string; text: string; queries: string[] };

export default function ScanPage({ items, storeId, onRefresh, showToast }: {
  items: CellarItem[];
  storeId: string | null;
  onRefresh: () => Promise<void>;
  showToast: (m: string) => void;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraMode, setCameraMode] = useState<'off' | 'scan' | 'label'>('off');
  const [cameraErr, setCameraErr] = useState(false);
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ product: Product | null; code: string; reason?: string } | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [takeOut, setTakeOut] = useState(false);
  const [label, setLabel] = useState<LabelState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [remembering, setRemembering] = useState(false);
  const [qty, setQty] = useState(1);
  const lastScan = useRef(0);
  // Last code that looked like a barcode (12–14 digits), so the user can
  // remember it for a product found by another means (name search in thin mode).
  const lastGtinCode = useRef<string | null>(null);
  const zxingControls = useRef<{ stop: () => void } | null>(null);

  async function openCamera(mode: 'scan' | 'label') {
    setCameraErr(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setCameraMode(mode);
      if (mode === 'scan') scanLoop(stream);
    } catch {
      setCameraErr(true);
    }
  }

  function closeCamera() {
    const video = videoRef.current;
    (video?.srcObject as MediaStream | null)?.getTracks().forEach((tr) => tr.stop());
    if (video) video.srcObject = null;
    try { zxingControls.current?.stop(); } catch { /* ignore */ }
    zxingControls.current = null;
    setCameraMode('off');
  }

  async function scanLoop(stream: MediaStream) {
    const W = window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } };
    if (W.BarcodeDetector && videoRef.current) {
      const detector = new W.BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'],
      });
      const iv = window.setInterval(async () => {
        const video = videoRef.current;
        if (!video || video.readyState < 2) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length) {
            const now = Date.now();
            if (now - lastScan.current < 2500) return;
            lastScan.current = now;
            closeCamera();
            lookup(codes[0].rawValue);
          }
        } catch { /* keep scanning */ }
      }, 300);
      stream.getVideoTracks()[0].addEventListener('ended', () => window.clearInterval(iv));
      return;
    }
    // fallback: zxing
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const reader = new BrowserMultiFormatReader();
      const video = videoRef.current!;
      zxingControls.current = await reader.decodeFromVideoElement(video, (res) => {
        if (res) {
          const now = Date.now();
          if (now - lastScan.current < 2500) return;
          lastScan.current = now;
          closeCamera();
          lookup(res.getText());
        }
      });
    } catch {
      setCameraErr(true);
      setCameraMode('off');
    }
  }

  useEffect(() => () => closeCamera(), []);

  async function lookup(code: string) {
    const c = code.trim();
    if (!c) return;
    if (c.length < 2) {
      showToast(t('scan.code_too_short'));
      return;
    }
    setBusy(true);
    try {
      let product: Product | null = null;
      let reason: string | undefined;
      if (/^\d{12,14}$/.test(c)) {
        lastGtinCode.current = c;
        const res = await api.byGtin(c);
        product = res?.product ?? null;
        reason = res?.reason;
      } else if (/^\d{5,9}$/.test(c)) {
        const res = await api.product(c);
        product = res.product;
      } else {
        const res = await api.searchProducts(c);
        if (res.items.length > 0) {
          const r = await api.product(res.items[0].vmProductId);
          product = r.product;
        }
      }
      setResult({ product, code: c, reason });
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('common.error');
      showToast(msg === 'q_too_short' ? t('scan.code_too_short') : msg);
    } finally {
      setBusy(false);
    }
  }

  // ---------- label (OCR) flow — phase 1: identify, no saving yet ----------

  function captureFrame(): HTMLCanvasElement | null {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return null;
    // Downscale: label text is large, 1400px is plenty (OCR upscales itself).
    const scale = Math.min(1, 1400 / video.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async function readLabel() {
    const canvas = captureFrame();
    if (!canvas) {
      showToast(t('common.error'));
      return;
    }
    const img = canvas.toDataURL('image/jpeg', 0.9); // thumbnail for the result card
    closeCamera(); // free the camera while OCR runs
    setLabel({ phase: 'reading', img, progress: 0 });
    let ocr: OcrResult;
    try {
      ocr = await ocrImage(canvas, (p) =>
        setLabel((l) => (l && l.phase === 'reading' ? { ...l, progress: p } : l)),
      );
    } catch {
      setLabel({ phase: 'notfound', img, text: '', queries: [] });
      showToast(t('scan.label_err'));
      return;
    }
    const queries = extractQueries(ocr);
    if (!queries.length) {
      setLabel({ phase: 'notfound', img, text: ocr.text.trim(), queries: [] });
      return;
    }
    let hit: { query: string; candidates: { vmProductId: string; name: string | null }[] } | null = null;
    for (const q of queries) {
      try {
        const res = await api.searchProducts(q);
        if (res.items.length) {
          hit = { query: q, candidates: res.items.slice(0, 8) };
          break;
        }
      } catch { /* try the next query */ }
    }
    setLabel(
      hit
        ? { phase: 'candidates', img, text: ocr.text.trim(), query: hit.query, candidates: hit.candidates }
        : { phase: 'notfound', img, text: ocr.text.trim(), queries },
    );
  }

  async function openCandidate(c: { vmProductId: string; name: string | null }) {
    setBusyId(c.vmProductId);
    try {
      const res = await api.product(c.vmProductId);
      if (res.product) setResult({ product: res.product, code: '' });
      else showToast(t('scan.not_found'));
      setLabel(null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusyId(null);
    }
  }

  async function addProduct() {
    if (!result?.product) return;
    try {
      await api.addBottle({ source: 'vm', vmProductId: result.product.vmProductId, price: result.product.price, qty });
      await onRefresh();
      showToast(qty > 1 ? `✔ ×${qty}` : '✔');
      setResult(null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('common.error'));
    }
  }

  const qtyStepper = (
    <div className="row" style={{ alignItems: 'center', gap: 4 }}>
      <Button variant="tertiary" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="−">−</Button>
      <span style={{ minWidth: 24, textAlign: 'center', fontWeight: 600 }}>{qty}</span>
      <Button variant="tertiary" onClick={() => setQty(Math.min(99, qty + 1))} aria-label="＋">＋</Button>
    </div>
  );

  const bottlesForResult = result?.product
    ? items.filter((it) => it.source === 'vm' && it.vmProductId === result.product!.vmProductId)
    : [];

  // Offer to save the scanned barcode for the found product — unless the
  // scanner already read exactly this product's own main GTIN.
  // Reset the quantity picker when a new lookup result shows.
  useEffect(() => { setQty(1); }, [result?.product?.vmProductId]);

  const knownGtin = (() => {
    if (!result?.product) return null;
    try { return (JSON.parse(result.product.extra ?? 'null') as { gtin?: string } | null)?.gtin ?? null; }
    catch { return null; }
  })();
  const rememberBtn = !!(result?.product && lastGtinCode.current && lastGtinCode.current !== knownGtin);

  return (
    <div>
      <div className="row mb" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Heading level={1} data-size="lg">{t('scan.title')}</Heading>
        <Button variant="tertiary" onClick={() => setHelpOpen(true)} aria-label={t('scan.help')} style={{ fontWeight: 700 }}>
          ?
        </Button>
      </div>

      <video ref={videoRef} className="scan-video" playsInline muted />
      <div className="row mt">
        {cameraMode === 'off' ? (
          <>
            <Button variant="primary" onClick={() => openCamera('scan')}>📷 {t('scan.start')}</Button>
            <Button variant="secondary" onClick={() => openCamera('label')}>🏷️ {t('scan.read_label')}</Button>
          </>
        ) : (
          <>
            {cameraMode === 'label' && (
              <Button variant="primary" onClick={readLabel}>📸 {t('scan.capture')}</Button>
            )}
            <Button variant="secondary" onClick={closeCamera}>{t('scan.stop')}</Button>
          </>
        )}
        {cameraMode === 'scan' && <span className="muted">{t('scan.hint')}</span>}
        {cameraMode === 'label' && <span className="muted">{t('scan.label_hint')}</span>}
      </div>
      {cameraErr && (
        <div className="mt">
          <Alert data-color="warning">{t('scan.camera_err')}</Alert>
        </div>
      )}

      <div className="mt">
        <div className="row">
          <Input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder={t('scan.manual_ph')}
            aria-label={t('scan.manual_ph')}
            style={{ flex: 1 }}
            onKeyDown={(e) => { if (e.key === 'Enter') lookup(manual); }}
          />
          <Button variant="secondary" onClick={() => lookup(manual)} loading={busy}>{t('scan.lookup')}</Button>
        </div>
      </div>

      {label && (
        <div className="mt result-card" style={{ border: '1px solid var(--ds-color-border-subtle)', borderRadius: 12, padding: 16 }}>
          <div className="row" style={{ gap: 12 }}>
            <img src={label.img} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              {label.phase === 'reading' && (
                <>
                  <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <Spinner aria-label={t('scan.label_reading')} />
                    <strong>{t('scan.label_reading')}</strong>
                  </div>
                  <span className="muted">{Math.round(label.progress * 100)}%</span>
                </>
              )}
              {label.phase === 'candidates' && (
                <Heading level={3} data-size="sm">{t('scan.label_matches', { n: label.candidates.length, q: label.query })}</Heading>
              )}
              {label.phase === 'notfound' && (
                <>
                  <Heading level={3} data-size="sm">{t('scan.label_notfound')}</Heading>
                  {label.text && (
                    <div className="muted" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{label.text.slice(0, 140)}</div>
                  )}
                </>
              )}
            </div>
          </div>
          {label.phase === 'candidates' && (
            <div className="mt" style={{ display: 'grid', gap: 4 }}>
              {label.candidates.map((c) => (
                <div key={c.vmProductId} className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <Button
                    variant="tertiary"
                    style={{ justifyContent: 'flex-start' }}
                    loading={busyId === c.vmProductId}
                    onClick={() => openCandidate(c)}
                  >
                    {c.name ?? c.vmProductId}
                  </Button>
                  <Link href={`https://www.vinmonopolet.no/p/${c.vmProductId}`} target="_blank" rel="noopener noreferrer">↗</Link>
                </div>
              ))}
            </div>
          )}
          {label.phase === 'notfound' && (
            <div className="mt row" style={{ flexWrap: 'wrap', gap: 8 }}>
              {label.queries[0] && (
                <Button variant="secondary" onClick={() => { setManual(label.queries[0]); setLabel(null); }}>
                  ✏️ {t('scan.label_edit')}
                </Button>
              )}
              <Button variant="tertiary" onClick={() => setLabel(null)}>{t('common.cancel')}</Button>
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="mt result-card" style={{ border: '1px solid var(--ds-color-border-subtle)', borderRadius: 12, padding: 16 }}>
          {result.product ? (
            <>
              <div className="row">
                <BottleThumb item={{ ...(fakeItem(result.product)), } as CellarItem} />
                <div style={{ flex: 1 }}>
                  <Heading level={2} data-size="lg">{result.product.longName ?? result.product.name}</Heading>
                  <span className="muted">{result.product.subCategory ?? result.product.category}</span>
                  <div>
                    <Link href={`https://www.vinmonopolet.no/p/${result.product.vmProductId}`} target="_blank" rel="noopener noreferrer">
                      {t('bottle.se_vm')} ↗
                    </Link>
                  </div>
                </div>
              </div>
              <div className="mt">
                <ProductFacts product={result.product} />
                <StockLine productId={result.product.vmProductId} storeId={storeId} />
              </div>
              <div className="mt row" style={{ flexWrap: 'wrap' }}>
                {qtyStepper}
                <Button variant="primary" onClick={addProduct}>＋ {t('scan.add')}{qty > 1 ? ` ×${qty}` : ''}</Button>
                {bottlesForResult.length > 0 && (
                  <Button variant="secondary" onClick={() => setTakeOut(true)}>{t('scan.take_out')} ({bottlesForResult.length})</Button>
                )}
                {rememberBtn && (
                  <Button
                    variant="tertiary"
                    loading={remembering}
                    onClick={async () => {
                      if (!result.product || !lastGtinCode.current) return;
                      setRemembering(true);
                      try {
                        await api.rememberGtin(lastGtinCode.current, result.product.vmProductId);
                        lastGtinCode.current = null;
                        showToast(t('scan.remember_saved'));
                      } catch (e) {
                        showToast(e instanceof Error ? e.message : t('common.error'));
                      } finally {
                        setRemembering(false);
                      }
                    }}
                  >
                    💾 {t('scan.remember_code')}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <Alert data-color="warning">
                {result.reason === 'gtin_unavailable' ? (
                  <>
                    <strong>{t('scan.gtin_unavailable')}</strong> ({result.code})<br />
                    {t('scan.gtin_unavailable_hint')}
                  </>
                ) : (
                  <>
                    <strong>{t('scan.not_found')}</strong> ({result.code})<br />
                    {t('scan.not_found_hint')}
                  </>
                )}
              </Alert>
              <div className="mt">
                <Button variant="secondary" onClick={() => setShowCustom(true)}>＋ {t('scan.add_custom')}</Button>
              </div>
            </>
          )}
        </div>
      )}

      {showCustom && (
        <Dialog open onClose={() => setShowCustom(false)}>
          <CustomItemForm
            prefill={result && !result.product ? result.code : undefined}
            onSaved={async () => { await onRefresh(); setShowCustom(false); setResult(null); }}
            onCancel={() => setShowCustom(false)}
          />
        </Dialog>
      )}

      <Dialog open={helpOpen} onClose={() => setHelpOpen(false)}>
        <Heading level={2} data-size="lg">{t('scan.help_title')}</Heading>
        <ListOrdered className="mt">
          <ListItem>{t('scan.help_barcode')}</ListItem>
          <ListItem>{t('scan.help_label')}</ListItem>
          <ListItem>{t('scan.help_number')}</ListItem>
          <ListItem>{t('scan.help_remember')}</ListItem>
        </ListOrdered>
        <Paragraph className="mt" data-size="sm" variant="long">
          {t('scan.help_note')}
        </Paragraph>
      </Dialog>

      {takeOut && result?.product && (
        <TakeOutDialog
          bottles={bottlesForResult}
          onClose={() => setTakeOut(false)}
          onDone={async (id) => {
            await api.removeBottle(id, 'drank');
            setTakeOut(false);
            await onRefresh();
            showToast('✔');
          }}
        />
      )}
    </div>
  );
}

function fakeItem(p: Product): CellarItem {
  return {
    id: 'scan-' + p.vmProductId,
    source: 'vm',
    vmProductId: p.vmProductId,
    customName: null, customType: null, customAbv: null, customVolumeCl: null,
    price: p.price, photoUrl: null, note: null,
    addedAt: new Date().toISOString(), removedAt: null, removedReason: null,
    product: p,
  };
}

function TakeOutDialog({ bottles, onClose, onDone }: {
  bottles: CellarItem[];
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [id, setId] = useState(bottles[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onClose={onClose}>
      <Heading level={2} data-size="lg">{t('scan.take_out')}</Heading>
      <div className="mt" style={{ display: 'grid', gap: 8 }}>
        {bottles.map((b) => (
          <label key={b.id} className="row" style={{ cursor: 'pointer' }}>
            <input type="radio" name="takeout" checked={id === b.id} onChange={() => setId(b.id)} />
            <span>
              {b.product?.name ?? b.id}
              <span className="muted"> · {new Date(b.addedAt).toLocaleDateString('nb-NO')}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt row">
        <Button
          variant="primary"
          loading={busy}
          disabled={!id}
          onClick={async () => { setBusy(true); onDone(id); }}
        >
          {t('cellar.out')}
        </Button>
        <Button variant="tertiary" onClick={onClose}>{t('common.cancel')}</Button>
      </div>
    </Dialog>
  );
}
