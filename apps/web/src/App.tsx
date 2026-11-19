import { isValidCode } from '@kg/shared';
import { Admin } from './pages/Admin';
import { Home } from './pages/Home';
import { PictionaryRoom } from './pages/PictionaryRoom';
import { QuizRoom } from './pages/QuizRoom';
import { RoomError } from './room/RoomError';

export function App() {
  if (/^\/admin\/?$/.test(location.pathname)) return <Admin />;
  const m = /^\/(pictionary|quiz)\/([^/]+)\/?$/.exec(location.pathname);
  if (m) {
    let code: string;
    try {
      code = decodeURIComponent(m[2]!).trim().toUpperCase();
    } catch {
      code = '';
    }
    // A malformed code can never exist (the worker 404s its socket): say so instead of retrying forever.
    if (!isValidCode(code)) return <RoomError error="not_found" />;
    return m[1] === 'quiz' ? <QuizRoom key={code} code={code} /> : <PictionaryRoom key={code} code={code} />;
  }
  return <Home />;
}
