import { Link } from 'react-router-dom';

export function Footer() {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-10">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row">
          <div>
            <p className="text-lg font-bold text-navy">Launchpad</p>
            <p className="mt-1 max-w-sm text-sm text-slate-500">
              Live internships, co-ops, and early career roles at top companies, fast growing teams,
              and public institutions, all in one place.
            </p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm">
            <Link to="/browse" className="text-slate-600 hover:text-navy">Browse opportunities</Link>
            <Link to="/map" className="text-slate-600 hover:text-navy">Explore map</Link>
            <Link to="/resources" className="text-slate-600 hover:text-navy">Career resources</Link>
            <Link to="/submit" className="text-slate-600 hover:text-navy">Submit a role</Link>
          </nav>
        </div>
        <p className="mt-8 text-xs text-slate-400">
          Every opportunity is verified against live employer feeds. Browsing and applying never require an account.
        </p>
        <p className="mt-2 text-xs text-slate-400">
          Built by Maxim Culbeaux
        </p>
      </div>
    </footer>
  );
}
