type WorkerEnv = import('../src/index').Env;

declare namespace Cloudflare {
  interface Env extends WorkerEnv {
    /** D1 migrations read by vitest.config.ts, applied by test/apply-migrations.ts. */
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
  }
}
