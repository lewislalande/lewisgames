// `wrangler dev` refuses to start when assets.directory is missing. Until the web app has been
// built, create a placeholder page so the API can be developed on its own (dist/ is git-ignored).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const dist = new URL('../../web/dist/', import.meta.url);
if (!existsSync(new URL('index.html', dist))) {
  mkdirSync(dist, { recursive: true });
  writeFileSync(new URL('index.html', dist), '<!doctype html><title>kgames</title><p>Front non construit.</p>\n');
}
