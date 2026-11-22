export const SITE_ORIGIN = 'https://launchpad-careers.vercel.app';
export const ABOUT_TITLE = 'Our Mission & Maxim Culbeaux, Creator of Launchpad';
export const ABOUT_DESCRIPTION = 'Meet Maxim Culbeaux, creator of Launchpad, and learn about our mission to make internships, co-ops, and early-career opportunities easier to find.';
export function aboutStructuredData() {
  return { '@context': 'https://schema.org', '@graph': [
    { '@type': 'AboutPage', '@id': `${SITE_ORIGIN}/about`, url: `${SITE_ORIGIN}/about`, name: ABOUT_TITLE, about: { '@id': `${SITE_ORIGIN}/about#creator` } },
    { '@type': 'Person', '@id': `${SITE_ORIGIN}/about#creator`, name: 'Maxim Culbeaux', url: `${SITE_ORIGIN}/about`, image: `${SITE_ORIGIN}/maxim-culbeaux.jpg`, description: 'Creator of Launchpad' },
    { '@type': 'WebSite', '@id': `${SITE_ORIGIN}/#website`, url: `${SITE_ORIGIN}/`, name: 'Launchpad', creator: { '@id': `${SITE_ORIGIN}/about#creator` } },
  ] };
}
