import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Heading, Label, Input } from '@digdir/designsystemet-react';
import { api } from '../api';
import type { User } from '../types';

export default function AuthPage({ onAuthed }: { onAuthed: (u: User) => void }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      if (mode === 'login') {
        await api.login(email.trim(), password);
      } else {
        await api.register(name.trim(), email.trim(), password);
      }
      const u = await api.me();
      if (u) onAuthed(u);
      else setErr(t('common.error'));
    } catch (ex) {
      const msg = ex instanceof Error ? ex.message : t('common.error');
      setErr(msg === 'email_taken' ? t('auth.err_taken') : msg === 'bad_credentials' ? t('auth.err_creds') : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>{t('app.name')}</h1>
      </header>
      <main className="app-main" style={{ paddingTop: 48 }}>
        <div style={{ maxWidth: 420, margin: '0 auto', display: 'grid', gap: 16 }}>
          <Heading level={2} data-size="lg">
            {mode === 'login' ? t('auth.login_title') : t('auth.register_title')}
          </Heading>
          <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
            {mode === 'register' && (
              <div>
                <Label htmlFor="a-name">{t('auth.name')}</Label>
                <Input id="a-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
            )}
            <div>
              <Label htmlFor="a-email">{t('auth.email')}</Label>
              <Input id="a-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <div>
              <Label htmlFor="a-pass">{t('auth.password')}</Label>
              <Input
                id="a-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={mode === 'register' ? 8 : undefined}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
              {mode === 'register' && <span className="muted">{t('auth.hint')}</span>}
            </div>
            {err && <Alert data-color="danger">{err}</Alert>}
            <Button type="submit" variant="primary" loading={busy}>
              {mode === 'login' ? t('auth.login') : t('auth.register')}
            </Button>
          </form>
          <Button variant="tertiary" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr(''); }}>
            {mode === 'login' ? t('auth.register') : t('auth.login')}
          </Button>
        </div>
      </main>
    </div>
  );
}
