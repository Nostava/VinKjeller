import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Heading, Input, Label, Select, Textarea } from '@digdir/designsystemet-react';
import { api } from '../api';
import type { Feedback, FeedbackStatus, FeedbackType, User } from '../types';

const TYPES: FeedbackType[] = ['bug', 'improvement', 'feature', 'other'];
const STATUSES: FeedbackStatus[] = ['PENDING', 'REPLYING', 'CLOSED'];

const typeColors: Record<FeedbackType, string> = {
  bug: '#b3261e',
  improvement: '#2563a8',
  feature: '#2e7d32',
  other: '#6b7280',
};

const statusColors: Record<FeedbackStatus, string> = {
  PENDING: '#b7791f',
  REPLYING: '#2563a8',
  CLOSED: '#2e7d32',
};

export default function FeedbackPage({ user, showToast }: { user: User; showToast: (m: string) => void }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'submit' | 'all' | 'mine'>('submit');

  // submit form
  const [type, setType] = useState<FeedbackType>('bug');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  // edit state (inline edit of your own PENDING row)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editMessage, setEditMessage] = useState('');

  // collapse long messages on small screens
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api.feedback();
      setItems(r.items.map((f) => ({ ...f, type: (f.type || 'other') as FeedbackType })));
    } catch {
      /* list stays empty on error */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, tab]);

  const myItems = items.filter((f) => f.userId === user.id);
  const shown = tab === 'mine' ? myItems : items;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || sending) return;
    setSending(true);
    try {
      await api.addFeedback({ type, title: title.trim(), message: message.trim() || null });
      setTitle('');
      setMessage('');
      showToast(t('feedback.sent'));
      setTab('all');
    } catch (ex) {
      showToast(ex instanceof Error ? ex.message : t('common.error'));
    } finally {
      setSending(false);
    }
  }

  function startEdit(f: Feedback) {
    setEditingId(f.id);
    setEditTitle(f.title);
    setEditMessage(f.message ?? '');
  }

  async function saveEdit(id: string) {
    if (!editTitle.trim()) return;
    try {
      await api.updateFeedback(id, { title: editTitle.trim(), message: editMessage.trim() || null });
      setEditingId(null);
      await refresh();
    } catch (ex) {
      showToast(ex instanceof Error ? ex.message : t('common.error'));
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t('feedback.delete_confirm'))) return;
    try {
      await api.removeFeedback(id);
      await refresh();
    } catch (ex) {
      showToast(ex instanceof Error ? ex.message : t('common.error'));
    }
  }

  async function setStatus(id: string, status: FeedbackStatus) {
    try {
      await api.setFeedbackStatus(id, status);
      await refresh();
    } catch (ex) {
      showToast(ex instanceof Error ? ex.message : t('common.error'));
    }
  }

  const tabBtn = (id: 'submit' | 'all' | 'mine', label: string) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
      style={{
        font: 'inherit',
        fontWeight: 600,
        padding: '8px 14px',
        borderRadius: 999,
        cursor: 'pointer',
        border: `1px solid ${tab === id ? 'var(--ds-color-accent-base-default)' : 'var(--ds-color-border-subtle)'}`,
        background: tab === id ? 'var(--ds-color-accent-base-default)' : 'var(--ds-color-background-subtle)',
        color: tab === id ? 'var(--ds-color-accent-base-contrast-default)' : 'var(--ds-color-text-default)',
      }}
    >
      {label}
    </button>
  );

  const pill = (label: string, color: string) => (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: '#fff',
        background: color,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );

  return (
    <div>
      <div className="row mb">
        <Heading level={1} data-size="lg">{t('feedback.title')}</Heading>
      </div>
      <p className="muted mb">{t('feedback.hint')}</p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} className="mb">
        {tabBtn('submit', t('feedback.submit'))}
        {tabBtn('all', `${t('feedback.all')} (${items.length})`)}
        {tabBtn('mine', `${t('feedback.mine')} (${myItems.length})`)}
      </div>

      {tab === 'submit' && (
        <form onSubmit={submit} style={{ display: 'grid', gap: 12, maxWidth: 560 }}>
          <div>
            <Label htmlFor="fb-type">{t('feedback.type')}</Label>
            <Select id="fb-type" value={type} onChange={(e) => setType(e.target.value as FeedbackType)}>
              {TYPES.map((ty) => (
                <option key={ty} value={ty}>{t(`feedback.type_${ty}`)}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="fb-title">{t('feedback.field_title')}</Label>
            <Input
              id="fb-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t(`feedback.title_ph_${type}`)}
              maxLength={120}
              required
            />
          </div>
          <div>
            <Label htmlFor="fb-message">{t('feedback.field_message')}</Label>
            <Textarea
              id="fb-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('feedback.message_ph')}
              rows={4}
              maxLength={2000}
            />
          </div>
          <Button type="submit" variant="primary" loading={sending} disabled={!title.trim()}>
            {t('feedback.send')}
          </Button>
        </form>
      )}

      {tab !== 'submit' && (
        <div style={{ display: 'grid', gap: 10 }}>
          {loading ? (
            <p className="muted">{t('common.loading')}</p>
          ) : shown.length === 0 ? (
            <Alert data-color="info">{tab === 'mine' ? t('feedback.empty_mine') : t('feedback.empty')}</Alert>
          ) : (
            shown.map((f) => {
              const mine = f.userId === user.id;
              const isEditing = editingId === f.id;
              const long = (f.message ?? '').length > 220;
              const expanded = expandedId === f.id || isEditing;
              return (
                <div
                  key={f.id}
                  style={{
                    border: '1px solid var(--ds-color-border-subtle)',
                    borderRadius: 12,
                    padding: 14,
                    background: 'var(--ds-color-background-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {pill(t(`feedback.type_${f.type}`), typeColors[f.type] ?? typeColors.other)}
                    {pill(t(`feedback.status_${f.status}`), statusColors[f.status])}
                    <span style={{ flex: 1 }} />
                    {mine && (
                      <Select
                        value={f.status}
                        onChange={(e) => setStatus(f.id, e.target.value as FeedbackStatus)}
                        aria-label={t('feedback.status')}
                        style={{ width: 'auto', padding: '2px 6px', fontSize: 13 }}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>{t(`feedback.status_${s}`)}</option>
                        ))}
                      </Select>
                    )}
                  </div>

                  {isEditing ? (
                    <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                      <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} maxLength={120} />
                      <Textarea value={editMessage} onChange={(e) => setEditMessage(e.target.value)} rows={3} maxLength={2000} />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button variant="primary" onClick={() => saveEdit(f.id)} disabled={!editTitle.trim()}>
                          {t('common.save')}
                        </Button>
                        <Button variant="secondary" onClick={() => setEditingId(null)}>
                          {t('common.cancel')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontWeight: 600, marginTop: 8 }}>{f.title}</div>
                      {f.message && (
                        <div
                            style={{
                              marginTop: 4,
                              fontSize: '0.95rem',
                              whiteSpace: 'pre-wrap',
                              overflowWrap: 'anywhere',
                              display: long && !expanded ? '-webkit-box' : undefined,
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: 'vertical',
                              overflow: long && !expanded ? 'hidden' : undefined,
                            }}
                            onClick={() => long && setExpandedId(expanded ? null : f.id)}
                          >
                          {f.message}
                        </div>
                      )}
                      {long && (
                        <button
                          onClick={() => setExpandedId(expanded ? null : f.id)}
                          style={{ font: 'inherit', fontSize: 13, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ds-color-accent-base-default)', marginTop: 4 }}
                        >
                          {expanded ? t('feedback.less') : t('feedback.more')}
                        </button>
                      )}
                      {f.adminNote && (
                        <div
                          style={{
                            marginTop: 10,
                            padding: '8px 12px',
                            borderLeft: '3px solid var(--ds-color-accent-base-default)',
                            background: 'var(--ds-color-background-default)',
                            borderRadius: 6,
                            fontSize: '0.9rem',
                          }}
                        >
                          <span style={{ fontWeight: 600 }}>{t('feedback.admin_note')}:</span> {f.adminNote}
                        </div>
                      )}
                    </>
                  )}

                  <div className="muted" style={{ marginTop: 10, fontSize: 13, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span>{f.userName || t('feedback.unknown_author')}</span>
                    <span aria-hidden>·</span>
                    <span>{new Date(f.createdAt).toLocaleDateString()}</span>
                    {mine && f.status === 'PENDING' && !isEditing && (
                      <>
                        <span style={{ flex: 1 }} />
                        <button onClick={() => startEdit(f)} style={actionBtnStyle}>
                          {t('feedback.edit')}
                        </button>
                        <button onClick={() => remove(f.id)} style={{ ...actionBtnStyle, color: 'var(--ds-color-error-base-default)' }}>
                          {t('feedback.delete')}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

const actionBtnStyle: React.CSSProperties = {
  font: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '2px 4px',
  color: 'var(--ds-color-accent-base-default)',
};
