import type { Connect, Plugin } from 'vite';
import { LocalStore } from '../src/lib/adapter/localStore.data';
import { syncAll, syncCompany } from '../src/lib/ats/sync';

/**
 * Vite dev middleware exposing POST /__sync so the SPA can trigger an ATS sync
 * locally (no cloud, no CORS). Returns the per-company SyncResult summary.
 *
 * GET  /__sync          → health/info
 * POST /__sync          → sync all companies
 * POST /__sync?id=<id>  → sync a single company
 */
export function devSyncPlugin(): Plugin {
  const store = new LocalStore();

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url ?? '';
    if (!url.startsWith('/__sync')) return next();

    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'GET') {
      res.end(
        JSON.stringify({
          ok: true,
          companies: store.syncableCompanies().length,
          roles: store.publicRoleCards().length,
        }),
      );
      return;
    }

    if (req.method === 'POST') {
      const id = new URLSearchParams(url.split('?')[1] ?? '').get('id');
      const run = async () => {
        if (id) {
          const company = store.syncableCompanies().find((c) => c.id === id);
          if (!company) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'company not found' }));
            return;
          }
          const result = await syncCompany(company, store, {});
          res.end(JSON.stringify([result]));
        } else {
          const results = await syncAll(store.syncableCompanies(), store, {});
          res.end(JSON.stringify(results));
        }
      };
      run().catch((err) => {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      });
      return;
    }

    next();
  };

  return {
    name: 'launchpad-dev-sync',
    configureServer(server) {
      server.middlewares.use(handler);
    },
  };
}
