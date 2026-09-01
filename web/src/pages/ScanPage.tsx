import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Dialog, Heading, Input, Link, ListOrdered, ListItem, Paragraph, Spinner } from '@digdir/designsystemet-react';
import { api } from '../api';
import { extractQueries, ocrImage, type OcrEngine, type OcrResult } from '../lib/ocr';
import type { CellarItem, Product } from '../types';
import { BottleThumb, CustomItemForm, ProductFacts, StockLine, imageUrlFromSet } from '../components/ui';

type SearchHit = { vmProductId: string; name: string | null; imageUrls: string | null };
// normalized (0..1) region box, relative to the captured frame
type Box = { x: number; y: number; w: number; h: number };

type LabelState =
  | { phase: 'review'; img: string }
  | { phase: 'reading'; img: string; progress: number }
  | {
      phase: 'candidates';
      img: string;
      text: string;
      query: string;
      engine: 'troc' | 'tesseract';
      candidates: SearchHit[];
    }
  | { phase: 'notfound'; img: string; text: string; queries: string[]; engine: 'troc' | 'tesseract' };

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
  const [searchHits, setSearchHits] = useState<SearchHit[] | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const boxDraft = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const labelCardRef = useRef<HTMLDivElement>(null);

  // When the OCR result card appears (after capture), bring it into view —
  // the camera it replaced disappears, so the page shifts anyway.
  useEffect(() => {
    if (label) labelCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [label]);

  // The camera opens wherever the user tapped (top button or the alert's
  // "read label" button) — make sure it's actually visible.
  useEffect(() => {
    if (cameraMode !== 'off') videoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [cameraMode]);
  const lastScan = useRef(0);
  // Last code that looked like a barcode (12–14 digits), so the user can
  // remember it for a product found by another means (name search in thin mode).
  const lastGtinCode = useRef<string | null>(null);
  const manualRef = useRef<HTMLInputElement>(null);
  const zxingControls = useRef<{ stop: () => void } | null>(null);
  // Last captured label frame — kept so "retry with the other engine" can
  // re-run OCR without reopening the camera.
  const lastFrameRef = useRef<HTMLCanvasElement | null>(null);

  function focusManual() {
    manualRef.current?.focus();
    manualRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function openCamera(mode: 'scan' | 'label') {
    closeCamera(); // stop any stream from a previous camera mode
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
    setSearchHits(null);
    try {
      if (/^\d{12,14}$/.test(c)) {
        lastGtinCode.current = c;
        const res = await api.byGtin(c);
        setResult({ product: res?.product ?? null, code: c, reason: res?.reason });
        return;
      }
      if (/^\d{5,9}$/.test(c)) {
        const res = await api.product(c);
        setResult({ product: res.product, code: c, reason: res.product ? undefined : 'not_found' });
        return;
      }
      // name search: one hit → straight to the product; several → pick from cards
      const res = await api.searchProducts(c);
      if (res.items.length === 1) {
        const r = await api.product(res.items[0].vmProductId);
        setResult({ product: r.product, code: c, reason: r.product ? undefined : 'not_found' });
        return;
      }
      if (res.items.length > 1) {
        setSearchHits(res.items.slice(0, 12));
        setResult(null);
        return;
      }
      setResult({ product: null, code: c, reason: 'not_found' });
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

  function readLabel() {
    const canvas = captureFrame();
    if (!canvas) {
      showToast(t('common.error'));
      return;
    }
    const img = canvas.toDataURL('image/jpeg', 0.9); // thumbnail for the result card
    closeCamera(); // free the camera while OCR runs
    lastFrameRef.current = canvas;
    setBox(null);
    setLabel({ phase: 'review', img }); // user may crop a region before OCR
  }

  /** Crop a normalized region (with small padding) out of the captured frame. */
  function cropRegion(frame: HTMLCanvasElement, b: Box): HTMLCanvasElement {
    const fw = frame.width;
    const fh = frame.height;
    const pad = Math.max(8, Math.round(b.h * fh * 0.15));
    const x0 = Math.max(0, Math.round(b.x * fw) - pad);
    const y0 = Math.max(0, Math.round(b.y * fh) - pad);
    const x1 = Math.min(fw, Math.round((b.x + b.w) * fw) + pad);
    const y1 = Math.min(fh, Math.round((b.y + b.h) * fh) + pad);
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, x1 - x0);
    cv.height = Math.max(1, y1 - y0);
    cv.getContext('2d')?.drawImage(frame, x0, y0, cv.width, cv.height, 0, 0, cv.width, cv.height);
    return cv;
  }

  function startOcr(region: Box | null) {
    const frame = lastFrameRef.current;
    if (!frame || !label) return;
    if (region && (Math.round(region.w * frame.width) < 48 || Math.round(region.h * frame.height) < 24)) {
      showToast(t('scan.box_small'));
      return;
    }
    const engine = (localStorage.getItem('vk_ocr_engine') as OcrEngine | null) ?? 'auto';
    void runLabelOcr(region ? cropRegion(frame, region) : frame, label.img, engine);
  }

  // --- box drawing on the captured image (pointer events = mouse + touch) ---
  function normPoint(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }
  function onBoxDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = normPoint(e);
    boxDraft.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    setBox(null);
  }
  function onBoxMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!boxDraft.current) return;
    const p = normPoint(e);
    const d = boxDraft.current;
    d.x1 = p.x;
    d.y1 = p.y;
    setBox({
      x: Math.min(d.x0, d.x1),
      y: Math.min(d.y0, d.y1),
      w: Math.abs(d.x1 - d.x0),
      h: Math.abs(d.y1 - d.y0),
    });
  }
  function onBoxUp() {
    boxDraft.current = null;
    setBox((b) => (b && (b.w < 0.03 || b.h < 0.03) ? null : b)); // ignore taps
  }

  async function runLabelOcr(canvas: HTMLCanvasElement, img: string, engine: OcrEngine) {
    setLabel({ phase: 'reading', img, progress: 0 });
    let ocr: OcrResult;
    try {
      ocr = await ocrImage(canvas, {
        engine,
        onProgress: (p) => setLabel((l) => (l && l.phase === 'reading' ? { ...l, progress: p } : l)),
      });
    } catch {
      setLabel({ phase: 'notfound', img, text: '', queries: [], engine: 'tesseract' });
      showToast(t('scan.label_err'));
      return;
    }
    const queries = extractQueries(ocr);
    if (!queries.length) {
      setLabel({ phase: 'notfound', img, text: ocr.text.trim(), queries: [], engine: ocr.engine });
      return;
    }
    let hit: { query: string; candidates: SearchHit[] } | null = null;
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
        ? { phase: 'candidates', img, text: ocr.text.trim(), query: hit.query, engine: ocr.engine, candidates: hit.candidates }
        : { phase: 'notfound', img, text: ocr.text.trim(), queries, engine: ocr.engine },
    );
  }

  async function openProduct(id: string) {
    setBusyId(id);
    try {
      const res = await api.product(id);
      if (res.product) setResult({ product: res.product, code: '' });
      else showToast(t('scan.not_found'));
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusyId(null);
    }
  }

  function openCandidate(c: SearchHit) {
    setLabel(null);
    void openProduct(c.vmProductId);
  }

  function openHit(h: SearchHit) {
    setSearchHits(null);
    void openProduct(h.vmProductId);
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

      <video ref={videoRef} className="scan-video" playsInline muted style={{ display: cameraMode === 'off' ? 'none' : undefined }} />
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
            ref={manualRef}
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

      {label?.phase === 'review' && (
        <div ref={labelCardRef} className="mt result-card" style={{ border: '1px solid var(--ds-color-border-subtle)', borderRadius: 12, padding: 16 }}>
          <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>{t('scan.review_hint')}</p>
          <div
            style={{ position: 'relative', touchAction: 'none', userSelect: 'none', cursor: 'crosshair' }}
            onPointerDown={onBoxDown}
            onPointerMove={onBoxMove}
            onPointerUp={onBoxUp}
            onPointerCancel={onBoxUp}
          >
            <img src={label.img} alt="" style={{ width: '100%', display: 'block', borderRadius: 8 }} />
            {box && (
              <div
                style={{
                  position: 'absolute',
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.w * 100}%`,
                  height: `${box.h * 100}%`,
                  border: '2px solid var(--ds-color-accent-base-default)',
                  borderRadius: 4,
                  background: 'rgba(128, 128, 128, 0.18)',
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>
          <div className="mt row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {box && <Button variant="primary" onClick={() => startOcr(box)}>🔍 {t('scan.read_region')}</Button>}
            <Button variant={box ? 'tertiary' : 'primary'} onClick={() => startOcr(null)}>▶️ {t('scan.read_full')}</Button>
            {box && <Button variant="tertiary" onClick={() => setBox(null)}>{t('scan.box_remove')}</Button>}
            <Button variant="tertiary" onClick={() => { setLabel(null); setBox(null); }}>{t('scan.review_cancel')}</Button>
          </div>
        </div>
      )}
      {label && label.phase !== 'review' && (
        <div ref={labelCardRef} className="mt result-card" style={{ border: '1px solid var(--ds-color-border-subtle)', borderRadius: 12, padding: 16 }}>
          <div className="row" style={{ gap: 12 }}>
            <img src={label.img} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              {label.phase === 'reading' && (
                <>
                  <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <Spinner aria-label={t('scan.label_reading')} />
                    <strong>{t('scan.label_reading')}</strong>
                  </div>
                  <span className="muted">{Math.min(100, Math.max(0, Math.round(label.progress * 100)))}%</span>
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
            <div className="mt" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8 }}>
              {label.candidates.map((c) => (
                <CandidateCard key={c.vmProductId} hit={c} busy={busyId === c.vmProductId} onClick={() => openCandidate(c)} />
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
              {lastFrameRef.current && (
                <Button variant="secondary" onClick={() => { setBox(null); setLabel({ phase: 'review', img: label.img }); }}>
                  📏 {t('scan.box_retry')}
                </Button>
              )}
              {lastFrameRef.current && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    const other = label.engine === 'troc' ? 'tesseract' : 'troc';
                    void runLabelOcr(lastFrameRef.current!, label.img, other);
                  }}
                >
                  🔄 {t('scan.label_retry_other')}
                </Button>
              )}
              <Button variant="tertiary" onClick={() => setLabel(null)}>{t('common.cancel')}</Button>
            </div>
          )}
        </div>
      )}

      {searchHits && (
        <div className="mt result-card" style={{ border: '1px solid var(--ds-color-border-subtle)', borderRadius: 12, padding: 16 }}>
          <Heading level={3} data-size="sm">{t('scan.hits', { n: searchHits.length })}</Heading>
          <div className="mt" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8 }}>
            {searchHits.map((h) => (
              <CandidateCard key={h.vmProductId} hit={h} busy={busyId === h.vmProductId} onClick={() => openHit(h)} />
            ))}
          </div>
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
              <div className="mt row" style={{ flexWrap: 'wrap' }}>
                <Button variant="secondary" onClick={() => openCamera('label')}>🏷️ {t('scan.read_label')}</Button>
                <Button variant="secondary" onClick={focusManual}>🔎 {t('scan.search_name')}</Button>
                <Button variant="tertiary" onClick={() => setShowCustom(true)}>＋ {t('scan.add_custom')}</Button>
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
          {t('scan.help_engines')}
        </Paragraph>
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

/** Small name+image card for search candidates (label OCR and name search). */
function CandidateCard({ hit, busy, onClick }: { hit: SearchHit; busy: boolean; onClick: () => void }) {
  const url = imageUrlFromSet(hit.imageUrls);
  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        padding: '10px 12px',
        border: '1px solid var(--ds-color-border-subtle)',
        borderRadius: 10,
        background: 'var(--ds-color-background-subtle)',
        color: 'inherit',
        cursor: busy ? 'progress' : 'pointer',
        textAlign: 'left',
        font: 'inherit',
      }}
    >
      {url ? (
        <img src={url} alt="" style={{ width: 44, height: 44, objectFit: 'contain', flexShrink: 0 }} />
      ) : (
        <span style={{ width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', flexShrink: 0 }} aria-hidden="true">🍾</span>
      )}
      <span style={{ fontSize: 13, fontWeight: 500, overflowWrap: 'anywhere', lineHeight: 1.25 }}>{hit.name ?? hit.vmProductId}</span>
    </button>
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
