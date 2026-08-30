import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Dialog, Heading, Input } from '@digdir/designsystemet-react';
import { api } from '../api';
import type { CellarItem, Product } from '../types';
import { BottleThumb, CustomItemForm, ProductFacts } from '../components/ui';

export default function ScanPage({ items, onRefresh, showToast }: {
  items: CellarItem[];
  onRefresh: () => Promise<void>;
  showToast: (m: string) => void;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraErr, setCameraErr] = useState(false);
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ product: Product | null; code: string; reason?: string } | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [takeOutCode, setTakeOutCode] = useState<string | null>(null);
  const [remembering, setRemembering] = useState(false);
  const [qty, setQty] = useState(1);
  const lastScan = useRef(0);
  // Last code that looked like a barcode (12–14 digits), so the user can
  // remember it for a product found by another means (name search in thin mode).
  const lastGtinCode = useRef<string | null>(null);
  const zxingControls = useRef<{ stop: () => void } | null>(null);

  async function startCamera() {
    setCameraErr(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setCameraOn(true);
      scanLoop(stream);
    } catch {
      setCameraErr(true);
    }
  }

  function stopCamera() {
    const video = videoRef.current;
    (video?.srcObject as MediaStream | null)?.getTracks().forEach((tr) => tr.stop());
    if (video) video.srcObject = null;
    try { zxingControls.current?.stop(); } catch { /* ignore */ }
    zxingControls.current = null;
    setCameraOn(false);
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
            stopCamera();
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
          stopCamera();
          lookup(res.getText());
        }
      });
    } catch {
      setCameraErr(true);
      setCameraOn(false);
    }
  }

  useEffect(() => () => stopCamera(), []);

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
      <div className="row mb">
        <Heading level={1} data-size="lg">{t('scan.title')}</Heading>
      </div>

      <video ref={videoRef} className="scan-video" playsInline muted />
      <div className="row mt">
        {!cameraOn ? (
          <Button variant="primary" onClick={startCamera}>📷 {t('scan.start')}</Button>
        ) : (
          <Button variant="secondary" onClick={stopCamera}>{t('scan.stop')}</Button>
        )}
        {cameraOn && <span className="muted">{t('scan.hint')}</span>}
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

      {result && (
        <div className="mt" style={{ border: '1px solid var(--ds-color-border-subtle)', borderRadius: 12, padding: 16 }}>
          {result.product ? (
            <>
              <div className="row">
                <BottleThumb item={{ ...(fakeItem(result.product)), } as CellarItem} />
                <div style={{ flex: 1 }}>
                  <Heading level={2} data-size="lg">{result.product.longName ?? result.product.name}</Heading>
                  <span className="muted">{result.product.subCategory ?? result.product.category}</span>
                </div>
              </div>
              <div className="mt"><ProductFacts product={result.product} /></div>
              <div className="mt row" style={{ flexWrap: 'wrap' }}>
                {qtyStepper}
                <Button variant="primary" onClick={addProduct}>＋ {t('scan.add')}{qty > 1 ? ` ×${qty}` : ''}</Button>
                {bottlesForResult.length > 0 && (
                  <Button variant="secondary" onClick={() => setTakeOutCode(result.code)}>{t('scan.take_out')} ({bottlesForResult.length})</Button>
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

      {takeOutCode && result?.product && (
        <TakeOutDialog
          bottles={bottlesForResult}
          onClose={() => setTakeOutCode(null)}
          onDone={async (id) => {
            await api.removeBottle(id, 'drank');
            setTakeOutCode(null);
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
