import { isValidCode } from '@kg/shared';
import { Home } from './pages/Home';
import { PictionaryRoom, RoomError } from './pages/PictionaryRoom';

export function App() {
  const m = /^\/pictionary\/([^/]+)\/?$/.exec(location.pathname);
  if (m) {
    let code: string;
    try {
      code = decodeURIComponent(m[1]!).trim().toUpperCase();
    } catch {
      code = '';
    }
    // A malformed code can never exist (the worker 404s its socket): say so instead of retrying forever.
    if (!isValidCode(code)) return <RoomError error="not_found" />;
    return <PictionaryRoom key={code} code={code} />;
  }
  return <Home />;
}
