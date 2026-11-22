import { Helmet } from 'react-helmet-async';
import { useLocation } from 'react-router-dom';
import { aboutStructuredData, SITE_ORIGIN } from '../lib/seo/identity';

const PRIVATE = new Set(['/admin', '/applications', '/signin', '/reset-password', '/submit']);
export function RouteMetadata() {
  const { pathname, search } = useLocation();
  const path = pathname.replace(/\/+$/, '') || '/';
  const filtered = Boolean(search) && (path === '/browse' || path === '/map');
  return <Helmet>
    <link rel="canonical" href={`${SITE_ORIGIN}${path}`} />
    {path === '/about' && <script type="application/ld+json">{JSON.stringify(aboutStructuredData()).replace(/</g, '\\u003c')}</script>}
    {(PRIVATE.has(path) || filtered) && <meta name="robots" content="noindex,follow" />}
  </Helmet>;
}
