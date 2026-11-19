import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../admin/api';
import { Login } from '../admin/Login';
import { QuestionList } from '../admin/QuestionList';
import { ImportPanel } from '../admin/ImportPanel';
import { WordsPanel } from '../admin/WordsPanel';

type Auth = 'loading' | 'login' | 'in' | 'disabled' | 'error';
type Tab = 'questions' | 'import' | 'words';
const TABS: { id: Tab; label: string }[] = [
  { id: 'questions', label: 'Questions' },
  { id: 'import', label: 'Import / export' },
  { id: 'words', label: 'Mots du Pictionary' },
];

export function Admin() {
  const [auth, setAuth] = useState<Auth>('loading');
  const [tab, setTab] = useState<Tab>('questions');
  const loggedOut = useCallback(() => setAuth('login'), []);

  useEffect(() => {
    void adminApi.me().then((res) => {
      setAuth(res.ok ? 'in' : res.disabled ? 'disabled' : res.unauthorized ? 'login' : 'error');
    });
  }, []);

  async function logout() {
    await adminApi.logout();
    setAuth('login');
  }

  if (auth === 'loading') return <main className="narrow"><p className="status">Chargement…</p></main>;
  if (auth === 'disabled') {
    return <main className="narrow"><p className="error" role="alert">L'admin n'est pas configuré (ADMIN_PASSWORD / ADMIN_SECRET manquants).</p></main>;
  }
  if (auth === 'error') return <main className="narrow"><p className="error" role="alert">Impossible de joindre le serveur. Recharge la page.</p></main>;
  if (auth === 'login') return <Login onLoggedIn={() => { setTab('questions'); setAuth('in'); }} />;

  return (
    <main className="admin">
      <header className="adm-head">
        <h1>Administration</h1>
        <nav className="adm-tabs" role="tablist" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} className={`adm-tab${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </nav>
        <button className="btn btn-sm" type="button" onClick={() => void logout()}>Se déconnecter</button>
      </header>
      {tab === 'questions' && <QuestionList onUnauthorized={loggedOut} />}
      {tab === 'import' && <ImportPanel onUnauthorized={loggedOut} />}
      {tab === 'words' && <WordsPanel onUnauthorized={loggedOut} />}
    </main>
  );
}
