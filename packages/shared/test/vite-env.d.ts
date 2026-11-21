// Vite's import.meta.glob, used by the bundle-secrecy test (the shared lib config has no vite types).
interface ImportMeta {
  glob<T>(pattern: string, options: { query: string; import: string; eager: true }): Record<string, T>;
}
