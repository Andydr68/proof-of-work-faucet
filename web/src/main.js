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

      <button id="mine">Mine 1 Reward</button>

      <div id="mine-status"></div>

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
const sendButton = document.querySelector('#send')
const status = document.querySelector('#status')
const txStatus = document.querySelector('#tx-status')
const mineStatus = document.querySelector('#mine-status')
const walletInfo = document.querySelector('#wallet-info')
const addressElement = document.querySelector('#address')
const balanceElement = document.querySelector('#balance')
const recipientElement = document.querySelector('#recipient')
const amountElement = document.querySelector('#amount')

let solanaClient
let wallet
let currentAccount
let currentAddress

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
    mineStatus.textContent = 'Connetti prima MetaMask'
    return
  }

  try {
    mineButton.disabled = true
    mineStatus.textContent =
      'Mining in corso... attendi la reward'

    const response = await fetch(
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

    const result = await response.json()

    if (!response.ok || !result.ok) {
      throw new Error(
        result.error ||
        result.stderr ||
        'Mining failed'
      )
    }

    mineStatus.textContent =
      'Reward completata e inoltrata a MetaMask'

    console.log('Mining stdout:', result.stdout)

    await refreshBalance()

  } catch (error) {
    console.error(error)

    mineStatus.textContent =
      `Errore mining: ${error.message ?? error}`
  } finally {
    mineButton.disabled = false
  }
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
mineButton.addEventListener('click', mineOneReward)
sendButton.addEventListener('click', sendSol)
