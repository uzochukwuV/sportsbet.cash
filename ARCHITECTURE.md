# SportsBet.cash - On-Chain Sports Betting AMM for BCH

## Overview

A fully on-chain prediction market for simulated sports matches on Bitcoin Cash. Uses VRF (Verifiable Random Function) via commit-reveal scheme to generate match scores, with AMM-style trading of outcome tokens.

## Key Features

1. **AMM Prediction Market** (Polymarket-style)
   - Tradeable outcome tokens using CashTokens (FTs)
   - Constant Product Market Maker (CPMM) pricing
   - Dynamic prices reflecting market probability
   - Users can enter/exit positions anytime

2. **VRF Score Generation**
   - Commit-reveal scheme for verifiable randomness
   - Oracle commits to random seed before match
   - Reveal generates deterministic but unpredictable scores

3. **Progressive Score Reveal**
   - Halftime scores revealed mid-match
   - Second trading window after halftime
   - Final settlement after full match

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    MATCH LIFECYCLE                               │
├─────────────────────────────────────────────────────────────────┤
│  CREATE    →   TRADING   →   HALFTIME   →   TRADING   →  SETTLE │
│  Match         Phase 1       Reveal         Phase 2      Final  │
│                                                                  │
│  [Oracle     [Buy/Sell    [VRF Score    [Buy/Sell    [Redeem    │
│   Commit]     Tokens]      Reveal]       Tokens]      Winners]  │
└─────────────────────────────────────────────────────────────────┘
```

## Token Model

Each match creates **two fungible token categories**:

| Token | Represents | Settlement Value |
|-------|------------|------------------|
| `HOME_WIN` | Home team wins | 1.00 BCH if home wins, 0 if loses |
| `AWAY_WIN` | Away team wins | 1.00 BCH if away wins, 0 if loses |

**Note:** For draws, both tokens settle at 0.5 BCH, or we add a third `DRAW` token.

## AMM Mechanics (CPMM)

### Formula
```
x * y = k

Where:
- x = HOME_WIN tokens in pool
- y = AWAY_WIN tokens in pool
- k = constant (liquidity depth)

Price calculation:
- Price(HOME_WIN) = y / (x + y)
- Price(AWAY_WIN) = x / (x + y)
- Constraint: Price_HOME + Price_AWAY = 1
```

### Example Flow
```
Initial: 10,000 HOME, 10,000 AWAY
k = 100,000,000
Prices: HOME = 0.50 BCH, AWAY = 0.50 BCH

User buys 1,000 HOME tokens:
- New state: 9,000 HOME, 11,111 AWAY (k preserved)
- Cost: 1,111 - 10,000 = ~1,111 BCH worth
- New prices: HOME = 0.55, AWAY = 0.45
```

## Contract Architecture

### 1. MatchFactory Contract
- Creates new matches
- Mints initial outcome tokens
- Sets match parameters (teams, timing, oracle)

### 2. AMM Pool Contract
- Holds liquidity for one match
- Executes swaps (BCH ↔ tokens)
- Tracks reserves (x, y values)
- Implements CPMM pricing

### 3. Oracle Contract (VRF)
- Commit phase: Oracle posts hash(secret + matchId)
- Reveal phase: Oracle reveals secret
- Score generated: hash(secret) → deterministic scores

### 4. Settlement Contract
- After final score, accepts winning tokens
- Pays 1 BCH per winning token
- Burns losing tokens (worthless)

## VRF Implementation (Commit-Reveal)

### Why Commit-Reveal?
BCH doesn't have native VRF like Starknet. We use cryptographic commit-reveal:

```
Phase 1 - COMMIT (before trading starts):
  Oracle generates: secret = random_256_bits
  Oracle posts: commitment = SHA256(secret || matchId)

Phase 2 - REVEAL (at halftime/endgame):
  Oracle reveals: secret
  Anyone can verify: SHA256(secret || matchId) == commitment

Score Generation:
  hash = SHA256(secret || "halftime" || matchId)
  homeScore = hash[0:4] mod maxScore
  awayScore = hash[4:8] mod maxScore
```

### Security Properties
- Oracle cannot predict outcome during trading (committed)
- Oracle cannot change outcome after commit (hash binding)
- Anyone can verify the reveal matches commitment

## Match States

```typescript
enum MatchState {
  CREATED = 0,      // Match created, oracle committed
  TRADING_1 = 1,    // First trading phase (pre-match)
  HALFTIME = 2,     // Halftime scores revealed
  TRADING_2 = 3,    // Second trading phase (halftime trading)
  FINAL = 4,        // Final scores revealed
  SETTLED = 5       // Settlement complete
}
```

## CashTokens Structure

### Match NFT (State Tracking)
```
Category: <matchCategoryId>
Commitment: <encoded match state>
  - state: 1 byte (MatchState enum)
  - homeScore1H: 1 byte
  - awayScore1H: 1 byte
  - homeScoreFinal: 1 byte
  - awayScoreFinal: 1 byte
  - oracleCommitment: 32 bytes
```

### Outcome Tokens (Fungible)
```
HOME_WIN Token:
  Category: <homeTokenCategoryId>
  Amount: fungible amount

AWAY_WIN Token:
  Category: <awayTokenCategoryId>
  Amount: fungible amount
```

## Fee Structure

| Fee Type | Amount | Recipient |
|----------|--------|-----------|
| Trading Fee | 0.3% | Liquidity providers |
| Protocol Fee | 0.1% | Protocol treasury |
| Oracle Fee | Fixed | Oracle operator |

## Directory Structure

```
sportsbet.cash/
├── contracts/
│   ├── amm-pool.cash         # AMM swap logic
│   ├── match-factory.cash    # Match creation
│   ├── oracle.cash           # VRF commit-reveal
│   └── settlement.cash       # Winner redemption
├── src/
│   ├── types.ts              # TypeScript types
│   ├── match.ts              # Match management
│   ├── amm.ts                # AMM interactions
│   ├── oracle.ts             # Oracle/VRF logic
│   ├── settlement.ts         # Settlement logic
│   └── index.ts              # Main exports
├── test/
│   └── *.test.ts             # Test files
└── scripts/
    ├── create-match.ts       # Create new match
    ├── trade.ts              # Execute trades
    └── settle.ts             # Settle match
```

## Game Types

### Basketball (Default)
- Score range: 0-150 per half
- Total: 0-300 per team
- High scoring = more volatility

### Football (Soccer)
- Score range: 0-5 per half
- Total: 0-10 per team
- Low scoring = more binary

### American Football
- Score range: 0-35 per half
- Total: 0-70 per team
- Medium volatility

## Security Considerations

1. **Oracle Trust**: Single oracle is trusted for reveal. Future: multi-oracle threshold.
2. **Front-running**: Miners could see trades. Mitigated by commit-reveal for user bets too.
3. **Liquidity**: Initial liquidity must be sufficient to prevent manipulation.
4. **Time-lock**: State transitions are time-locked to prevent premature reveals.

## Roadmap

### Phase 1: MVP
- [x] Architecture design
- [ ] Core contracts (AMM, Oracle, Settlement)
- [ ] Basic TypeScript SDK
- [ ] Single match type (basketball)

### Phase 2: Enhanced
- [ ] Multiple game types
- [ ] Multi-oracle VRF
- [ ] LP token rewards
- [ ] UI/Frontend

### Phase 3: Advanced
- [ ] ZK-private bets (commit user bets)
- [ ] Cross-chain settlement
- [ ] Governance token
