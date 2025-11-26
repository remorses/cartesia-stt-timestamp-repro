import { CartesiaClient } from '@cartesia/cartesia-js'
import * as fs from 'fs'
import * as path from 'path'

const wavPath = path.join(import.meta.dir, 'audio.wav')

if (!process.env.CARTESIA_API_KEY) {
  console.error('Error: CARTESIA_API_KEY environment variable is required')
  process.exit(1)
}

if (!fs.existsSync(wavPath)) {
  console.error('Error: audio.wav not found in current directory')
  process.exit(1)
}

const wavFileBuffer = fs.readFileSync(wavPath)
const pcmBuffer = wavFileBuffer.subarray(44)
const channelData = new Float32Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.byteLength / 4)

const SAMPLE_RATE = 16000;

console.log(`\nAudio Stats:`)
console.log(`- Sample Rate: ${SAMPLE_RATE} Hz`)
console.log(`- Duration: ${(channelData.length / SAMPLE_RATE).toFixed(3)} s`)
console.log(`- Samples: ${channelData.length}`)

const cartesia = new CartesiaClient({ apiKey: process.env.CARTESIA_API_KEY })

console.log('\n[1/2] Running Batch API (Reference)...')
const audioFile = Bun.file(wavPath)

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
  sampleRate: SAMPLE_RATE,
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

    const chunkSize = SAMPLE_RATE * 0.512 // 512ms
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

// Normalization and word matching functions from Python version
interface WordWithTimestamp {
  word: string
  start: number
  end: number
}

interface TimestampDifference {
  word: string
  index: number
  batch_start: number
  batch_end: number
  ws_start: number
  ws_end: number
  start_diff: number
  end_diff: number
}

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/\W/g, '')
}

function normalizeWords(words: any[]): WordWithTimestamp[] {
  return words.map(w => ({
    word: normalizeWord(w.word),
    start: w.start,
    end: w.end
  }))
}

/**
 * Find the minimum adjustment in indexes to match up words in both transcripts.
 *
 * When words don't align at the current positions (i, j), this function searches
 * for a match in an expanding pattern. It starts at the current position and expands
 * outward in a square pattern using Chebyshev distance (max of horizontal/vertical offset).
 *
 * For example, with maxDistance=3, it checks positions in this order:
 * - Distance 0: (i, j)
 * - Distance 1: (i+1, j+1), then all positions 1 step away
 * - Distance 2: (i+2, j+2), then all positions 2 steps away
 * - Distance 3: (i+3, j+3), then all positions 3 steps away
 *
 * This helps align transcripts when one has insertions, deletions, or substitutions.
 *
 * @param wordsA - Reference transcript (typically batch API result)
 * @param wordsB - Transcript to compare (typically websocket result)
 * @param i - Starting index in wordsA
 * @param j - Starting index in wordsB
 * @param maxDistance - Maximum distance from origin to search (default 3)
 * @returns Tuple of [wordsAIndex, wordsBIndex] if match found, else null
 */
function findMatchingIndex(
  wordsA: WordWithTimestamp[],
  wordsB: WordWithTimestamp[],
  i: number,
  j: number,
  maxDistance: number = 3
): [number, number] | null {
  // Check if starting indexes are valid
  if (i >= wordsA.length || j >= wordsB.length) {
    return null
  }

  // Check starting position (distance 0)
  if (wordsA[i].word === wordsB[j].word) {
    return [i, j]
  }

  // Expand outward from starting position
  for (let distance = 1; distance <= maxDistance; distance++) {
    // Check diagonal first (most common case for aligned transcripts)
    const gi = i + distance
    const gj = j + distance
    if (gi < wordsA.length && gj < wordsB.length) {
      if (wordsA[gi].word === wordsB[gj].word) {
        return [gi, gj]
      }
    }

    // Check all other points at this Chebyshev distance
    // (points where max(offsetI, offsetJ) == distance)
    for (let offsetI = 0; offsetI <= distance; offsetI++) {
      for (let offsetJ = 0; offsetJ <= distance; offsetJ++) {
        // Skip if not at the correct distance
        if (Math.max(offsetI, offsetJ) !== distance) {
          continue
        }
        // Skip diagonal (already checked above)
        if (offsetI === distance && offsetJ === distance) {
          continue
        }

        const gi = i + offsetI
        const gj = j + offsetJ

        if (gi < wordsA.length && gj < wordsB.length) {
          if (wordsA[gi].word === wordsB[gj].word) {
            return [gi, gj]
          }
        }
      }
    }
  }

  // No match found within maxDistance
  return null
}

