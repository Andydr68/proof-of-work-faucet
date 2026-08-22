import './style.css'

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ||
  'http://localhost:3002'
import {
  createSolanaClient,
  getInfuraRpcUrls,
} from '@metamask/connect-solana'
import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  SystemProgram,
} from '@solana/web3.js'

const app = document.querySelector('#app')

app.innerHTML = `
  <div class="app-shell">
    <header class="app-header">
      <div>
        <h1>Proof of Work Faucet</h1>
        <p class="subtitle">
          Solana Devnet mining dashboard
        </p>
      </div>

      <div class="header-status">
        <span class="network-pill">
          Solana Devnet
        </span>

        <div
          id="backend-status"
          class="status-badge status-offline"
        >
          Backend: checking...
        </div>
      </div>
    </header>

    <section class="card wallet-card">
      <div class="card-title-row">
        <div>
          <h2>Wallet</h2>
          <p>MetaMask Solana account</p>
        </div>

        <button id="connect">
          Connect MetaMask
        </button>
      </div>

      <div id="status">
        Wallet non connesso
      </div>

      <div id="wallet-info" style="display:none;">
        <div class="wallet-grid">
          <div>
            <span class="field-label">
              Solana address
            </span>

            <code id="address"></code>
          </div>

          <div class="balance-block">
            <span class="field-label">
              Devnet balance
            </span>

            <strong id="balance">
              -- SOL
            </strong>

            <button id="refresh">
              Refresh Balance
            </button>
          </div>
        </div>
      </div>
    </section>

    <section class="card miner-wallet-card">
      <div class="card-title-row">
        <div>
          <h2>Miner Wallet</h2>
          <p>Operational Solana Devnet fee wallet</p>
        </div>

        <div
          id="miner-reserve-status"
          class="mine-state"
        >
          Checking...
        </div>
      </div>

      <div class="stats-grid">
        <div>
          <span>Balance</span>
          <strong id="miner-balance">--</strong>
        </div>

        <div>
          <span>Minimum reserve</span>
          <strong id="miner-reserve">--</strong>
        </div>

        <div>
          <span>Available</span>
          <strong id="miner-available">--</strong>
        </div>

        <div>
          <span>Fee reserve</span>
          <strong id="miner-health">--</strong>
        </div>

        <div>
          <span>Estimated remaining rewards</span>
          <strong id="miner-estimated-rewards">--</strong>
        </div>

        <div>
          <span>Estimated fee runway</span>
          <strong id="miner-runway">--</strong>
        </div>
      </div>

      <div class="miner-address">
        <span class="field-label">
          Miner address
        </span>
        <code id="miner-address">--</code>
      </div>
    </section>

    <section class="card mining-card">
      <div class="card-title-row">
        <div>
          <h2>Mining</h2>
          <p>Control the current mining session</p>
        </div>

        <div id="mine-status" class="mine-state">
          Idle
        </div>
      </div>

      <div class="mining-controls">
        <div class="control-group">
          <label for="reward-target">
            Rewards target
          </label>

          <input
            id="reward-target"
            type="number"
            min="1"
            max="100"
            step="1"
            value="1"
          >
        </div>

        <label class="continuous-option">
          <input
            id="continuous-mining"
            type="checkbox"
          >
          Continuous mining
        </label>

        <div class="button-row">
          <button id="mine">
            Start Mining
          </button>

          <button id="stop-mine" disabled>
            Stop Mining
          </button>
        </div>
      </div>
    </section>

    <section class="dashboard-grid">
      <div class="card">
        <h2>Session</h2>

        <div id="session-stats" class="stats-grid">
          <div>
            <span>Completed</span>
            <strong id="session-completed">0</strong>
          </div>

          <div>
            <span>Total rewards</span>
            <strong id="session-rewards">
              0.000000000 SOL
            </strong>
          </div>

          <div>
            <span>Elapsed</span>
            <strong id="session-time">
              0.000 s
            </strong>
          </div>

          <div>
            <span>Average</span>
            <strong id="session-average">
              --
            </strong>
          </div>

          <div>
            <span>Retries</span>
            <strong id="session-retries">
              0
            </strong>
          </div>

          <div>
            <span>Errors</span>
            <strong id="session-errors">
              0
            </strong>
          </div>
        </div>
      </div>

      <div class="card performance-card">
        <h2>Performance</h2>

        <div class="stats-grid">
          <div>
            <span>Historical claims</span>
            <strong id="perf-claims">--</strong>
          </div>

          <div>
            <span>Historical average</span>
            <strong id="perf-average">--</strong>
          </div>

          <div>
            <span>Recent robust time</span>
            <strong id="perf-robust">--</strong>
          </div>

          <div>
            <span>Recent samples</span>
            <strong id="perf-samples">--</strong>
          </div>

          <div>
            <span>Gross SOL/hour</span>
            <strong id="perf-sol-hour">--</strong>
          </div>

          <div>
            <span>Last overhead</span>
            <strong id="perf-overhead">--</strong>
          </div>
        </div>
      </div>

      <div
        id="algorithm-card"
        class="card"
        style="display:none;"
      >
        <h2>Algorithm Intelligence</h2>

        <div class="stats-grid">
          <div>
            <span>Difficulty</span>
            <strong id="algo-difficulty">--</strong>
          </div>

          <div>
            <span>Learned claims</span>
            <strong id="algo-claims">--</strong>
          </div>

          <div>
            <span>Confidence</span>
            <strong id="algo-confidence">--</strong>
          </div>

          <div>
            <span>Robust time</span>
            <strong id="algo-robust">--</strong>
          </div>

          <div>
            <span>Blended estimate</span>
            <strong id="algo-blended">--</strong>
          </div>

          <div>
            <span>Expected time</span>
            <strong id="algo-expected">--</strong>
          </div>

          <div>
            <span>Estimated SOL/s</span>
            <strong id="algo-sol-second">--</strong>
          </div>

          <div>
            <span>Estimated SOL/hour</span>
            <strong id="algo-sol-hour">--</strong>
          </div>

          <div>
            <span>Exploration bonus</span>
            <strong id="algo-exploration">--</strong>
          </div>

          <div>
            <span>Adjusted score</span>
            <strong id="algo-adjusted">--</strong>
          </div>
        </div>
      </div>

      <div
        id="net-profitability-card"
        class="card"
        style="display:none;"
      >
        <h2>Net Profitability</h2>

        <div class="stats-grid">
          <div>
            <span>Gross reward</span>
            <strong id="net-gross">--</strong>
          </div>

          <div>
            <span>Forwarded reward</span>
            <strong id="net-forwarded">--</strong>
          </div>

          <div>
            <span>Operational overhead</span>
            <strong id="net-overhead">--</strong>
          </div>

          <div>
            <span>Net reward</span>
            <strong id="net-reward">--</strong>
          </div>

          <div>
            <span>Overhead ratio</span>
            <strong id="net-overhead-ratio">--</strong>
          </div>

          <div>
            <span>Net efficiency</span>
            <strong id="net-efficiency">--</strong>
          </div>

          <div>
            <span>Net SOL/hour</span>
            <strong id="net-sol-hour">--</strong>
          </div>

          <div>
            <span>Wallet balance change</span>
            <strong id="net-wallet-change">--</strong>
          </div>
        </div>

        <p class="profitability-note">
          Net profitability treats forwarded SOL as retained value,
          not as an operating cost.
        </p>
      </div>

      <div
        id="mining-result"
        class="card"
        style="display:none;"
      >
        <h2>Last mining result</h2>

        <div class="result-grid">
          <span>Faucet</span>
          <code id="mine-faucet">--</code>

          <span>Difficulty</span>
          <strong id="mine-difficulty">--</strong>

          <span>Reward</span>
          <strong id="mine-reward">--</strong>

          <span>Mining time</span>
          <strong id="mine-time">--</strong>

          <span>Claim TX</span>
          <code id="mine-claim-tx">--</code>

          <span>Forward TX</span>
          <code id="mine-forward-tx">--</code>
        </div>
      </div>
    </section>

    <section class="card send-card">
      <h2>Send Devnet SOL</h2>
      <p>
        Send SOL from the connected MetaMask account.
      </p>

      <label for="recipient">
        Recipient
      </label>

      <input
        id="recipient"
        type="text"
        placeholder="Solana recipient address"
      >

      <label for="amount">
        Amount
      </label>

      <input
        id="amount"
        type="number"
        min="0"
        step="0.001"
        value="0.005"
      >

      <button id="send">
        Send SOL
      </button>

      <div id="tx-status"></div>
    </section>
  </div>
`

