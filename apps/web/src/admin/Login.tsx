import { useState } from 'react';
import { adminApi } from './api';

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    const res = await adminApi.login(password);
    setBusy(false);
    if (res.ok) return onLoggedIn();
    setPassword('');
    setError(res.unauthorized ? 'Mot de passe incorrect' : 'Connexion impossible. Réessaie dans un instant.');
  }

  return (
    <main className="narrow">
      <form className="card" onSubmit={submit}>
        <h2>Administration</h2>
        <label htmlFor="admin-password">Mot de passe</label>
        <input id="admin-password" type="password" className="text-input" value={password} autoComplete="current-password" autoFocus onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy || !password}>Se connecter</button>
      </form>
    </main>
  );
}
