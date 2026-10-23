import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Rocket, LogOut, ShieldCheck, Menu, X } from 'lucide-react';
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
  const [mobileOpen, setMobileOpen] = useState(false);

  const onSignOut = async () => {
    await signOut();
    setMobileOpen(false);
    navigate('/');
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4" aria-label="Main">
        <div className="flex items-center gap-6">
          <Link to="/" onClick={() => setMobileOpen(false)} className="flex items-center gap-2 font-bold text-navy">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy text-cyan shadow-sm">
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
                      isActive ? 'bg-cyan/10 text-navy font-semibold' : 'text-slate-600 hover:text-navy',
                    )
                  }
                >
                  {l.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>

        {/* Right side controls */}
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
                className="hidden sm:inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-navy hover:bg-slate-50 transition-colors"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" /> Sign Out
              </button>
            </>
          ) : (
            isCloud && (
              <Link
                to="/signin"
                className="hidden sm:inline-flex rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-navy hover:bg-cyan/90 transition-colors shadow-sm"
              >
                Sign In
              </Link>
            )
          )}

          {/* Mobile hamburger button */}
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="inline-flex items-center justify-center rounded-lg p-2 text-slate-600 hover:bg-slate-100 hover:text-navy md:hidden transition-colors"
            aria-expanded={mobileOpen}
            aria-label="Toggle navigation menu"
          >
            {mobileOpen ? <X className="h-6 w-6" aria-hidden="true" /> : <Menu className="h-6 w-6" aria-hidden="true" />}
          </button>
        </div>
      </nav>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="border-b border-slate-200 bg-white px-4 py-4 md:hidden shadow-lg animate-in slide-in-from-top-2">
          <ul className="space-y-1">
            {LINKS.map((l) => (
              <li key={l.to}>
                <NavLink
                  to={l.to}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'block rounded-md px-3 py-2 text-base font-medium transition-colors',
                      isActive ? 'bg-cyan/10 text-navy font-semibold' : 'text-slate-600 hover:bg-slate-50 hover:text-navy',
                    )
                  }
                >
                  {l.label}
                </NavLink>
              </li>
            ))}
            {user?.accountRole === 'admin' && (
              <li>
                <NavLink
                  to="/admin"
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 rounded-md px-3 py-2 text-base font-medium transition-colors',
                      isActive ? 'bg-cyan/10 text-navy font-semibold' : 'text-slate-600 hover:bg-slate-50 hover:text-navy',
                    )
                  }
                >
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" /> Admin Dashboard
                </NavLink>
              </li>
            )}
          </ul>

          <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col gap-2">
            {user ? (
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500 truncate max-w-[15rem]">{user.email}</span>
                <button
                  onClick={onSignOut}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-navy hover:bg-slate-50"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" /> Sign Out
                </button>
              </div>
            ) : (
              isCloud && (
                <Link
                  to="/signin"
                  onClick={() => setMobileOpen(false)}
                  className="block w-full text-center rounded-lg bg-cyan py-2 text-sm font-semibold text-navy hover:bg-cyan/90 transition-colors shadow-sm"
                >
                  Sign In
                </Link>
              )
            )}
          </div>
        </div>
      )}
    </header>
  );
}