const button = document.querySelector('#connect')
const backendStatus = document.querySelector('#backend-status')

const minerBalance = document.querySelector('#miner-balance')
const minerReserve = document.querySelector('#miner-reserve')
const minerAvailable = document.querySelector('#miner-available')
const minerHealth = document.querySelector('#miner-health')
const minerEstimatedRewards =
  document.querySelector('#miner-estimated-rewards')
const minerRunway =
  document.querySelector('#miner-runway')
const minerAddress = document.querySelector('#miner-address')
const minerReserveStatus =
  document.querySelector('#miner-reserve-status')

const refreshButton = document.querySelector('#refresh')
const mineButton = document.querySelector('#mine')
const stopMineButton = document.querySelector('#stop-mine')
const rewardTargetElement = document.querySelector('#reward-target')
const continuousMiningElement = document.querySelector('#continuous-mining')
const sessionCompleted = document.querySelector('#session-completed')
const sessionRewards = document.querySelector('#session-rewards')
const sessionTime = document.querySelector('#session-time')
const sessionAverage = document.querySelector('#session-average')
const sessionRetries = document.querySelector('#session-retries')
const sessionErrors = document.querySelector('#session-errors')

const perfClaims = document.querySelector('#perf-claims')
const perfAverage = document.querySelector('#perf-average')
const perfRobust = document.querySelector('#perf-robust')
const perfSamples = document.querySelector('#perf-samples')
const perfSolHour = document.querySelector('#perf-sol-hour')
const perfOverhead = document.querySelector('#perf-overhead')

