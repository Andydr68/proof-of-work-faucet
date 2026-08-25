import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  formatEther,
  encodeFunctionData,
  bytesToHex,
  zeroHash,
} from 'viem'

import {
  baseSepolia,
  sepolia,
  arbitrumSepolia,
  optimismSepolia,
  polygonAmoy,
  avalancheFuji,
} from 'viem/chains'

import { PublicKey } from '@solana/web3.js'


const TOKEN_MESSENGER_V2 =
  '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'

const DESTINATION_DOMAIN = 5

const SOLANA_DESTINATION =
  new PublicKey(
    '77q43tMCLFRv9sE6S8YdFsozHz3A6ZomUDfCs7nyBbYY'
  )

const SOLANA_USDC_ATA =
  new PublicKey(
    '5M4MZuqvoYarkKz7ZDQc2LnUpsVX3psc86rtzTbSkCRL'
  )

const FORWARDING_HOOK =
  '0x636374702d666f72776172640000000000000000000000000000000000000000'


const NETWORKS = {
  baseSepolia: {
    name: 'Base Sepolia',
    chain: baseSepolia,
    domain: 6,
    usdc:
      '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    rpcUrls: [
      'https://sepolia.base.org',
    ],
    explorerUrls: [
      'https://sepolia.basescan.org',
    ],
  },

  sepolia: {
    name: 'Ethereum Sepolia',
    chain: sepolia,
    domain: 0,
    usdc:
      '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    rpcUrls: [
      'https://ethereum-sepolia-rpc.publicnode.com',
    ],
    explorerUrls: [
      'https://sepolia.etherscan.io',
    ],
  },

  arbitrumSepolia: {
    name: 'Arbitrum Sepolia',
    chain: arbitrumSepolia,
    domain: 3,
    usdc:
      '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    rpcUrls: [
      'https://sepolia-rollup.arbitrum.io/rpc',
    ],
    explorerUrls: [
      'https://sepolia.arbiscan.io',
    ],
  },

  optimismSepolia: {
    name: 'OP Sepolia',
    chain: optimismSepolia,
    domain: 2,
    usdc:
      '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
    rpcUrls: [
      'https://sepolia.optimism.io',
    ],
    explorerUrls: [
      'https://sepolia-optimism.etherscan.io',
    ],
  },

  polygonAmoy: {
    name: 'Polygon Amoy',
    chain: polygonAmoy,
    domain: 7,
    usdc:
      '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
    rpcUrls: [
      'https://polygon-amoy.drpc.org',
    ],
    explorerUrls: [
      'https://amoy.polygonscan.com',
    ],
  },

  avalancheFuji: {
    name: 'Avalanche Fuji',
    chain: avalancheFuji,
    domain: 1,
    usdc:
      '0x5425890298aed601595a70AB815c96711a31Bc65',
    rpcUrls: [
      'https://api.avax-test.network/ext/bc/C/rpc',
    ],
    explorerUrls: [
      'https://testnet.snowtrace.io',
    ],
  },
}



async function ensureWalletChain(config) {
  if (!window.ethereum) {
    throw new Error(
      'Provider EVM MetaMask non trovato'
    )
  }

  const chainIdHex =
    `0x${config.chain.id.toString(16)}`

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [
        {
          chainId: chainIdHex,
        },
      ],
    })

    return
  } catch (switchError) {
    const code =
      switchError?.code ??
      switchError?.data?.originalError?.code

    // 4902 = chain non conosciuta da MetaMask
    if (code !== 4902) {
      throw switchError
    }
  }

  await window.ethereum.request({
    method: 'wallet_addEthereumChain',
    params: [
      {
        chainId: chainIdHex,
        chainName: config.name,
        nativeCurrency: {
          name:
            config.chain.nativeCurrency.name,
          symbol:
            config.chain.nativeCurrency.symbol,
          decimals:
            config.chain.nativeCurrency.decimals,
        },
        rpcUrls:
          config.rpcUrls,
        blockExplorerUrls:
          config.explorerUrls,
      },
    ],
  })

  // Alcune versioni di MetaMask aggiungono la rete
  // ma non la rendono attiva automaticamente.
  await window.ethereum.request({
    method: 'wallet_switchEthereumChain',
    params: [
      {
        chainId: chainIdHex,
      },
    ],
  })
}