// Normalize both results
const normalizedBatch = normalizeWords(batchWords)
const normalizedWS = normalizeWords(wsRawWords)

console.log('\n[Results] Timestamp Comparison (Batch vs WebSocket)')
console.log('=' .repeat(90))
console.log(
  'Batch Idx'.padEnd(12) +
    'WS Idx'.padEnd(12) +
    'Word'.padEnd(20) +
    'Batch Start'.padEnd(15) +
    'WS Start'.padEnd(15) +
    'Drift (WS-Batch)'.padEnd(20)
)
console.log('='.repeat(90))

let i = 0 // batch index
let j = 0 // websocket index
let significantDiffCount = 0
let totalDrift = 0
let matchedCount = 0
let mismatchCount = 0
const timestampDifferences: TimestampDifference[] = []

while (i < normalizedBatch.length || j < normalizedWS.length) {
  if (i >= normalizedBatch.length) {
    // WS has extra words
    console.log(
      '---'.padEnd(12) +
        String(j).padEnd(12) +
        `[+${wsRawWords[j].word}]`.substring(0, 19).padEnd(20) +
        '---'.padEnd(15) +
        normalizedWS[j].start.toFixed(3).padEnd(15) +
        '(insertion)'
    )
    mismatchCount++
    j++
    continue
  }

  if (j >= normalizedWS.length) {
    // Batch has extra words
    console.log(
      String(i).padEnd(12) +
        '---'.padEnd(12) +
        `[-${batchWords[i].word}]`.substring(0, 19).padEnd(20) +
        normalizedBatch[i].start.toFixed(3).padEnd(15) +
        '---'.padEnd(15) +
        '(deletion)'
    )
    mismatchCount++
    i++
    continue
  }

  const batchWord = normalizedBatch[i]
  const wsWord = normalizedWS[j]

  if (batchWord.word === wsWord.word) {
    // Words match - compare timestamps
    const diffVal = wsWord.start - batchWord.start
    totalDrift = diffVal
    const diffStr = (diffVal > 0 ? '+' : '') + diffVal.toFixed(3) + 's'

    const showRow = Math.abs(diffVal) > 0.1 || matchedCount < 5 || i > normalizedBatch.length - 5 || matchedCount % 50 === 0

    if (Math.abs(diffVal) > 0.1) {
      significantDiffCount++
    }

    if (showRow) {
      console.log(
        String(i).padEnd(12) +
          String(j).padEnd(12) +
          batchWords[i].word.substring(0, 19).padEnd(20) +
          batchWord.start.toFixed(3).padEnd(15) +
          wsWord.start.toFixed(3).padEnd(15) +
          diffStr.padEnd(20)
      )
    }

    // Save matched word data
    timestampDifferences.push({
      word: batchWords[i].word,
      index: i,
      batch_start: batchWord.start,
      batch_end: batchWord.end,
      ws_start: wsWord.start,
      ws_end: wsWord.end,
      start_diff: wsWord.start - batchWord.start,
      end_diff: wsWord.end - batchWord.end
    })

    matchedCount++
    i++
    j++
  } else {
    // Words don't match - use find_matching_index to resolve
    const match = findMatchingIndex(normalizedBatch, normalizedWS, i, j)

    if (match === null) {
      // No resolution found
      console.log(
        String(i).padEnd(12) +
          String(j).padEnd(12) +
          `[?${batchWords[i].word}/${wsRawWords[j].word}]`.substring(0, 19).padEnd(20) +
          batchWord.start.toFixed(3).padEnd(15) +
          wsWord.start.toFixed(3).padEnd(15) +
          '(unresolved)'
      )
      mismatchCount++
      break
    }

    const [matchedI, matchedJ] = match

    // Report the mismatches
    if (matchedI === i && matchedJ > j) {
      // Insertions in WS
      for (let k = j; k < matchedJ; k++) {
        console.log(
          '---'.padEnd(12) +
            String(k).padEnd(12) +
            `[+${wsRawWords[k].word}]`.substring(0, 19).padEnd(20) +
            '---'.padEnd(15) +
            normalizedWS[k].start.toFixed(3).padEnd(15) +
            '(insertion)'
        )
        mismatchCount++
      }
      j = matchedJ
    } else if (matchedI > i && matchedJ === j) {
      // Deletions from batch
      for (let k = i; k < matchedI; k++) {
        console.log(
          String(k).padEnd(12) +
            '---'.padEnd(12) +
            `[-${batchWords[k].word}]`.substring(0, 19).padEnd(20) +
            normalizedBatch[k].start.toFixed(3).padEnd(15) +
            '---'.padEnd(15) +
            '(deletion)'
        )
        mismatchCount++
      }
      i = matchedI
    } else {
      // Substitution or complex mismatch
      const numBatch = matchedI - i
      const numWS = matchedJ - j
      const minCount = Math.min(numBatch, numWS)

      for (let k = 0; k < minCount; k++) {
        console.log(
          String(i + k).padEnd(12) +
            String(j + k).padEnd(12) +
            `[${batchWords[i + k].word}→${wsRawWords[j + k].word}]`.substring(0, 19).padEnd(20) +
            normalizedBatch[i + k].start.toFixed(3).padEnd(15) +
            normalizedWS[j + k].start.toFixed(3).padEnd(15) +
            '(substitution)'
        )
        mismatchCount++
      }

      if (numBatch > numWS) {
        for (let k = minCount; k < numBatch; k++) {
          console.log(
            String(i + k).padEnd(12) +
              '---'.padEnd(12) +
              `[-${batchWords[i + k].word}]`.substring(0, 19).padEnd(20) +
              normalizedBatch[i + k].start.toFixed(3).padEnd(15) +
              '---'.padEnd(15) +
              '(deletion)'
          )
          mismatchCount++
        }
      } else if (numWS > numBatch) {
        for (let k = minCount; k < numWS; k++) {
          console.log(
            '---'.padEnd(12) +
              String(j + k).padEnd(12) +
              `[+${wsRawWords[j + k].word}]`.substring(0, 19).padEnd(20) +
              '---'.padEnd(15) +
              normalizedWS[j + k].start.toFixed(3).padEnd(15) +
              '(insertion)'
          )
          mismatchCount++
        }
      }

      i = matchedI
      j = matchedJ
    }
  }
}

console.log('='.repeat(90))
console.log(`Batch Words: ${normalizedBatch.length}`)
console.log(`WebSocket Words: ${normalizedWS.length}`)
console.log(`Matched Words: ${matchedCount}`)
console.log(`Mismatched/Unaligned Words: ${mismatchCount}`)
console.log(`Words with significant drift (>0.1s): ${significantDiffCount}`)
console.log(`Final drift at end of audio: ${totalDrift.toFixed(3)}s`)

// Save results to JSON
const outputPath = path.join(import.meta.dir, 'stt_comparison_analysis.json')
fs.writeFileSync(
  outputPath,
  JSON.stringify(
    {
      audio_stats: {
        sample_rate: SAMPLE_RATE,
        duration: channelData.length / SAMPLE_RATE,
        samples: channelData.length,
      },
      between_method_comparison: {
        batch_words_count: normalizedBatch.length,
        websocket_words_count: normalizedWS.length,
        matched_words: matchedCount,
        mismatched_words: mismatchCount,
        significant_drift_count: significantDiffCount,
        final_drift: totalDrift,
        timestamp_differences: timestampDifferences,
      },
    },
    null,
    2
  )
);
console.log(`\nResults saved to: ${outputPath}`)

process.exit(0)
