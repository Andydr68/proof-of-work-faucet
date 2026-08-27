import express from 'express'
import cors from 'cors'
import { spawn, execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  PublicKey,
  Connection,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js'

const app = express()
const PORT = Number(process.env.PORT || 3002)
const REPO_ROOT = path.resolve(process.cwd(), '..')
const PERFORMANCE_FILE =
  path.join(REPO_ROOT, '.devnet-pow-performance.json')

const DEVNET_RPC =
  process.env.DEVNET_RPC ||
  'https://api.devnet.solana.com'

const MINER_RESERVE_SOL =
  Number(process.env.MINER_RESERVE_SOL || 0.25)

const devnetConnection =
  new Connection(DEVNET_RPC, 'confirmed')

app.use(cors({
  origin(origin, callback) {
    if (
      !origin ||
      /^http:\/\/localhost:\d+$/.test(origin)
    ) {
      callback(null, true)
    } else {
      callback(new Error('Origin not allowed by CORS'))
    }
  },
}))
app.use(express.json())

let mining = false

const MAX_OVERHEAD_SAMPLES = 20
const DEFAULT_OVERHEAD_PER_REWARD = 0.00090588
const overheadSamples = []
let overheadHistoryLoaded = false

async function ensureOverheadHistoryLoaded() {
  if (overheadHistoryLoaded) return

  overheadHistoryLoaded = true

  try {
    const raw = await readFile(
      PERFORMANCE_FILE,
      'utf8',
    )

    const history = JSON.parse(raw)

    if (Array.isArray(history.overhead_samples)) {
      overheadSamples.push(
        ...history.overhead_samples
          .map(Number)
          .filter(
            value =>
              Number.isFinite(value) &&
              value >= 0
          )
          .slice(-MAX_OVERHEAD_SAMPLES)
      )
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(
        'Unable to load overhead history:',
        error.message,
      )
    }
  }
}

async function saveOverheadHistory() {
  let history = {
    difficulties: {},
  }

  try {
    const raw = await readFile(
      PERFORMANCE_FILE,
      'utf8',
    )

    history = JSON.parse(raw)
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
  }

  history.overhead_samples =
    overheadSamples.slice(-MAX_OVERHEAD_SAMPLES)

  await writeFile(
    PERFORMANCE_FILE,
    JSON.stringify(history, null, 2) + '\n',
    'utf8',
  )
}

async function recordOverhead(value) {
  await ensureOverheadHistoryLoaded()

  const overhead = Number(value)

  if (!Number.isFinite(overhead) || overhead < 0) {
    return
  }

  overheadSamples.push(overhead)

  while (overheadSamples.length > MAX_OVERHEAD_SAMPLES) {
    overheadSamples.shift()
  }

  await saveOverheadHistory()
}

function getAverageOverhead() {
  if (overheadSamples.length === 0) {
    return DEFAULT_OVERHEAD_PER_REWARD
  }

  return (
    overheadSamples.reduce((sum, value) => sum + value, 0) /
    overheadSamples.length
  )
}


function getCliAddress() {
  return new Promise((resolve, reject) => {
    execFile(
      'solana',
      ['address'],
      {
        cwd: REPO_ROOT,
        env: process.env,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              stderr?.trim() ||
              error.message
            )
          )
          return
        }

        resolve(stdout.trim())
      },
    )
  })
}

async function getMinerWalletStatus() {
  await ensureOverheadHistoryLoaded()

  const address = await getCliAddress()
  const publicKey = new PublicKey(address)

  const lamports =
    await devnetConnection.getBalance(publicKey)

  const balanceSol =
    lamports / LAMPORTS_PER_SOL

  return {
    address,
    balanceSol,
    reserveSol: MINER_RESERVE_SOL,
    availableForOperations:
      Math.max(
        balanceSol - MINER_RESERVE_SOL,
        0,
      ),
    reserveOk:
      balanceSol > MINER_RESERVE_SOL,
    averageOverheadPerReward:
      getAverageOverhead(),
    overheadSamples:
      overheadSamples.length,
  }
}

