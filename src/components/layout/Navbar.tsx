import { Link, NavLink } from 'react-router-dom';
import { Rocket } from 'lucide-react';
import { cn } from '../../lib/cn';

const LINKS = [
  { to: '/browse', label: 'Browse' },
  { to: '/map', label: 'Map' },
  { to: '/resources', label: 'Resources' },
  { to: '/applications', label: 'My Applications' },
  { to: '/submit', label: 'Submit' },
];

export function Navbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4" aria-label="Main">
        <Link to="/" className="flex items-center gap-2 font-bold text-navy">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy text-cyan">
            <Rocket className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="text-lg">Launchpad</span>
        </Link>
        <ul className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <li key={l.to}>
              <NavLink
                to={l.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive ? 'bg-cyan/10 text-navy' : 'text-slate-600 hover:text-navy',
                  )
                }
              >
                {l.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <Link
          to="/browse"
          className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-navy hover:bg-cyan/90 md:hidden"
        >
          Browse
        </Link>
      </nav>
    </header>
  );
}
