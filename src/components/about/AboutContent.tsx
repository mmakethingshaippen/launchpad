export { ABOUT_TITLE, ABOUT_DESCRIPTION } from '../../lib/seo/identity';

/** Shared by the interactive page and its server-rendered HTML. */
export function AboutContent() {
  return (
    <article className="mx-auto max-w-4xl space-y-12 pb-10">
      <header className="rounded-2xl bg-navy px-6 py-12 text-white sm:px-10">
        <p className="text-sm font-semibold uppercase tracking-widest text-cyan">Our Mission</p>
        <h1 className="mt-4 max-w-2xl text-3xl font-bold leading-tight sm:text-5xl">Make the first career step easier to find.</h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-200">Finding an internship or a first job should feel manageable. Too often, it means searching across dozens of websites, opening outdated listings, and trying to figure out which opportunities are actually meant for someone starting out.</p>
      </header>

      <section className="space-y-4 px-1 text-lg leading-relaxed text-slate-700">
        <p>Launchpad brings internships, co-ops, and early-career opportunities together in one place. You can explore openings by location, compare options, and keep track of your applications.</p>
        <p>Our mission is to make that search clearer, more organized, and easier to navigate.</p>
      </section>

      <section aria-labelledby="better-search">
        <h2 id="better-search" className="text-2xl font-bold text-navy">Built around a better search</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h3 className="font-semibold text-navy">Keep opportunities current.</h3>
            <p className="mt-3 leading-relaxed text-slate-600">We check listings against available sources and temporarily hide opportunities that haven’t been verified recently. Outside sources can become unavailable, so we show verification information to help you judge each listing.</p>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h3 className="font-semibold text-navy">Make exploration simple.</h3>
            <p className="mt-3 leading-relaxed text-slate-600">Search for a specific opportunity or use the map to discover where your next step could take you.</p>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h3 className="font-semibold text-navy">Keep access straightforward.</h3>
            <p className="mt-3 leading-relaxed text-slate-600">Browsing opportunities and following application links do not require an account. Optional tools help you save opportunities and organize your search.</p>
          </section>
        </div>
      </section>

      <section aria-labelledby="creator-name" className="grid items-start gap-8 rounded-2xl border border-slate-200 bg-white p-6 sm:grid-cols-[220px_1fr] sm:p-8">
        <img src="/maxim-culbeaux.jpg" alt="Maxim Culbeaux, creator of Launchpad" width="600" height="750" loading="lazy" className="aspect-[4/5] w-full max-w-[260px] rounded-xl object-cover" />
        <div className="space-y-4 leading-relaxed text-slate-700">
          <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">About the Creator</p>
          <h2 id="creator-name" className="text-3xl font-bold text-navy">Maxim Culbeaux</h2>
          <p>Consultant and Builder.</p>
          <p>Launchpad was created by Maxim Culbeaux with a focus on helping people discover opportunities at the beginning of their careers.</p>
          <p>The project brings together job discovery, location-based exploration, and application tracking in one place. Its guiding idea is simple: useful tools should make a complicated process easier to understand and manage.</p>
          <p>Launchpad continues to evolve around that purpose.</p>
        </div>
      </section>

      <section className="rounded-2xl bg-slate-100 px-6 py-8 text-center">
        <h2 className="text-2xl font-bold text-navy">Your career starts somewhere. Find your Launchpad.</h2>
        <a href="/browse" className="mt-6 inline-flex rounded-lg bg-navy px-5 py-3 font-semibold text-white hover:bg-navy/90">Explore opportunities</a>
      </section>
    </article>
  );
}
