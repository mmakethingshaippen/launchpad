import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Rocket, LogOut, ShieldCheck } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useAuth } from '../../hooks/useAuth';

const LINKS = [
  { to: '/browse', label: 'Browse' },
  { to: '/map', label: 'Map' },
  { to: '/resources', label: 'Resources' },
  { to: '/applications', label: 'My Applications' },
  { to: '/submit', label: 'Submit' },
];

export function Navbar() {
  const { user, signOut, isCloud } = useAuth();
  const navigate = useNavigate();

  const onSignOut = async () => {
    await signOut();
    navigate('/');
  };

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

        {/* Auth controls (right side) */}
        <div className="flex items-center gap-2">
          {user ? (
            <>
              {user.accountRole === 'admin' && (
                <NavLink
                  to="/admin"
                  className={({ isActive }) =>
                    cn(
                      'hidden items-center gap-1 rounded-md px-3 py-2 text-sm font-medium sm:inline-flex',
                      isActive ? 'bg-cyan/10 text-navy' : 'text-slate-600 hover:text-navy',
                    )
                  }
                >
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Admin
                </NavLink>
              )}
              <span className="hidden max-w-[12rem] truncate text-sm text-slate-500 lg:inline" title={user.email ?? undefined}>
                {user.email}
              </span>
              <button
                onClick={onSignOut}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-navy hover:bg-navy/5"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" /> Sign Out
              </button>
            </>
          ) : (
            // Only advertise sign-in when a cloud backend is actually configured.
            isCloud && (
              <Link
                to="/signin"
                className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-navy hover:bg-cyan/90"
              >
                Sign In
              </Link>
            )
          )}
        </div>
      </nav>
    </header>
  );
}
