import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { DataAdapter } from '../lib/adapter';
import { getAdapter } from '../lib/adapter';

const AdapterContext = createContext<DataAdapter | null>(null);

export function AdapterProvider({
  children,
  adapter,
}: {
  children: ReactNode;
  adapter?: DataAdapter;
}) {
  const [resolved, setResolved] = useState<DataAdapter | null>(adapter ?? null);

  useEffect(() => {
    if (adapter) {
      setResolved(adapter);
      return;
    }
    let active = true;
    getAdapter().then((a) => {
      if (active) setResolved(a);
    });
    return () => {
      active = false;
    };
  }, [adapter]);

  if (!resolved) return null;
  return <AdapterContext.Provider value={resolved}>{children}</AdapterContext.Provider>;
}

export function useAdapter(): DataAdapter {
  const ctx = useContext(AdapterContext);
  if (!ctx) throw new Error('useAdapter must be used within an AdapterProvider');
  return ctx;
}
