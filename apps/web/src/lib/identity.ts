const TOKEN_KEY = 'kg.token';
const NAME_KEY = 'kg.name';

export function getToken(): string {
  let t = localStorage.getItem(TOKEN_KEY);
  if (!t) {
    t = crypto.randomUUID();
    localStorage.setItem(TOKEN_KEY, t);
  }
  return t;
}

export function getName(): string | null {
  const n = localStorage.getItem(NAME_KEY)?.trim();
  return n ? n : null;
}

export function setName(n: string): void {
  localStorage.setItem(NAME_KEY, n.trim());
}