const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
    ],
    outputs: [
      { name: '', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [
      { name: '', type: 'bool' },
    ],
  },
]


const TOKEN_MESSENGER_ABI = [
  {
    type: 'function',
    name: 'depositForBurnWithHook',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
      { name: 'destinationCaller', type: 'bytes32' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'minFinalityThreshold', type: 'uint32' },
      { name: 'hookData', type: 'bytes' },
    ],
    outputs: [],
  },
]


function formatUsdc(value) {
  return (
    Number(value) / 1_000_000
  ).toFixed(6)
}


function parseUsdc(value) {
  const text = String(value).trim()

  if (!/^\d+(\.\d{0,6})?$/.test(text)) {
    throw new Error(
      'Importo USDC non valido. Massimo 6 decimali.'
    )
  }

  const [whole, decimals = ''] =
    text.split('.')

  const padded =
    (decimals + '000000').slice(0, 6)

  const amount =
    BigInt(whole) * 1_000_000n +
    BigInt(padded)

  if (amount <= 0n) {
    throw new Error(
      'Importo USDC deve essere maggiore di zero'
    )
  }

  return amount
}



export async function runCctpPreflight({
  networkElement,
  amountElement,
  usdcBalanceElement,
  nativeBalanceElement,
  feeElement,
  totalElement,
  maxElement,
  gasNeededElement,
  gasMissingElement,
  readinessElement,
  transferButton,
}) {
  try {
    if (!window.ethereum) {
      throw new Error(
        'Provider EVM MetaMask non trovato'
      )
    }

    const config =
      NETWORKS[networkElement.value]

    if (!config) {
      throw new Error(
        'Rete sorgente non supportata'
      )
    }

    transferButton.disabled = true

    readinessElement.textContent =
      'CHECKING...'
    readinessElement.className =
      'mine-state'

    usdcBalanceElement.textContent = '--'
    nativeBalanceElement.textContent = '--'
    feeElement.textContent = '--'
    totalElement.textContent = '--'
    maxElement.textContent = '--'

    if (gasNeededElement) {
      gasNeededElement.textContent = '--'
    }

    if (gasMissingElement) {
      gasMissingElement.textContent = '--'
    }

    const accounts =
      await window.ethereum.request({
        method: 'eth_accounts',
      })

    if (!accounts?.length) {
      readinessElement.textContent =
        'CONNECT EVM'

      transferButton.disabled = false

      return {
        ready: false,
        reason: 'wallet-not-connected',
      }
    }

    const account = accounts[0]

    // Il preflight usa l'RPC pubblico della chain,
    // quindi NON forza uno switch di rete in MetaMask.
    const publicClient =
      createPublicClient({
        chain: config.chain,
        transport: http(),
      })

    const [
      balance,
      nativeBalance,
    ] = await Promise.all([
      publicClient.readContract({
        address: config.usdc,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [account],
      }),

      publicClient.getBalance({
        address: account,
      }),
    ])

    const transferAmount =
      parseUsdc(amountElement.value)

    usdcBalanceElement.textContent =
      `${formatUsdc(balance)} USDC`

    const nativeSymbol =
      config.chain.nativeCurrency.symbol

    nativeBalanceElement.textContent =
      `${Number(
        formatEther(nativeBalance)
      ).toFixed(6)} ${nativeSymbol}`

    const feeResponse =
      await fetch(
        `https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/${config.domain}/${DESTINATION_DOMAIN}?forward=true`,
        {
          headers: {
            'Content-Type':
              'application/json',
          },
        }
      )

    if (!feeResponse.ok) {
      throw new Error(
        `Circle fee API: HTTP ${feeResponse.status}`
      )
    }

    const fees =
      await feeResponse.json()

    if (
      !Array.isArray(fees) ||
      !fees.length
    ) {
      throw new Error(
        'Circle non ha restituito le fee CCTP'
      )
    }

    const feeData = fees[0]

    const forwardFee =
      BigInt(feeData.forwardFee.med)

    const minimumFeeBps =
      Number(feeData.minimumFee)

    const rateUnits =
      BigInt(
        Math.round(
          minimumFeeBps * 100
        )
      )

    const protocolFee =
      (
        transferAmount *
        rateUnits
      ) / 1_000_000n

    const maxFee =
      forwardFee + protocolFee

    const totalAmount =
      transferAmount + maxFee

    // Massimo trasferibile tenendo conto
    // sia della fee fissa sia di quella proporzionale.
    const maxTransferable =
      balance > forwardFee
        ? (
            (balance - forwardFee) *
            1_000_000n
          ) /
          (
            1_000_000n +
            rateUnits
          )
        : 0n

    let estimatedNativeGas = null
    let gasEstimateError = null

    try {
      const approveData =
        encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [
            TOKEN_MESSENGER_V2,
            totalAmount,
          ],
        })

      const [
        approveGas,
        feeEstimate,
      ] = await Promise.all([
        publicClient.estimateGas({
          account,
          to: config.usdc,
          data: approveData,
        }),

        publicClient.estimateFeesPerGas(),
      ])

      const gasPrice =
        feeEstimate.maxFeePerGas ??
        feeEstimate.gasPrice

      if (gasPrice != null) {
        /*
         * Il BURN non può essere stimato correttamente
         * prima dell'APPROVE:
         *
         * depositForBurnWithHook() esegue transferFrom()
         * e l'eth_estimateGas fallirebbe con:
         *
         * ERC20: transfer amount exceeds allowance
         *
         * Usiamo quindi:
         * - APPROVE: stima reale
         * - BURN: budget prudenziale di 500.000 gas
         *
         * La transazione BURN reale continuerà ad avere
         * la propria gestione dinamica delle fee.
         */
        const burnGasBudget =
          500_000n

        const totalGas =
          approveGas +
          burnGasBudget

        // Margine extra del 25%.
        const bufferedGas =
          (totalGas * 125n) / 100n

        const bufferedGasPrice =
          (gasPrice * 125n) / 100n

        estimatedNativeGas =
          bufferedGas *
          bufferedGasPrice
      }
    } catch (error) {
      gasEstimateError = error
      console.warn(
        'CCTP gas estimate unavailable:',
        error
      )
    }


    feeElement.textContent =
      `${formatUsdc(maxFee)} USDC`

    totalElement.textContent =
      `${formatUsdc(totalAmount)} USDC`

    maxElement.textContent =
      `${formatUsdc(maxTransferable)} USDC`

    const usdcEnough =
      balance >= totalAmount

    const gasPresent =
      nativeBalance > 0n

    const gasEnough =
      estimatedNativeGas != null
        ? nativeBalance >= estimatedNativeGas
        : gasPresent

    const gasMissing =
      estimatedNativeGas != null &&
      nativeBalance < estimatedNativeGas
        ? estimatedNativeGas - nativeBalance
        : 0n

    if (gasNeededElement) {
      gasNeededElement.textContent =
        estimatedNativeGas != null
          ? `${Number(
              formatEther(
                estimatedNativeGas
              )
            ).toFixed(6)} ${nativeSymbol}`
          : 'Estimate unavailable'
    }

    if (gasMissingElement) {
      gasMissingElement.textContent =
        gasEstimateError
          ? 'Estimate unavailable'
          : gasMissing > 0n
            ? `${Number(
                formatEther(
                  gasMissing
                )
              ).toFixed(6)} ${nativeSymbol}`
            : `0.000000 ${nativeSymbol}`
    }

    const ready =
      usdcEnough &&
      gasEnough

    if (ready) {
      readinessElement.textContent =
        'READY'

      readinessElement.className =
        'mine-state reserve-healthy'

      transferButton.disabled = false
    } else {
      const reasons = []

      if (!usdcEnough) {
        reasons.push(
          'USDC insufficienti'
        )
      }

      if (!gasEnough) {
        if (
          estimatedNativeGas != null
        ) {
          reasons.push(
            `gas insufficiente: manca ${Number(
              formatEther(
                gasMissing
              )
            ).toFixed(6)} ${nativeSymbol}`
          )
        } else {
          reasons.push(
            `manca ${nativeSymbol} per il gas`
          )
        }
      }

      readinessElement.textContent =
        `NOT READY — ${reasons.join(', ')}`

      readinessElement.className =
        'mine-state reserve-low'

      transferButton.disabled = true
    }

    return {
      ready,
      account,
      network: config.name,
      balance,
      nativeBalance,
      transferAmount,
      maxFee,
      totalAmount,
      maxTransferable,
      estimatedNativeGas,
      gasMissing,
      gasEstimateError,
    }

  } catch (error) {
    console.error(
      'CCTP preflight error:',
      error
    )

    readinessElement.textContent =
      `NOT READY — ${
        error.shortMessage ||
        error.message ||
        error
      }`

    readinessElement.className =
      'mine-state reserve-low'

    transferButton.disabled = true

    return {
      ready: false,
      error,
    }
  }
}


