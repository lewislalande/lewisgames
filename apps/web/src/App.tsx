import { Home } from './pages/Home';
import { PictionaryRoom } from './pages/PictionaryRoom';

export function App() {
  const m = /^\/pictionary\/([^/]+)\/?$/.exec(location.pathname);
  if (m) {
    const code = decodeURIComponent(m[1]).toUpperCase();
    return <PictionaryRoom key={code} code={code} />;
  }
  return <Home />;
}
