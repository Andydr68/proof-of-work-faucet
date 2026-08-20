import './style.css'
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
  <div class="container">
    <h1>Proof of Work Faucet</h1>

    <p>Network: <strong>Solana Devnet</strong></p>

    <button id="connect">Connect MetaMask</button>

    <div id="status">Wallet non connesso</div>

    <div id="wallet-info" style="display:none;">
      <p><strong>Solana address:</strong></p>
      <code id="address"></code>

      <p><strong>Devnet balance:</strong></p>
      <div id="balance">-- SOL</div>

      <button id="refresh">Refresh Balance</button>

      <div class="mining-controls">
        <label for="reward-target">Rewards target:</label>

        <input
          id="reward-target"
          type="number"
          min="1"
          max="100"
          step="1"
          value="1"
        >

        <label class="continuous-option">
          <input
            id="continuous-mining"
            type="checkbox"
          >
          Continuous mining
        </label>

        <button id="mine">Start Mining</button>
        <button id="stop-mine" disabled>Stop Mining</button>
      </div>

      <div id="mine-status">Idle</div>

      <div id="session-stats">
        <p><strong>Session:</strong></p>
        <div>Completed: <span id="session-completed">0</span></div>
        <div>Total rewards: <span id="session-rewards">0.000000000 SOL</span></div>
        <div>Elapsed: <span id="session-time">0.000 s</span></div>
        <div>Average: <span id="session-average">--</span></div>
        <div>Retries: <span id="session-retries">0</span></div>
        <div>Errors: <span id="session-errors">0</span></div>
      </div>

      <div id="mining-result" style="display:none;">
        <p><strong>Last mining result:</strong></p>

        <div class="mining-grid">
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

      <hr>

      <h2>Send Devnet SOL</h2>

      <label for="recipient">Recipient:</label>
      <input
        id="recipient"
        type="text"
        placeholder="Solana recipient address"
      >

      <label for="amount">Amount:</label>
      <input
        id="amount"
        type="number"
        min="0"
        step="0.001"
        value="0.005"
      >

      <button id="send">Send SOL</button>

      <div id="tx-status"></div>
    </div>
  </div>
`

const button = document.querySelector('#connect')
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
      'http://localhost:3001/api/mine',
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

  await refreshBalance()

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

button.addEventListener('click', connectMetaMask)
refreshButton.addEventListener('click', refreshBalance)
mineButton.addEventListener('click', startMiningSession)
stopMineButton.addEventListener('click', stopMiningSession)
sendButton.addEventListener('click', sendSol)