const netProfitabilityCard =
  document.querySelector('#net-profitability-card')
const netGross = document.querySelector('#net-gross')
const netForwarded = document.querySelector('#net-forwarded')
const netOverhead = document.querySelector('#net-overhead')
const netReward = document.querySelector('#net-reward')
const netOverheadRatio =
  document.querySelector('#net-overhead-ratio')
const netEfficiency =
  document.querySelector('#net-efficiency')
const netSolHour =
  document.querySelector('#net-sol-hour')
const netWalletChange =
  document.querySelector('#net-wallet-change')

const algorithmCard = document.querySelector('#algorithm-card')
const algoDifficulty = document.querySelector('#algo-difficulty')
const algoClaims = document.querySelector('#algo-claims')
const algoConfidence = document.querySelector('#algo-confidence')
const algoRobust = document.querySelector('#algo-robust')
const algoBlended = document.querySelector('#algo-blended')
const algoExpected = document.querySelector('#algo-expected')
const algoSolSecond = document.querySelector('#algo-sol-second')
const algoSolHour = document.querySelector('#algo-sol-hour')
const algoExploration = document.querySelector('#algo-exploration')
const algoAdjusted = document.querySelector('#algo-adjusted')

const sendButton = document.querySelector('#send')
const status = document.querySelector('#status')
const txStatus = document.querySelector('#tx-status')
const mineStatus = document.querySelector('#mine-status')
const miningResult = document.querySelector('#mining-result')
const mineFaucet = document.querySelector('#mine-faucet')
const mineDifficulty = document.querySelector('#mine-difficulty')
const mineReward = document.querySelector('#mine-reward')
const mineTime = document.querySelector('#mine-time')
const mineClaimTx = document.querySelector('#mine-claim-tx')
const mineForwardTx = document.querySelector('#mine-forward-tx')
const walletInfo = document.querySelector('#wallet-info')
const addressElement = document.querySelector('#address')
const balanceElement = document.querySelector('#balance')
const recipientElement = document.querySelector('#recipient')
const amountElement = document.querySelector('#amount')

