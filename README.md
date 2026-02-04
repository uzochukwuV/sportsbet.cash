# SportsBet.cash

**On-Chain Sports Betting AMM for Bitcoin Cash**

A fully on-chain prediction market for simulated sports matches. Uses VRF (Verifiable Random Function) via commit-reveal scheme for fair, verifiable score generation, and AMM mechanics (CPMM) for continuous liquidity trading.

## Features

- **AMM Prediction Market** - Polymarket-style trading with Constant Product Market Maker
- **VRF Score Generation** - Verifiable random scores via cryptographic commit-reveal
- **Progressive Score Reveal** - Halftime scores revealed mid-match for dynamic trading
- **CashTokens Integration** - Outcome tokens as fungible CashTokens
- **Trustless Settlement** - Automatic payout based on final scores

## How It Works

### 1. Match Creation
```
Oracle generates: secret = random_256_bits
Oracle commits: hash256(secret || matchId)
Trading opens with 50/50 odds
```

### 2. Trading Phase 1 (Pre-Match)
```
Users buy HOME_WIN or AWAY_WIN tokens
Prices adjust based on demand (CPMM: x * y = k)
Price reflects market's implied probability
```

### 3. Halftime Reveal
```
Oracle reveals: secret
Scores generated: hash(secret + 'H') → deterministic scores
Anyone can verify: hash256(secret || matchId) == commitment
```

### 4. Trading Phase 2 (Halftime Trading)
```
Market reacts to halftime scores
New trading opportunity
Odds adjust based on current game state
```

### 5. Final Reveal & Settlement
```
Oracle reveals second half scores
Winners redeem tokens for 1 BCH unit each
Losers' tokens worth 0
Draws: both token types worth 0.5 BCH units
```

## AMM Mechanics

Uses Constant Product Market Maker (like Uniswap):

```
Formula: x * y = k

Where:
  x = HOME_WIN tokens in pool
  y = AWAY_WIN tokens in pool
  k = constant (liquidity depth)

Price calculation:
  Price(HOME) = y / (x + y)
  Price(AWAY) = x / (x + y)

Constraint: Price_HOME + Price_AWAY = 1
```

### Example Trade

```
Initial: 10,000 HOME, 10,000 AWAY
Prices: HOME = 0.50 (50%), AWAY = 0.50 (50%)

User buys 1,000 HOME tokens for ~1,111 sats:
New state: 9,000 HOME, 11,111 AWAY
New prices: HOME = 0.55 (55%), AWAY = 0.45 (45%)
```

## Installation

```bash
git clone https://github.com/uuzor/sportsbet.cash.git
cd sportsbet.cash
yarn install
```

## Quick Start

```bash
# Run the interactive demo
yarn demo
```

### Programmatic Usage

```typescript
import { createSportsBetClient, SportType } from 'sportsbet-cash';

// Create client
const client = createSportsBetClient('chipnet');

// Create a match
const match = await client.matchManager.createMatch({
  sportType: SportType.BASKETBALL,
  homeTeam: 'LAL1',
  awayTeam: 'GSW1',
  startTime: Math.floor(Date.now() / 1000) + 3600,
  halftimeTime: Math.floor(Date.now() / 1000) + 5400,
  endTime: Math.floor(Date.now() / 1000) + 7200,
  initialLiquidity: 1000000n
}, oracleSignature);

// Get current odds
const pool = await client.matchManager.getPool(match.config.matchId);
const state = await pool.getPoolState();
console.log(`Lakers: ${state.priceHome}, Warriors: ${state.priceAway}`);

// Buy tokens
const result = await pool.buyTokens({
  matchId: match.config.matchId,
  outcomeType: 'HOME_WIN',
  amount: 100000n, // sats
  maxSlippage: 0.01, // 1%
  isBuy: true
}, userUtxos, userAddress, signatureTemplate);
```

## Project Structure

