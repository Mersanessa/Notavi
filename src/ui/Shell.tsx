import type { ReactNode } from 'react';
import { ChartNoAxesColumn, Folders, House, LibraryBig, Search, Settings } from 'lucide-react';
import { href, routes, useRoute } from '../app/router';

const NAV = [
  { to: routes.home(), match: (p: string) => p === '/', label: 'Home', icon: House, tab: true },
  { to: routes.library(), match: (p: string) => p.startsWith('/library') || p.startsWith('/novel') || p === '/import' || p === '/new', label: 'Library', icon: LibraryBig, tab: true },
  { to: routes.search(), match: (p: string) => p.startsWith('/search'), label: 'Search', icon: Search, tab: true },
  { to: routes.collections(), match: (p: string) => p.startsWith('/collections'), label: 'Collections', icon: Folders, tab: false },
  { to: routes.stats(), match: (p: string) => p.startsWith('/stats'), label: 'Stats', icon: ChartNoAxesColumn, tab: true },
  { to: routes.settings(), match: (p: string) => p.startsWith('/settings'), label: 'Settings', icon: Settings, tab: true },
];

function Wordmark() {
  return (
    <a className="wordmark" href={href('/')} aria-label="Notavi home">
      <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden>
        <rect x="5" y="4" width="18" height="24" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M9 4v24" stroke="currentColor" strokeWidth="1.6" />
        <path d="M17 4v11l2.5-2 2.5 2V4" fill="var(--brass)" stroke="var(--brass)" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    </a>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { path } = useRoute();
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <nav className="rail" aria-label="Main">
        <Wordmark />
        <ul className="rail__list">
          {NAV.map((n) => {
            const on = n.match(path);
            return (
              <li key={n.label}>
                <a className={`rail__item ${on ? 'is-on' : ''}`} href={href(n.to)} aria-current={on ? 'page' : undefined}>
                  <n.icon size={22} strokeWidth={on ? 2 : 1.6} aria-hidden />
                  <span>{n.label}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      <main id="main" className="shell__main" tabIndex={-1}>
        {children}
      </main>
      <nav className="tabbar" aria-label="Main">
        {NAV.filter((n) => n.tab).map((n) => {
          const on = n.match(path) || (n.label === 'Library' && path.startsWith('/collections'));
          return (
            <a key={n.label} className={`tabbar__item ${on ? 'is-on' : ''}`} href={href(n.to)} aria-current={on ? 'page' : undefined}>
              <n.icon size={22} strokeWidth={on ? 2 : 1.6} aria-hidden />
              <span>{n.label}</span>
            </a>
          );
        })}
      </nav>
    </div>
  );
}