let solanaClient
let wallet
let currentAccount
let currentAddress

let miningSessionActive = false
let stopMiningRequested = false

const infuraApiKey = import.meta.env.VITE_INFURA_API_KEY
const devnetRpc = 'https://api.devnet.solana.com'
const connection = new Connection(devnetRpc, 'confirmed')

async function refreshMinerWallet() {
  try {
    const response = await fetch(
      `${BACKEND_URL}/api/miner-wallet`,
      {
        cache: 'no-store',
      },
    )

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const wallet = await response.json()

    minerBalance.textContent =
      `${Number(wallet.balanceSol).toFixed(9)} SOL`

    minerReserve.textContent =
      `${Number(wallet.reserveSol).toFixed(9)} SOL`

    minerAvailable.textContent =
      `${Number(wallet.availableForOperations).toFixed(9)} SOL`

    minerAddress.textContent =
      wallet.address || '--'

    const estimatedOverheadPerReward =
      0.00090588

    const estimatedRewards =
      estimatedOverheadPerReward > 0
        ? Math.floor(
            Number(wallet.availableForOperations) /
            estimatedOverheadPerReward
          )
        : null

    minerEstimatedRewards.textContent =
      estimatedRewards != null
        ? String(estimatedRewards)
        : '--'

    minerRunway.textContent =
      estimatedRewards != null
        ? `~${estimatedRewards} rewards`
        : '--'

    if (wallet.reserveOk) {
      minerHealth.textContent = 'HEALTHY'
      minerReserveStatus.textContent = 'Reserve: healthy'
      minerReserveStatus.className =
        'mine-state reserve-healthy'
    } else {
      minerHealth.textContent = 'LOW'
      minerReserveStatus.textContent = 'Reserve: low'
      minerReserveStatus.className =
        'mine-state reserve-low'
    }
  } catch {
    minerBalance.textContent = '--'
    minerReserve.textContent = '--'
    minerAvailable.textContent = '--'
    minerHealth.textContent = 'OFFLINE'
    minerReserveStatus.textContent =
      'Reserve: unavailable'
    minerReserveStatus.className =
      'mine-state reserve-low'
  }
}

async function refreshBackendStatus() {
  try {
    const response = await fetch(
      `${BACKEND_URL}/api/health`,
      {
        cache: 'no-store',
      },
    )

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const health = await response.json()

    if (health.mining) {
      backendStatus.textContent = 'Backend: mining'
      backendStatus.className =
        'status-badge status-mining'
    } else {
      backendStatus.textContent = 'Backend: online'
      backendStatus.className =
        'status-badge status-online'
    }
  } catch {
    backendStatus.textContent = 'Backend: offline'
    backendStatus.className =
      'status-badge status-offline'
  }
}

async function refreshPerformance() {
  try {
    const response = await fetch(
      `${BACKEND_URL}/api/performance`,
      {
        cache: 'no-store',
      },
    )

    if (!response.ok) return

    const result = await response.json()

    const difficulty =
      result.difficulties?.['3']

    if (!difficulty) return

    perfClaims.textContent =
      String(difficulty.claims)

    perfAverage.textContent =
      difficulty.averageSeconds != null
        ? `${difficulty.averageSeconds.toFixed(3)} s`
        : '--'

    perfRobust.textContent =
      difficulty.medianRecent != null
        ? `${difficulty.medianRecent.toFixed(3)} s`
        : '--'

    perfSamples.textContent =
      String(difficulty.recentSamples)

    perfSolHour.textContent =
      difficulty.grossSolPerHour != null
        ? `${difficulty.grossSolPerHour.toFixed(6)} SOL/h`
        : '--'
  } catch (error) {
    console.warn(
      'Performance endpoint unavailable:',
      error,
    )
  }
}