function parseMiningOutput(stdout) {
  const bestMatch = stdout.match(
    /Best faucet selected:\s+(\S+)\s+\|\s+difficulty\s+(\d+)\s+\|\s+reward\s+([0-9.]+)\s+SOL/
  )

  const learningMatches = [
    ...stdout.matchAll(
      /Learning: difficulty (\d+) \| claims (\d+) \| confidence ([0-9.]+)% \| robust ([0-9.]+)s \| blended ([0-9.]+)s/g
    ),
  ]

  const profitMatches = [
    ...stdout.matchAll(
      /Profit estimate: difficulty (\d+) \| reward ([0-9.]+) SOL \| overhead ([0-9.]+) SOL \| net ([0-9.]+) SOL \| ([0-9.]+)s expected \| gross ([0-9.]+) SOL\/s \| net ([0-9.]+) SOL\/s/g
    ),
  ]

  const stabilityMatches = [
    ...stdout.matchAll(
      /Stability: difficulty (\d+) \| penalty -([0-9.]+)% \| base ([0-9.]+) \| stable ([0-9.]+)/g
    ),
  ]

  const explorationMatches = [
    ...stdout.matchAll(
      /Exploration: difficulty (\d+) \| claims (\d+) \| bonus \+([0-9.]+)% \| base ([0-9.]+) \| adjusted ([0-9.]+)/g
    ),
  ]

  const receivedMatch = stdout.match(
    /Received\s+([0-9.]+)\s+SOL from faucet\s+(\S+):\s+(\S+)/
  )

  const forwardedMatch = stdout.match(
    /Forwarded\s+([0-9.]+)\s+SOL to\s+(\S+):\s+(\S+)/
  )

  const elapsedMatch = stdout.match(
    /Elapsed time:\s+([0-9.]+)\s+s/
  )

  const grossMatch = stdout.match(
    /Gross rewards:\s+([0-9.]+)\s+SOL/
  )

  const sessionCostMatch = stdout.match(
    /Session cost:\s+([0-9.]+)\s+SOL/
  )

  const netChangeMatch = stdout.match(
    /Net balance change:\s+(-?[0-9.]+)\s+SOL/
  )

  return {
    faucet:
      receivedMatch?.[2] ??
      bestMatch?.[1] ??
      null,

    algorithm: {
      learning: learningMatches.map(match => ({
        difficulty: Number(match[1]),
        claims: Number(match[2]),
        confidence: Number(match[3]),
        robustSeconds: Number(match[4]),
        blendedSeconds: Number(match[5]),
      })),

      profitability: profitMatches.map(match => ({
        difficulty: Number(match[1]),
        reward: Number(match[2]),
        overhead: Number(match[3]),
        netReward: Number(match[4]),
        expectedSeconds: Number(match[5]),
        grossSolPerSecond: Number(match[6]),
        netSolPerSecond: Number(match[7]),
        grossSolPerHour:
          Number(match[6]) * 3600,
        netSolPerHour:
          Number(match[7]) * 3600,
      })),

      stability: stabilityMatches.map(match => ({
        difficulty: Number(match[1]),
        penaltyPercent: Number(match[2]),
        baseScore: Number(match[3]),
        stableScore: Number(match[4]),
        stableSolPerHour:
          Number(match[4]) * 3600,
      })),

      exploration: explorationMatches.map(match => ({
        difficulty: Number(match[1]),
        claims: Number(match[2]),
        bonusPercent: Number(match[3]),
        baseScore: Number(match[4]),
        adjustedScore: Number(match[5]),
      })),
    },

    difficulty:
      bestMatch
        ? Number(bestMatch[2])
        : null,

    reward:
      receivedMatch
        ? Number(receivedMatch[1])
        : bestMatch
          ? Number(bestMatch[3])
          : null,

    elapsedSeconds:
      elapsedMatch
        ? Number(elapsedMatch[1])
        : null,

    claimTx:
      receivedMatch?.[3] ??
      null,

    forwardTx:
      forwardedMatch?.[3] ??
      null,

    grossReward:
      grossMatch
        ? Number(grossMatch[1])
        : null,

    sessionCost:
      sessionCostMatch
        ? Number(sessionCostMatch[1])
        : null,

    netBalanceChange:
      netChangeMatch
        ? Number(netChangeMatch[1])
        : null,

    overhead:
      sessionCostMatch
        ? Math.max(
            Number(sessionCostMatch[1]),
            0,
          )
        : null,
  }
}

