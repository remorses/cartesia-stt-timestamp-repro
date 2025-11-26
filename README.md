# Cartesia STT Timestamp Discrepancy Reproduction

Demonstrates timestamp drift between Cartesia's Batch STT API and WebSocket STT API.

## Use Case

I need **streaming transcription of long audio** with **precise word-level timestamps** (drift < 100ms). Willing to trade latency for accuracy.

The Batch API has accurate timestamps but doesn't stream. The WebSocket API streams but has severe timestamp drift.

## Results

**Audio:** 11 minutes, 1300 words, 16kHz mono PCM float32

### 512ms chunks (8192 samples)

```
Index   Word                Batch Start    WS Start       Drift
0       Hi,                 0.800          0.896          +0.096s
18      The                 8.140          9.088          +0.948s
73      create              31.955         33.616         +1.661s
98      And                 45.870         43.696         -2.174s
269     JSEX                127.075        129.012        +1.937s
339     screen              165.675        168.496        +2.821s
================================================================================
Words with drift >0.1s: 358/1300 (28%)
Max drift: +2.821s / -2.174s
```

### 100ms chunks (1600 samples)

```
Index   Word                Batch Start    WS Start       Drift
0       Hi,                 0.800          0.900          +0.100s
196     After               93.030         90.592         -2.438s
324     which               160.395        157.808        -2.587s
365     So                  183.175        179.664        -3.511s
381     we                  193.295        189.180        -4.115s
410     as                  212.675        207.356        -5.319s
411     a                   213.495        207.516        -5.979s
================================================================================
Words with drift >0.1s: 380/1300 (29%)
Max drift: +1.917s / -5.979s
```

### 1s chunks (16000 samples)

**Failed** - WebSocket API returned 0 words. Chunks this large don't work.

## Conclusion

Chunk size doesn't improve timestamp accuracy. Smaller chunks actually made drift worse in some cases. The issue is fundamental to how the WebSocket API processes streaming audio vs batch post-processing.

## Feature Request

A parameter to **prioritize timestamp accuracy over latency** would solve this. Even 5-10s added latency is acceptable for < 100ms drift.

## Run

```bash
curl -fsSL https://bun.sh/install | bash
bun install
CARTESIA_API_KEY=your_key bun run start
```
