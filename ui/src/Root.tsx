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
    return <div className="auth-shell">Loading</div>;
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
      <form className="auth-panel" onSubmit={(event) => void submit(event, 'login')}>
        <div className="mark">S</div>
        <h1>Sheetbase</h1>
        <label>
          Email
          <Input autoComplete="email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
        </label>
        <label>
          Password
          <Input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
        </label>
        {error ? <p className="auth-error">{error}</p> : null}
        <Button type="submit" size="sm">Sign in</Button>
        <Button onClick={(event) => void submit(event, 'setup')} type="button" variant="outline" size="sm">Create first admin</Button>
      </form>
    </main>
  );
}
