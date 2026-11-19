import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': { target: 'http://localhost:8787', ws: true } },
  },
  test: { environment: 'jsdom', include: ['test/**/*.test.ts'] },
});