async function refreshBalance() {
  if (!currentAddress) return

  try {
    balanceElement.textContent = 'Caricamento...'

    const publicKey = new PublicKey(currentAddress)
    const lamports = await connection.getBalance(publicKey)

    balanceElement.textContent =
      `${(lamports / LAMPORTS_PER_SOL).toFixed(9)} SOL`
  } catch (error) {
    console.error(error)
    balanceElement.textContent =
      `Errore saldo: ${error.message ?? error}`
  }
}

async function mineOneReward() {
  if (!currentAddress) {
    throw new Error('Connetti prima MetaMask')
  }

  let response

  try {
    response = await fetch(
      `${BACKEND_URL}/api/mine`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: currentAddress,
        }),
      },
    )
  } catch (error) {
    const wrapped =
      new Error(`Backend non raggiungibile: ${error.message}`)
    wrapped.retryable = true
    throw wrapped
  }

  let result

  try {
    result = await response.json()
  } catch {
    const error =
      new Error(`Risposta backend non valida: HTTP ${response.status}`)
    error.retryable = response.status >= 500
    throw error
  }

  if (!response.ok || !result.ok) {
    const error = new Error(
      result.error ||
      result.stderr ||
      `Mining failed: HTTP ${response.status}`
    )

    error.retryable =
      response.status >= 500 ||
      response.status === 409

    throw error
  }

  const mining = result.mining || {}

  mineFaucet.textContent =
    mining.faucet || '--'

  mineDifficulty.textContent =
    mining.difficulty ?? '--'

  mineReward.textContent =
    mining.reward != null
      ? `${mining.reward} SOL`
      : '--'

  mineTime.textContent =
    mining.elapsedSeconds != null
      ? `${mining.elapsedSeconds.toFixed(3)} s`
      : '--'

  mineClaimTx.textContent =
    mining.claimTx || '--'

  mineForwardTx.textContent =
    mining.forwardTx || '--'

  miningResult.style.display = 'block'

  const algorithm = mining.algorithm || {}

  const learning =
    Array.isArray(algorithm.learning)
      ? algorithm.learning.find(
          item => item.difficulty === mining.difficulty
        )
      : null

  const profitability =
    Array.isArray(algorithm.profitability)
      ? algorithm.profitability.find(
          item => item.difficulty === mining.difficulty
        )
      : null

  const exploration =
    Array.isArray(algorithm.exploration)
      ? algorithm.exploration.find(
          item => item.difficulty === mining.difficulty
        )
      : null

  if (learning || profitability || exploration) {
    algorithmCard.style.display = 'block'

    algoDifficulty.textContent =
      String(mining.difficulty ?? '--')

    algoClaims.textContent =
      learning?.claims != null
        ? String(learning.claims)
        : '--'

    algoConfidence.textContent =
      learning?.confidence != null
        ? `${learning.confidence.toFixed(0)}%`
        : '--'

    algoRobust.textContent =
      learning?.robustSeconds != null
        ? `${learning.robustSeconds.toFixed(3)} s`
        : '--'

    algoBlended.textContent =
      learning?.blendedSeconds != null
        ? `${learning.blendedSeconds.toFixed(3)} s`
        : '--'

    algoExpected.textContent =
      profitability?.expectedSeconds != null
        ? `${profitability.expectedSeconds.toFixed(3)} s`
        : '--'

    algoSolSecond.textContent =
      profitability?.solPerSecond != null
        ? `${profitability.solPerSecond.toFixed(9)} SOL/s`
        : '--'

    algoSolHour.textContent =
      profitability?.solPerHour != null
        ? `${profitability.solPerHour.toFixed(6)} SOL/h`
        : '--'

    algoExploration.textContent =
      exploration?.bonusPercent != null
        ? `+${exploration.bonusPercent.toFixed(1)}%`
        : '0.0% — learned'

    algoAdjusted.textContent =
      exploration?.adjustedScore != null
        ? exploration.adjustedScore.toFixed(9)
        : 'Not active'
  }

  if (
    mining.grossReward != null &&
    mining.overhead != null
  ) {
    const gross = Number(mining.grossReward)
    const overhead = Number(mining.overhead)
    const forwarded =
      Number(mining.reward ?? gross)

    const netRewardValue =
      Math.max(gross - overhead, 0)

    const overheadRatio =
      gross > 0
        ? (overhead / gross) * 100
        : 0

    const efficiency =
      gross > 0
        ? (netRewardValue / gross) * 100
        : 0

    const netSolHourValue =
      mining.elapsedSeconds > 0
        ? (
            netRewardValue /
            mining.elapsedSeconds
          ) * 3600
        : null

    netProfitabilityCard.style.display = 'block'

    netGross.textContent =
      `${gross.toFixed(9)} SOL`

    netForwarded.textContent =
      `${forwarded.toFixed(9)} SOL`

    netOverhead.textContent =
      `${overhead.toFixed(9)} SOL`

    netReward.textContent =
      `${netRewardValue.toFixed(9)} SOL`

    netOverheadRatio.textContent =
      `${overheadRatio.toFixed(2)}%`

    netEfficiency.textContent =
      `${efficiency.toFixed(2)}%`

    netSolHour.textContent =
      netSolHourValue != null
        ? `${netSolHourValue.toFixed(6)} SOL/h`
        : '--'

    netWalletChange.textContent =
      mining.netBalanceChange != null
        ? `${Number(
            mining.netBalanceChange
          ).toFixed(9)} SOL`
        : '--'
  }

  perfOverhead.textContent =
    mining.overhead != null
      ? `${mining.overhead.toFixed(9)} SOL`
      : '--'

  await refreshBalance()
  await refreshMinerWallet()
  await refreshPerformance()

  return mining
}


