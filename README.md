# Cartesia STT Timestamp Discrepancy Reproduction

This repo demonstrates timestamp drift between Cartesia's Batch STT API and WebSocket STT API when transcribing the same audio.

## The Issue

When transcribing identical audio, the WebSocket API returns word timestamps that drift compared to the Batch API (used as ground truth). The drift accumulates and fluctuates unpredictably, sometimes exceeding **2-3 seconds**.

## Requirements

- [Bun](https://bun.sh) runtime
- Cartesia API key

## Installation

```bash
# Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# Install dependencies
bun install
```

## Usage

```bash
CARTESIA_API_KEY=your_api_key bun run start
```

## Example Output

11+ minute audio file (1300 words):

```
Audio Stats:
- Sample Rate: 16000 Hz
- Duration: 696.367 s
- Samples: 11141875

[1/2] Running Batch API (Reference)...
Batch finished. Found 1300 words.

[2/2] Running WebSocket API (Streaming)...

[Results] Timestamp Comparison (Batch vs WebSocket)
==========================================================================================
Index   Word                Batch Start    WS Start       Drift (WS-Batch)    
==========================================================================================
0       Hi,                 0.800          0.896          +0.096s             
1       I'm                 1.180          1.176          -0.004s             
2       Tommy               1.380          1.376          -0.004s             
3       and                 1.740          1.736          -0.004s             
4       today               2.120          2.116          -0.004s             
18      The                 8.140          9.088          +0.948s             
35      export.             14.580         15.768         +1.188s             
73      create              31.955         33.616         +1.661s             
98      And                 45.870         43.696         -2.174s             
269     JSEX                127.075        129.012        +1.937s             
339     screen              165.675        168.496        +2.821s             
340     sizes.              166.115        168.716        +2.601s             
...
==========================================================================================
Total Words: 1300
Words with significant drift (>0.1s): 358
Final drift at end of audio: -0.575s
```

## Key Observations

- **358 words** (28%) had drift > 0.1 seconds
- **Max positive drift**: +2.821s (word "screen" at index 339)
- **Max negative drift**: -2.174s (word "And" at index 98)
- Drift oscillates between positive and negative throughout the audio
- WebSocket timestamps become unreliable for synchronization use cases

The table shows:
- **Index**: Word position
- **Batch Start**: Timestamp from Batch API (ground truth)
- **WS Start**: Timestamp from WebSocket API
- **Drift**: Difference (positive = WebSocket later, negative = WebSocket earlier)
