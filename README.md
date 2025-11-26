# Cartesia STT Timestamp Discrepancy Reproduction

Demonstrates timestamp drift between Cartesia's Batch STT API and WebSocket STT API.

## Use Case

I need **streaming transcription of long audio** with **precise word-level timestamps** (drift < 100ms). Willing to trade latency for accuracy.

The Batch API has accurate timestamps but doesn't stream. The WebSocket API streams but has severe timestamp drift.

## Results

**Audio:** 16 minutes, 2153 words, 16kHz mono PCM float32

### 512ms chunks (8192 samples)

```
Index   Word                Batch Start    WS Start       Drift
0       Yo,                 0.240          0.264          +0.024s
102     And                 43.750         42.024         -1.726s
153     To                  68.365         66.480         -1.885s
325     happens             142.335        140.520        -1.815s
359     Framer              156.785        154.620        -2.165s
379     having              165.105        162.636        -2.469s
396     variant.            171.005        168.712        -2.293s
419     just                183.870        179.660        -4.210s
443     our                 195.075        192.100        -2.975s
================================================================================
Max drift: +0.728s / -4.210s
```

### 100ms chunks (1600 samples)

Drift worse - up to **-5.979s**

### 1s chunks (16000 samples)

**Failed** - WebSocket API returned 0 words.

## Conclusion

Chunk size doesn't improve timestamp accuracy. The issue is fundamental to how the WebSocket API processes streaming audio vs batch post-processing.

## Feature Request

A parameter to **prioritize timestamp accuracy over latency** would solve this. Even 5-10s added latency is acceptable for < 100ms drift.

## Reproduce

1. Install Bun
```bash
curl -fsSL https://bun.sh/install | bash
```

2. Install dependencies
```bash
bun install
```

3. Run the comparison
```bash
CARTESIA_API_KEY=your_key bun run start
```