```
sportsbet.cash/
├── contracts/
│   ├── amm-pool.cash         # AMM swap logic
│   ├── match-factory.cash    # Match creation & token minting
│   ├── oracle.cash           # VRF commit-reveal
│   └── settlement.cash       # Winner redemption
├── src/
│   ├── types.ts              # TypeScript type definitions
│   ├── amm.ts                # AMM calculations & pool interaction
│   ├── oracle.ts             # VRF/Oracle management
│   ├── match.ts              # Match lifecycle management
│   ├── settlement.ts         # Settlement & payout logic
│   └── index.ts              # Main exports
├── test/
│   ├── vrf.test.ts           # VRF/Oracle tests
│   ├── amm.test.ts           # AMM calculation tests
│   └── settlement.test.ts    # Settlement tests
└── scripts/
    └── demo.ts               # Interactive demo
```

## Scripts

```bash
# Build TypeScript
yarn build

# Compile CashScript contracts
yarn compile:contracts

# Run demo
yarn demo

# Run tests
yarn test

# Create a new match
yarn create-match

# Execute a trade
yarn trade

# Settle a match
yarn settle
```

## Sport Types

| Sport | Score Range (per half) | Typical Final |
|-------|------------------------|---------------|
| Basketball | 30-75 | 100-130 |
| Football (Soccer) | 0-4 | 0-5 |
| American Football | 0-28 | 14-35 |

## VRF Security Model

The commit-reveal scheme ensures fairness:

1. **Pre-commitment**: Oracle commits to randomness BEFORE any bets
2. **Unpredictability**: Users cannot predict outcomes from commitment
3. **Binding**: Oracle cannot change outcome after commitment
4. **Verifiability**: Anyone can verify the reveal matches commitment

```typescript
// Oracle commits (before trading)
commitment = hash256(hash256(secret || matchId))

// Oracle reveals (after trading closes)
reveal(secret)

// Anyone verifies
assert(hash256(hash256(secret || matchId)) === commitment)

// Scores derived deterministically
halfTimeScores = deriveScores(hash256(secret + 'H'))
finalScores = deriveScores(hash256(secret + 'F'))
```

## Token Model

Each match creates two fungible token categories:

| Token | Represents | Settlement |
|-------|------------|------------|
| `HOME_WIN` | Home team wins | 1.0 BCH if home wins |
| `AWAY_WIN` | Away team wins | 1.0 BCH if away wins |

**Draw Handling**: Both tokens redeem for 0.5 BCH units.

## Fee Structure

| Fee | Amount | Recipient |
|-----|--------|-----------|
| Trading Fee | 0.3% | Liquidity Pool |
| Protocol Fee | 0.1% | Treasury |

## Environment Configuration

Create a `.env` file:

```bash
# Oracle wallet
SEEDPHRASE_ORACLE = "your oracle seed phrase"
DERIVATIONPATH_ORACLE = "m/44'/145'/0'/0/0"

# Treasury wallet
SEEDPHRASE_TREASURY = "your treasury seed phrase"
DERIVATIONPATH_TREASURY = "m/44'/145'/0'/0/0"

# Network
NETWORK = "chipnet"  # or "mainnet"
```

## Security Considerations

1. **Oracle Trust**: Single oracle model - future versions will support multi-oracle threshold
2. **Front-running**: Mitigated by commit-reveal for both oracle and optionally user bets
3. **Liquidity**: Initial liquidity must be sufficient to prevent manipulation
4. **Time-locks**: State transitions are time-locked to prevent premature reveals

## Roadmap

### Phase 1: MVP (Current)
- [x] Architecture design
- [x] CashScript contracts (AMM, Oracle, Settlement)
- [x] TypeScript SDK
- [x] VRF commit-reveal implementation
- [x] Basic test suite

### Phase 2: Enhanced
- [ ] Contract deployment scripts
- [ ] Multi-oracle VRF
- [ ] LP token rewards
- [ ] Web UI

### Phase 3: Advanced
- [ ] ZK-private bets
- [ ] Additional sport types
- [ ] Cross-chain settlement
- [ ] Governance token

## Contributing

Contributions welcome! Please read our contributing guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [CashScript](https://cashscript.org/) - Bitcoin Cash smart contracts
- [Polymarket](https://polymarket.com/) - AMM prediction market inspiration
- [Uniswap](https://uniswap.org/) - CPMM formula

---

**SportsBet.cash** - Trustless. Verifiable. On-chain.
