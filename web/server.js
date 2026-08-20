import express from 'express'
import cors from 'cors'
import { spawn } from 'node:child_process'
import { PublicKey } from '@solana/web3.js'

const app = express()
const PORT = 3001

app.use(cors({ origin: 'http://localhost:5175' }))
app.use(express.json())

let mining = false

function parseMiningOutput(stdout) {
  const bestMatch = stdout.match(
    /Best faucet selected:\s+(\S+)\s+\|\s+difficulty\s+(\d+)\s+\|\s+reward\s+([0-9.]+)\s+SOL/
  )

  const receivedMatch = stdout.match(
    /Received\s+([0-9.]+)\s+SOL from faucet\s+(\S+):\s+(\S+)/
  )

  const forwardedMatch = stdout.match(
    /Forwarded\s+([0-9.]+)\s+SOL to\s+(\S+):\s+(\S+)/
  )

  const elapsedMatch = stdout.match(
    /Elapsed time:\s+([0-9.]+)\s+s/
  )

  return {
    faucet:
      receivedMatch?.[2] ??
      bestMatch?.[1] ??
      null,

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
  }
}

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
    '../target/debug/devnet-pow',
    args,
    {
      cwd: process.cwd(),
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
