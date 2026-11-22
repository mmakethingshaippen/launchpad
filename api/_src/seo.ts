import { handleSeoRequest } from '../../src/lib/seo/server';

declare const __SEO_SHELL__: string;
declare const __SEO_PUBLIC_CONFIG__: { url?: string; anonKey?: string };

export default async function handler(req: { url?: string; method?: string }, res: {
  setHeader(name: string, value: string): void;
  status(code: number): { send(body: string): void };
}) {
  const result = await handleSeoRequest(req.url ?? '/', {
    shell: __SEO_SHELL__,
    supabaseUrl: process.env.VITE_SUPABASE_URL || __SEO_PUBLIC_CONFIG__.url,
    anonKey: process.env.VITE_SUPABASE_ANON_KEY || __SEO_PUBLIC_CONFIG__.anonKey,
  });
  for (const [name, value] of Object.entries(result.headers)) res.setHeader(name, value);
  res.status(result.status).send(req.method === 'HEAD' ? '' : result.body);
}