app.get('/api/performance', async (req, res) => {
  try {
    const raw = await readFile(
      PERFORMANCE_FILE,
      'utf8',
    )

    const history = JSON.parse(raw)
    const difficulties = {}

    for (
      const [difficulty, data]
      of Object.entries(history.difficulties || {})
    ) {
      const claims = Number(data.claims || 0)
      const totalSeconds =
        Number(data.total_seconds || 0)
      const grossLamports =
        Number(data.gross_lamports || 0)

      const recent = Array.isArray(data.recent_seconds)
        ? data.recent_seconds
            .map(Number)
            .filter(Number.isFinite)
        : []

      const sorted = [...recent].sort(
        (a, b) => a - b
      )

      let medianRecent = null

      if (sorted.length > 0) {
        const middle =
          Math.floor(sorted.length / 2)

        medianRecent =
          sorted.length % 2 === 0
            ? (
                sorted[middle - 1] +
                sorted[middle]
              ) / 2
            : sorted[middle]
      }

      const averageSeconds =
        claims > 0
          ? totalSeconds / claims
          : null

      const grossSol =
        grossLamports / 1e9

      const grossSolPerSecond =
        totalSeconds > 0
          ? grossSol / totalSeconds
          : null

      difficulties[difficulty] = {
        claims,
        totalSeconds,
        grossSol,
        averageSeconds,
        medianRecent,
        recentSamples: recent.length,
        grossSolPerSecond,
        grossSolPerHour:
          grossSolPerSecond != null
            ? grossSolPerSecond * 3600
            : null,
      }
    }

    res.json({
      ok: true,
      difficulties,
    })
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    })
  }
})

app.get('/api/miner-wallet', async (req, res) => {
  try {
    const wallet =
      await getMinerWalletStatus()

    res.json({
      ok: true,
      ...wallet,
    })
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    })
  }
})

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    mining,
  })
})

app.post('/api/mine', async (req, res) => {
  if (mining) {
    return res.status(409).json({
      ok: false,
      error: 'Mining already in progress',
    })
  }

  const { recipient } = req.body

  if (typeof recipient !== 'string') {
    return res.status(400).json({
      ok: false,
      error: 'Missing recipient',
    })
  }

  try {
    new PublicKey(recipient)
  } catch {
    return res.status(400).json({
      ok: false,
      error: 'Invalid Solana recipient address',
    })
  }

  let minerWallet

  try {
    minerWallet =
      await getMinerWalletStatus()
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error:
        `Unable to read miner wallet: ${error.message}`,
    })
  }

  if (!minerWallet.reserveOk) {
    return res.status(409).json({
      ok: false,
      error:
        `Miner reserve protection triggered. ` +
        `Balance ${minerWallet.balanceSol.toFixed(9)} SOL, ` +
        `minimum reserve ${minerWallet.reserveSol.toFixed(9)} SOL.`,
      reserveProtection: true,
      minerWallet,
    })
  }

  mining = true

  const args = [
    'mine',
    '--best',
    '--max-rewards',
    '1',
    '--recipient',
    recipient,
    '--url',
    'dev',
  ]

  const child = spawn(
    './target/release/devnet-pow',
    args,
    {
      cwd: REPO_ROOT,
      env: process.env,
    },
  )

  let stdout = ''
  let stderr = ''
  let responded = false

  child.stdout.on('data', data => {
    stdout += data.toString()
  })

  child.stderr.on('data', data => {
    stderr += data.toString()
  })

  child.on('error', error => {
    mining = false

    if (responded) return
    responded = true

    res.status(500).json({
      ok: false,
      error: error.message,
    })
  })

  child.on('close', async code => {
    mining = false

    if (responded) return
    responded = true

    console.log('\n===== MINER STDOUT =====')
    console.log(stdout)
    console.log('===== MINER STDERR =====')
    console.log(stderr)
    console.log('========================\n')

    const miningData =
      parseMiningOutput(stdout)

    if (miningData.overhead != null) {
      try {
        await recordOverhead(miningData.overhead)
      } catch (error) {
        console.warn(
          'Unable to persist overhead sample:',
          error.message,
        )
      }
    }

    console.log('Parsed mining data:', miningData)

    res
      .status(code === 0 ? 200 : 500)
      .json({
        ok: code === 0,
        code,
        stdout,
        stderr,
        mining: miningData,
      })
  })
})

app.listen(PORT, () => {
  console.log(
    `Mining backend listening on http://localhost:${PORT}`
  )
})
