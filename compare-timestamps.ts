import { CartesiaClient } from '@cartesia/cartesia-js'
import * as fs from 'fs'
import * as path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

const audioPath = path.join(import.meta.dir, 'audio.mp3')
const tempWavPath = path.join(import.meta.dir, 'temp-16k.wav')

if (!process.env.CARTESIA_API_KEY) {
  console.error('Error: CARTESIA_API_KEY environment variable is required')
  process.exit(1)
}

if (!fs.existsSync(audioPath)) {
  console.error('Error: audio.mp3 not found in current directory')
  process.exit(1)
}

console.log('Converting audio to 16kHz mono WAV...')
await execAsync(`ffmpeg -y -i "${audioPath}" -ar 16000 -ac 1 -c:a pcm_f32le "${tempWavPath}"`)

const wavFileBuffer = fs.readFileSync(tempWavPath)
const pcmBuffer = wavFileBuffer.subarray(44)
const channelData = new Float32Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.byteLength / 4)

console.log(`\nAudio Stats:`)
console.log(`- Sample Rate: 16000 Hz`)
console.log(`- Duration: ${(channelData.length / 16000).toFixed(3)} s`)
console.log(`- Samples: ${channelData.length}`)

const cartesia = new CartesiaClient({ apiKey: process.env.CARTESIA_API_KEY })

console.log('\n[1/2] Running Batch API (Reference)...')
const audioFile = Bun.file(tempWavPath)

const batchResult = await cartesia.stt.transcribe(
  // @ts-ignore
  audioFile,
  {
    model: 'ink-whisper',
    language: 'en',
    timestampGranularities: ['word'],
  }
)

const batchWords = batchResult.words || []
console.log(`Batch finished. Found ${batchWords.length} words.`)

console.log('\n[2/2] Running WebSocket API (Streaming)...')
const ws = cartesia.stt.websocket({
  model: 'ink-whisper',
  language: 'en',
  encoding: 'pcm_f32le',
  sampleRate: 16000,
})

const wsRawWords: any[] = []

await new Promise<void>(async (resolve, reject) => {
  let idleTimeout: Timer | null = null
  let hasReceivedWords = false

  const resetIdleTimeout = () => {
    if (idleTimeout) {
      clearTimeout(idleTimeout)
    }
    if (hasReceivedWords) {
      idleTimeout = setTimeout(() => {
        resolve()
      }, 5000)
    }
  }

  ws.onMessage((message) => {
    resetIdleTimeout()

    if (message.type === 'transcript') {
      if (message.words && message.words.length > 0) {
        hasReceivedWords = true
        message.words.forEach((w: any) => {
          wsRawWords.push({ ...w })
        })
      }
    } else if (message.type === 'flush_done') {
      ws.done().catch(console.error)
    } else if (message.type === 'done') {
      if (idleTimeout) {
        clearTimeout(idleTimeout)
      }
      resolve()
    } else if (message.type === 'error') {
      if (idleTimeout) {
        clearTimeout(idleTimeout)
      }
      reject(new Error(message.message))
    }
  })

  try {
    await ws.connect()

    const chunkSize = 8192
    for (let i = 0; i < channelData.length; i += chunkSize) {
      const chunk = channelData.slice(i, i + chunkSize)
      await ws.send(chunk.buffer)
    }

    await ws.finalize()
  } catch (e) {
    if (idleTimeout) {
      clearTimeout(idleTimeout)
    }
    reject(e)
  }
})

ws.disconnect()

console.log('\n[Results] Timestamp Comparison (Batch vs WebSocket)')
console.log('=' .repeat(90))
console.log(
  'Index'.padEnd(8) +
    'Word'.padEnd(20) +
    'Batch Start'.padEnd(15) +
    'WS Start'.padEnd(15) +
    'Drift (WS-Batch)'.padEnd(20)
)
console.log('='.repeat(90))

const maxLen = Math.max(batchWords.length, wsRawWords.length)
let significantDiffCount = 0
let totalDrift = 0

for (let i = 0; i < maxLen; i++) {
  const b = batchWords[i]
  const w = wsRawWords[i]

  const word = (b?.word || w?.word || '').trim()
  const bStart = b ? b.start : 0
  const wStart = w ? w.start : 0

  let diffVal = 0
  let diffStr = '---'

  if (b && w) {
    diffVal = w.start - b.start
    totalDrift = diffVal
    diffStr = (diffVal > 0 ? '+' : '') + diffVal.toFixed(3) + 's'
  }

  if (Math.abs(diffVal) > 0.1 || i < 5 || i > maxLen - 5 || i % 50 === 0) {
    if (Math.abs(diffVal) > 0.1) {
      significantDiffCount++
    }

    console.log(
      String(i).padEnd(8) +
        word.substring(0, 19).padEnd(20) +
        bStart.toFixed(3).padEnd(15) +
        wStart.toFixed(3).padEnd(15) +
        diffStr.padEnd(20)
    )
  }
}

console.log('='.repeat(90))
console.log(`Total Words: ${maxLen}`)
console.log(`Words with significant drift (>0.1s): ${significantDiffCount}`)
console.log(`Final drift at end of audio: ${totalDrift.toFixed(3)}s`)

fs.unlinkSync(tempWavPath)
process.exit(0)
