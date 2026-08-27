# Proof of Work Faucet

Proof of Work Faucet is a Solana development and testing project composed of:

- an Anchor proof-of-work faucet program;
- the `devnet-pow` Rust CLI miner;
- automatic funded-faucet discovery and selection;
- learned profitability and mining-performance history;
- a web mining dashboard;
- MetaMask Solana connectivity;
- CCTP V2 USDC bridging from supported EVM testnets to Solana Devnet.

> This project is intended for development and test networks. The SOL and USDC used by the documented workflows are testnet/Devnet assets.

## Architecture

```text
programs/proof-of-work-faucet/   Anchor/Solana program
cli/                             Rust CLI miner
web/                             Vite frontend + Express backend
tests/                           Anchor TypeScript tests
```

Runtime learning is stored in `.devnet-pow-performance.json`. This file is intentionally excluded from Git because it contains machine-specific mining observations.

## Networks

### Solana Devnet

The CLI miner and web dashboard primarily operate on Solana Devnet. The CLI accepts `--url dev` as shorthand for the standard Solana Devnet endpoint.

### Anchor Localnet

`Anchor.toml` currently uses Localnet for local Anchor development/testing. This is separate from the Devnet mining workflow.

## Requirements

- Rust and Cargo
- Solana CLI
- Anchor-compatible tooling
- Node.js and npm
- a Solana keypair
- a compatible browser wallet

The current project uses Anchor `0.27.0` and the Solana `1.14.x` dependency stack.

## Build and Test

```bash
cargo build --release -p devnet-pow
cargo test -p devnet-pow
```

Release binary: `target/release/devnet-pow`.

## CLI

List faucets:

```bash
./target/release/devnet-pow get-all-faucets --url dev
```

Mine with automatic best-faucet selection:

```bash
./target/release/devnet-pow mine --best --max-rewards 3 --url dev
```

Periodically re-evaluate the best faucet:

```bash
./target/release/devnet-pow mine --best --rescan-every 3 --url dev
```

Forward successful rewards:

```bash
./target/release/devnet-pow mine --best --recipient <SOLANA_ADDRESS> --url dev
```

Other mining options include `--difficulty`, `--reward`, `--target-lamports`, `--no-infer`, `--keypair-path`, and `--commitment`.

## Learned Profitability

The `--best` selector ranks funded faucets using adjusted net profitability rather than theoretical difficulty or gross reward alone.

The model considers faucet reward, observed mining time, recent robust timing, confidence, operational overhead, net reward, timing variability, stability penalties, and controlled exploration of insufficiently measured difficulties.

With limited observations, learned timing is blended with theoretical expectations. Recent samples and robust statistics reduce the influence of stale measurements and outliers.

Highly variable candidates can receive a stability penalty. Insufficiently measured difficulties can receive a limited exploration bonus. Operational overhead per successful reward is learned from local sessions and incorporated into the ranking.

## Local Performance History

Learned runtime data is stored in:

```text
.devnet-pow-performance.json
```

It includes successful claims, timing observations and overhead samples. The file is intentionally excluded from Git. Deleting it resets local learned performance.

## Web Dashboard

Install and build:

```bash
cd web
npm install
npm run build
```

Run the frontend:

```bash
npm run dev
```

Run the backend in a separate terminal:

```bash
cd web
npm run server
```

The backend invokes `target/release/devnet-pow` and listens on `http://localhost:3002` by default.

## Backend Environment Variables

- `PORT` — backend port; default `3002`
- `DEVNET_RPC` — Solana Devnet RPC; default `https://api.devnet.solana.com`
- `MINER_RESERVE_SOL` — operational SOL reserve; default `0.25`

Example:

```bash
PORT=3002 DEVNET_RPC=https://api.devnet.solana.com MINER_RESERVE_SOL=0.25 npm run server
```

## Frontend Environment Variables

The Vite frontend uses:

```text
VITE_BACKEND_URL
VITE_INFURA_API_KEY
```

Example `web/.env`:

```env
VITE_BACKEND_URL=http://localhost:3002
VITE_INFURA_API_KEY=YOUR_INFURA_API_KEY
```

`web/.env` is excluded from Git and must not be committed.

## MetaMask and Solana Devnet

The frontend uses `@metamask/connect-solana` for MetaMask Solana connectivity and displays the connected Solana account and Devnet information while interacting with the mining backend.

## CCTP V2 USDC Bridge

The web application includes a CCTP V2 testnet bridge workflow from supported EVM testnets to Solana Devnet.

Supported source networks:

- Ethereum Sepolia
- Base Sepolia
- Arbitrum Sepolia
- Optimism Sepolia
- Polygon Amoy
- Avalanche Fuji

The workflow checks source USDC, native gas, CCTP fees, total burn and maximum transferable amount. It performs approval and burn operations, monitors forwarding, and verifies the resulting USDC balance on Solana Devnet.

Native gas tokens are required on the selected EVM source testnet.

## Dashboard Profitability Metrics

The dashboard exposes learned claims, confidence, robust and blended timing, expected overhead, gross/net rewards, gross/net SOL/s and SOL/hour, stability penalty, stability-adjusted profitability, exploration bonus, adjusted score, and measured session profitability.

## Profitability Unit Tests

The deterministic Rust tests cover higher net profitability, stability in close rankings, exploration near ties, rejection of clearly bad candidates, zero-exploration behavior, overhead exceeding reward, and robust overhead estimation.

```bash
cargo test -p devnet-pow
```

## Runtime and Generated Files

These are intentionally local/generated:

```text
target/
node_modules/
web/dist/
web/.env
test-ledger/
.devnet-pow-performance.json
```

## Development Status

The project currently includes automatic faucet discovery/selection, persistent learned performance, confidence-weighted estimates, stability-aware ranking, controlled exploration, learned overhead, gross/net profitability reporting, deterministic tests, a release-binary backend, web dashboard, MetaMask Solana integration, CCTP V2 multichain testnet bridging, and Solana-side USDC verification.

## License

MIT