async function startMiningSession() {
  if (miningSessionActive) return

  if (!currentAddress) {
    mineStatus.textContent =
      'Connetti prima MetaMask'
    return
  }

  const continuous =
    continuousMiningElement.checked

  const target =
    Number.parseInt(
      rewardTargetElement.value,
      10,
    )

  if (
    !continuous &&
    (
      !Number.isInteger(target) ||
      target < 1 ||
      target > 100
    )
  ) {
    mineStatus.textContent =
      'Rewards target non valido'
    return
  }

  miningSessionActive = true
  stopMiningRequested = false

  mineButton.disabled = true
  stopMineButton.disabled = false
  rewardTargetElement.disabled = true
  continuousMiningElement.disabled = true

  let completed = 0
  let totalReward = 0
  let retries = 0
  let errors = 0

  const startedAt = performance.now()

  sessionCompleted.textContent = '0'
  sessionRewards.textContent =
    '0.000000000 SOL'
  sessionTime.textContent = '0.000 s'
  sessionAverage.textContent = '--'
  sessionRetries.textContent = '0'
  sessionErrors.textContent = '0'

  try {
    for (
      let i = 0;
      continuous || i < target;
      i += 1
    ) {
      if (stopMiningRequested) break

      mineStatus.textContent =
        continuous
          ? `Continuous mining — reward ${i + 1}...`
          : `Mining reward ${i + 1} di ${target}...`

      let mining
      let attempt = 0

      while (true) {
        try {
          mining = await mineOneReward()
          break
        } catch (error) {
          errors += 1
          sessionErrors.textContent =
            String(errors)

          if (
            !error.retryable ||
            attempt >= 2 ||
            stopMiningRequested
          ) {
            throw error
          }

          attempt += 1
          retries += 1

          sessionRetries.textContent =
            String(retries)

          const delaySeconds =
            attempt * 2

          mineStatus.textContent =
            `Errore temporaneo. Retry ${attempt}/3 tra ${delaySeconds}s...`

          await new Promise(resolve =>
            setTimeout(
              resolve,
              delaySeconds * 1000,
            )
          )
        }
      }

      completed += 1

      if (typeof mining.reward === 'number') {
        totalReward += mining.reward
      }

      const elapsed =
        (performance.now() - startedAt) /
        1000

      sessionCompleted.textContent =
        String(completed)

      sessionRewards.textContent =
        `${totalReward.toFixed(9)} SOL`

      sessionTime.textContent =
        `${elapsed.toFixed(3)} s`

      sessionAverage.textContent =
        `${(elapsed / completed).toFixed(3)} s`

      if (stopMiningRequested) break
    }

    if (stopMiningRequested) {
      mineStatus.textContent =
        `Stopped — ${completed} reward completate`
    } else {
      mineStatus.textContent =
        `Completed — ${completed} reward completate`
    }

  } catch (error) {
    console.error(error)

    mineStatus.textContent =
      `Errore mining: ${error.message ?? error}`

  } finally {
    miningSessionActive = false

    mineButton.disabled = false
    stopMineButton.disabled = true
    rewardTargetElement.disabled =
      continuousMiningElement.checked
    continuousMiningElement.disabled = false
  }
}

