import { useRouter } from './router';
import { Layout } from './components/Layout';
import { LandingPage } from './pages/LandingPage';
import { MarketsPage } from './pages/MarketsPage';
import { MarketDetailPage } from './pages/MarketDetailPage';
import { PortfolioPage } from './pages/PortfolioPage';
import { LeaderboardPage } from './pages/LeaderboardPage';

function AppRouter() {
  const { route } = useRouter();

  // Landing page has its own full-bleed layout (no shared navbar/footer)
  if (route.page === 'landing') {
    return <LandingPage />;
  }

  return (
    <Layout>
      {route.page === 'markets' && <MarketsPage />}
      {route.page === 'market' && <MarketDetailPage matchId={route.id} />}
      {route.page === 'portfolio' && <PortfolioPage />}
      {route.page === 'leaderboard' && <LeaderboardPage />}
    </Layout>
  );
}

export default function App() {
  return <AppRouter />;
}
