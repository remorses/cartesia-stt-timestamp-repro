# Cartesia STT Timestamp Discrepancy Reproduction

This repo demonstrates timestamp drift between Cartesia's Batch STT API and WebSocket STT API when transcribing the same audio.

## The Issue

When transcribing identical audio, the WebSocket API returns word timestamps that drift compared to the Batch API (used as ground truth). The drift accumulates over time and can exceed 0.5 seconds.

## Requirements

- [Bun](https://bun.sh) runtime
- ffmpeg (for audio conversion)
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

```
Converting audio to 16kHz mono WAV...

Audio Stats:
- Sample Rate: 16000 Hz
- Duration: 10.001 s
- Samples: 160012

[1/2] Running Batch API (Reference)...
Batch finished. Found 24 words.

[2/2] Running WebSocket API (Streaming)...

[Results] Timestamp Comparison (Batch vs WebSocket)
==========================================================================================
Index   Word                Batch Start    WS Start       Drift (WS-Batch)    
==========================================================================================
0       Instead             0.300          0.320          +0.020s             
1       of                  0.480          0.520          +0.040s             
2       looking             0.660          0.660          0.000s              
3       up                  0.900          0.900          0.000s              
4       to                  1.200          1.200          0.000s              
16      to                  6.000          6.224          +0.224s             
19      mean,               7.820          8.124          +0.304s             
20      kids,               8.080          8.644          +0.564s             
21      Magellan's          8.620          9.304          +0.684s             
22      a                   9.300          9.484          +0.184s             
23      lot.                9.480          0.000          ---                 
==========================================================================================
Total Words: 24
Words with significant drift (>0.1s): 5
Final drift at end of audio: 0.184s
```

The table shows:
- **Index**: Word position
- **Batch Start**: Timestamp from Batch API (ground truth)
- **WS Start**: Timestamp from WebSocket API
- **Drift**: Difference (positive = WebSocket reports later timestamp)

Words with drift > 0.1s are shown, plus first/last 5 words for context.