continuousMiningElement.addEventListener(
  'change',
  () => {
    rewardTargetElement.disabled =
      continuousMiningElement.checked
  },
)

function stopMiningSession() {
  if (!miningSessionActive) return

  stopMiningRequested = true

  mineStatus.textContent =
    'Stop richiesto: termino la reward in corso...'

  stopMineButton.disabled = true
}

async function sendSol() {
  try {
    if (!wallet || !currentAccount) {
      throw new Error('MetaMask non connesso')
    }

    const recipient = new PublicKey(
      recipientElement.value.trim()
    )

    const amount = Number(amountElement.value)

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Importo non valido')
    }

    const lamports = Math.round(amount * LAMPORTS_PER_SOL)
    const sender = new PublicKey(currentAddress)

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender,
        toPubkey: recipient,
        lamports,
      })
    )

    const { blockhash } =
      await connection.getLatestBlockhash('confirmed')

    transaction.recentBlockhash = blockhash
    transaction.feePayer = sender

    txStatus.textContent =
      'Conferma la transazione in MetaMask...'

    const [{ signature }] =
      await wallet.features[
        'solana:signAndSendTransaction'
      ].signAndSendTransaction({
        account: currentAccount,
        transaction: transaction.serialize({
          verifySignatures: false,
        }),
        chain:
          'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
      })

    txStatus.textContent =
      `Transazione inviata: ${signature}`

    console.log('Transaction signature:', signature)

    await new Promise(resolve => setTimeout(resolve, 1500))
    await refreshBalance()

  } catch (error) {
    console.error(error)
    txStatus.textContent =
      `Errore: ${error.message ?? error}`
  }
}

async function connectMetaMask() {
  try {
    button.disabled = true
    status.textContent = 'Connessione a MetaMask...'

    if (!solanaClient) {
      solanaClient = await createSolanaClient({
        dapp: {
          name: 'Proof of Work Faucet',
          url: window.location.href,
        },

        api: {
          supportedNetworks: getInfuraRpcUrls({
            infuraApiKey,
            networks: ['devnet'],
          }),
        },
      })
    }

    wallet = solanaClient.getWallet()

    const { accounts } =
      await wallet.features['standard:connect'].connect()

    if (!accounts?.length) {
      throw new Error(
        'Nessun account Solana restituito da MetaMask'
      )
    }

    currentAccount = accounts[0]
    currentAddress = currentAccount.address

    addressElement.textContent = currentAddress
    walletInfo.style.display = 'block'

    status.textContent =
      'MetaMask connesso a Solana Devnet'

    button.textContent = 'Connected'

    await refreshBalance()

  } catch (error) {
    console.error(error)

    status.textContent =
      `Errore: ${error.message ?? error}`

    button.disabled = false
  }
}

refreshBackendStatus()
refreshMinerWallet()
refreshPerformance()

setInterval(refreshBackendStatus, 2000)
setInterval(refreshMinerWallet, 10000)
setInterval(refreshPerformance, 10000)

button.addEventListener('click', connectMetaMask)
refreshButton.addEventListener('click', refreshBalance)
mineButton.addEventListener('click', startMiningSession)
stopMineButton.addEventListener('click', stopMiningSession)
sendButton.addEventListener('click', sendSol)
