import express from 'express'
import cors from 'cors'
import { spawn } from 'node:child_process'
import { PublicKey } from '@solana/web3.js'

const app = express()
const PORT = 3001

app.use(cors({ origin: 'http://localhost:5175' }))
app.use(express.json())

let mining = false

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

  child.stdout.on('data', data => {
    stdout += data.toString()
  })

  child.stderr.on('data', data => {
    stderr += data.toString()
  })

  child.on('error', error => {
    mining = false

    res.status(500).json({
      ok: false,
      error: error.message,
    })
  })

  child.on('close', code => {
    mining = false

    res.status(code === 0 ? 200 : 500).json({
      ok: code === 0,
      code,
      stdout,
      stderr,
    })
  })
})

app.listen(PORT, () => {
  console.log(`Mining backend listening on http://localhost:${PORT}`)
})