export async function runCctpTest({
  networkElement,
  amountElement,
  statusElement,
  sourceElement,
  destinationElement,
  feeElement,
}) {
  try {
    if (!window.ethereum) {
      throw new Error(
        'Provider EVM MetaMask non trovato'
      )
    }

    const config =
      NETWORKS[networkElement.value]

    if (!config) {
      throw new Error(
        'Rete sorgente non supportata'
      )
    }

    statusElement.textContent =
      `Connessione a ${config.name}...`

    const walletClient =
      createWalletClient({
        chain: config.chain,
        transport: custom(window.ethereum),
      })

    const publicClient =
      createPublicClient({
        chain: config.chain,
        transport: custom(window.ethereum),
      })

    try {
      await ensureWalletChain(config)
    } catch (error) {
      throw new Error(
        `Impossibile passare a ${config.name}: ` +
        (
          error.shortMessage ||
          error.message ||
          error
        )
      )
    }

    const accounts =
      await walletClient.requestAddresses()

    if (!accounts?.length) {
      throw new Error(
        'Nessun account EVM restituito da MetaMask'
      )
    }

    const account = accounts[0]

    sourceElement.textContent =
      `${config.name} — ${account}`

    const ata = SOLANA_USDC_ATA

    const mintRecipient =
      bytesToHex(ata.toBytes())

    destinationElement.textContent =
      `${SOLANA_DESTINATION.toBase58()} → ATA ${ata.toBase58()}`

    statusElement.textContent =
      `Controllo saldo USDC su ${config.name}...`

    const balance =
      await publicClient.readContract({
        address: config.usdc,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [account],
      })

    const transferAmount =
      parseUsdc(amountElement.value)

    if (balance < transferAmount) {
      throw new Error(
        `Saldo insufficiente su ${config.name}: ` +
        `${formatUsdc(balance)} USDC`
      )
    }

    statusElement.textContent =
      `Saldo ${formatUsdc(balance)} USDC. Recupero fee Circle...`

    const feeResponse =
      await fetch(
        `https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/${config.domain}/${DESTINATION_DOMAIN}?forward=true`,
        {
          headers: {
            'Content-Type':
              'application/json',
          },
        }
      )

    if (!feeResponse.ok) {
      throw new Error(
        `Circle fee API: HTTP ${feeResponse.status}`
      )
    }

    const fees =
      await feeResponse.json()

    if (
      !Array.isArray(fees) ||
      !fees.length
    ) {
      throw new Error(
        'Circle non ha restituito le fee CCTP'
      )
    }

    const feeData = fees[0]

    const forwardFee =
      BigInt(feeData.forwardFee.med)

    const minimumFeeBps =
      Number(feeData.minimumFee)

    const protocolFee =
      (
        transferAmount *
        BigInt(
          Math.round(
            minimumFeeBps * 100
          )
        )
      ) / 1_000_000n

    const maxFee =
      forwardFee + protocolFee

    const totalAmount =
      transferAmount + maxFee

    if (balance < totalAmount) {
      throw new Error(
        `Saldo ${formatUsdc(balance)} USDC; ` +
        `servono ${formatUsdc(totalAmount)} USDC inclusa fee`
      )
    }

    feeElement.textContent =
      `${formatUsdc(maxFee)} USDC — ` +
      `burn totale ${formatUsdc(totalAmount)} USDC`

    statusElement.textContent =
      `1/2 — Conferma APPROVE su ${config.name}...`

    const estimatedFees =
      await publicClient
        .estimateFeesPerGas()
        .catch(() => null)

    const gasFees =
      estimatedFees?.maxFeePerGas != null
        ? {
            maxFeePerGas:
              estimatedFees.maxFeePerGas * 2n,
            maxPriorityFeePerGas:
              (
                estimatedFees.maxPriorityFeePerGas ??
                1_000_000n
              ) * 2n,
          }
        : {}

    const approveHash =
      await walletClient.sendTransaction({
        account,
        ...gasFees,
        to: config.usdc,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [
            TOKEN_MESSENGER_V2,
            totalAmount,
          ],
        }),
      })

    statusElement.textContent =
      'Attendo conferma APPROVE...'

    const approveReceipt =
      await publicClient
        .waitForTransactionReceipt({
          hash: approveHash,
        })

    if (
      approveReceipt.status !==
      'success'
    ) {
      throw new Error(
        'La transazione APPROVE è fallita'
      )
    }

    statusElement.textContent =
      `2/2 — Conferma BURN CCTP su ${config.name}...`

    const freshEstimatedFees =
      await publicClient
        .estimateFeesPerGas()
        .catch(() => null)

    const freshGasFees =
      freshEstimatedFees?.maxFeePerGas != null
        ? {
            maxFeePerGas:
              freshEstimatedFees.maxFeePerGas * 2n,
            maxPriorityFeePerGas:
              (
                freshEstimatedFees.maxPriorityFeePerGas ??
                1_000_000n
              ) * 2n,
          }
        : gasFees

    const burnHash =
      await walletClient.sendTransaction({
        account,
        ...freshGasFees,
        to: TOKEN_MESSENGER_V2,
        data: encodeFunctionData({
          abi: TOKEN_MESSENGER_ABI,
          functionName:
            'depositForBurnWithHook',
          args: [
            totalAmount,
            DESTINATION_DOMAIN,
            mintRecipient,
            config.usdc,
            zeroHash,
            maxFee,
            1000,
            FORWARDING_HOOK,
          ],
        }),
      })

    statusElement.textContent =
      `Burn inviato su ${config.name}: ${burnHash}`

    const burnReceipt =
      await publicClient
        .waitForTransactionReceipt({
          hash: burnHash,
        })

    if (
      burnReceipt.status !==
      'success'
    ) {
      throw new Error(
        'La transazione CCTP burn è fallita'
      )
    }

    statusElement.textContent =
      `Burn confermato. Circle sta inoltrando ` +
      `${formatUsdc(transferAmount)} USDC ` +
      `da ${config.name} a Solana Devnet...`

    let forwardTxHash = null

    for (
      let attempt = 0;
      attempt < 180;
      attempt += 1
    ) {
      const response =
        await fetch(
          `https://iris-api-sandbox.circle.com/v2/messages/${config.domain}?transactionHash=${burnHash}`
        )

      if (response.ok) {
        const data =
          await response.json()

        forwardTxHash =
          data.messages?.[0]
            ?.forwardTxHash ||
          null

        if (forwardTxHash) {
          break
        }
      }

      await new Promise(resolve =>
        setTimeout(resolve, 3000)
      )
    }

    if (forwardTxHash) {
      statusElement.textContent =
        `SUCCESS ✅ ${formatUsdc(transferAmount)} USDC ` +
        `${config.name} → Solana Devnet. ` +
        `Mint TX: ${forwardTxHash}`
    } else {
      statusElement.textContent =
        `Burn completato ✅ su ${config.name}. ` +
        `Forward non ancora visibile. ` +
        `Burn TX: ${burnHash}`
    }

    return {
      network: config.name,
      account,
      ata: ata.toBase58(),
      approveHash,
      burnHash,
      forwardTxHash,
      transferAmount,
      maxFee,
      totalAmount,
    }

  } catch (error) {
    console.error(
      'CCTP error:',
      error
    )

    statusElement.textContent =
      `Errore CCTP: ${
        error.shortMessage ||
        error.message ||
        error
      }`

    throw error
  }
}
