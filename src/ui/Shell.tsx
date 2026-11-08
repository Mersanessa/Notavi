import { useRef, type ReactNode } from 'react';
import { useSlidingIndicator } from './components/Fields';
import { Waypoints, Folders, House, LibraryBig, Search, Settings } from 'lucide-react';
import { href, routes, useRoute } from '../app/router';
import { Wordmark } from './components/Wordmark';

const NAV = [
  { to: routes.home(), match: (p: string) => p === '/', label: 'Home', icon: House, tab: true },
  { to: routes.library(), match: (p: string) => p.startsWith('/library') || p.startsWith('/novel') || p === '/import' || p === '/new', label: 'Library', icon: LibraryBig, tab: true },
  { to: routes.search(), match: (p: string) => p.startsWith('/search'), label: 'Search', icon: Search, tab: true },
  { to: routes.collections(), match: (p: string) => p.startsWith('/collections'), label: 'Collections', icon: Folders, tab: false },
  { to: routes.lore(), match: (p: string) => p.startsWith('/lore'), label: 'Lore', icon: Waypoints, tab: true },
  { to: routes.settings(), match: (p: string) => p.startsWith('/settings'), label: 'Settings', icon: Settings, tab: true },
];

function RailMark() {
  return (
    <a className="rail-mark" href={href('/')} aria-label="Notavi home">
      <Wordmark height={17} title="Notavi" />
    </a>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { path } = useRoute();
  const railRef = useRef<HTMLUListElement>(null);
  const tabRef = useRef<HTMLElement>(null);
  const railInd = useSlidingIndicator(railRef, '.rail__item.is-on', [path]);
  const tabInd = useSlidingIndicator(tabRef, '.tabbar__item.is-on', [path]);
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <nav className="rail" aria-label="Main">
        <RailMark />
        <ul className="rail__list" ref={railRef}>
          <span className="slider-indicator rail__indicator" style={railInd} aria-hidden />
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
      <nav className="tabbar" aria-label="Main" ref={tabRef}>
        <span className="slider-indicator tabbar__indicator" style={tabInd} aria-hidden />
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
