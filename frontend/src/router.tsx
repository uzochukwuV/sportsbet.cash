import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Lightweight hash router — no extra dependencies
// ---------------------------------------------------------------------------

export type Route =
  | { page: 'landing' }
  | { page: 'markets' }
  | { page: 'market'; id: string }
  | { page: 'portfolio' }
  | { page: 'leaderboard' };

function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (!path || path === 'markets') return { page: 'markets' };
  if (path === 'landing') return { page: 'landing' };
  if (path === 'portfolio') return { page: 'portfolio' };
  if (path === 'leaderboard') return { page: 'leaderboard' };
  if (path.startsWith('market/')) return { page: 'market', id: path.slice(7) };
  return { page: 'markets' };
}

function routeToHash(route: Route): string {
  switch (route.page) {
    case 'landing': return '#/landing';
    case 'markets': return '#/markets';
    case 'market': return `#/market/${route.id}`;
    case 'portfolio': return '#/portfolio';
    case 'leaderboard': return '#/leaderboard';
  }
}

interface RouterContextType {
  route: Route;
  navigate: (route: Route) => void;
  href: (route: Route) => string;
}

const RouterContext = createContext<RouterContextType | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((next: Route) => {
    window.location.hash = routeToHash(next);
    setRoute(next);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  const href = useCallback((r: Route) => routeToHash(r), []);

  return (
    <RouterContext.Provider value={{ route, navigate, href }}>
      {children}
    </RouterContext.Provider>
  );
}

export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter must be used within RouterProvider');
  return ctx;
}

/** Anchor that navigates without full reload */
export function Link({
  to,
  children,
  className,
  onClick,
}: {
  to: Route;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const { navigate, href } = useRouter();
  return (
    <a
      href={href(to)}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
        onClick?.();
      }}
    >
      {children}
    </a>
  );
}
