import { Database, LockKeyhole } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { App } from './App';
import { currentUser, loginUser, logoutUser, setupUser } from './auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function Root() {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    void currentUser().then((ok) => {
      setAuthenticated(ok);
      setReady(true);
    });
  }, []);

  if (!ready) {
    return <div className="auth-shell"><div className="loading-mark" aria-label="Loading Sheetbase"><Database size={18} /></div></div>;
  }

  if (!authenticated) {
    return <AuthScreen onAuthenticated={() => setAuthenticated(true)} />;
  }

  return <App onSignOut={() => {
    void logoutUser().finally(() => setAuthenticated(false));
  }} />;
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (event: FormEvent<HTMLElement>, mode: 'setup' | 'login') => {
    event.preventDefault();
    setError('');
    try {
      if (mode === 'setup') {
        await setupUser(email, password);
      } else {
        await loginUser(email, password);
      }
      onAuthenticated();
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Authentication failed');
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="auth-brand">
          <div className="auth-brand-lockup">
            <div className="mark"><Database size={17} /></div>
            <strong>Sheetbase</strong>
          </div>
          <div className="auth-brand-copy">
            <h1>Your data, structured at the source.</h1>
            <p>Create spreadsheet-friendly datasets backed by PostgreSQL and available through an API.</p>
          </div>
          <div className="auth-proof"><span aria-hidden="true" />PostgreSQL workspace</div>
        </div>
        <form className="auth-form" onSubmit={(event) => void submit(event, 'login')}>
          <div className="auth-form-heading">
            <div className="auth-form-icon"><LockKeyhole size={16} /></div>
            <div>
              <h2>Sign in to Sheetbase</h2>
              <p>Use your workspace administrator account.</p>
            </div>
          </div>
          <label>
            Email address
            <Input aria-label="Email" autoComplete="email" onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" type="email" value={email} />
          </label>
          <label>
            Password
            <Input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" type="password" value={password} />
          </label>
          {error ? <p className="auth-error">{error}</p> : null}
          <Button type="submit" size="sm">Sign in</Button>
          <div className="auth-separator"><span>New installation?</span></div>
          <Button onClick={(event) => void submit(event, 'setup')} type="button" variant="outline" size="sm">Create first admin</Button>
        </form>
      </section>
    </main>
  );
}
