import express from 'express'
import cors from 'cors'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PublicKey } from '@solana/web3.js'

const app = express()
const PORT = Number(process.env.PORT || 3002)
const REPO_ROOT = path.resolve(process.cwd(), '..')
const PERFORMANCE_FILE =
  path.join(REPO_ROOT, '.devnet-pow-performance.json')

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
      /Profit estimate: difficulty (\d+) \| reward ([0-9.]+) SOL \| ([0-9.]+)s expected \| ([0-9.]+) SOL\/s/g
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
        expectedSeconds: Number(match[3]),
        solPerSecond: Number(match[4]),
        solPerHour: Number(match[4]) * 3600,
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
      grossMatch && sessionCostMatch
        ? Math.max(
            Number(sessionCostMatch[1]) -
            Number(grossMatch[1]),
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

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    mining,
  })
})

app.post('/api/mine', (req, res) => {
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
    './target/debug/devnet-pow',
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

  child.on('close', code => {
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
