# NoBlur — Post TikTok Videos Without the Blur

NoBlur is a premium, client-side web application designed to patch MP4 and MOV video containers locally directly in your browser. By utilizing a dual-layered pipeline (Dual Hybrid Enhancement), this tool combines the ZeroLoss Track Bypass and Quantum Matrix Display Matrix Patch technologies to ensure your videos bypass aggressive server-side compression and quality degradation when uploaded to TikTok, preserving original quality, visual fidelity, and audio-video synchronization.

All processing is performed client-side using JavaScript, ArrayBuffers, and Blobs. No data is uploaded to external servers, guaranteeing absolute privacy and security for your content.

---

## Technical Architecture (Dual Hybrid Enhancement)

The processing engine performs a dual-pass manipulation on the video container metadata structure in a single execution flow:

1. **Pass 1: ZeroLoss Track Bypass (Track-Level Modification)**
   - Automatically scans the track structure inside the `moov` container.
   - If an `elst` (Edit List) atom is missing, the engine dynamically calculates track durations from the `tkhd` header, constructs a new `edts`/`elst` atom hierarchy, and injects it.
   - Automatically adjusts all chunk offset tables (`stco` and `co64` atoms) within the movie container to ensure structural alignment and prevent file corruption.

2. **Pass 2: Quantum Matrix Patch (Movie-Header-Level Modification)**
   - Automatically parses the global `mvhd` (Movie Header Box) metadata.
   - Dynamically detects the version of the `mvhd` box (Version 0 or 1) to locate the exact display matrix bytes.
   - Patches the Display Matrix parameter `matrix_b` from `0` to `1` in-place using signed 32-bit big-endian integer manipulation via `DataView`.

---

## Key Features

- **Dual Hybrid Engine:** Executes both ZeroLoss Track Bypass and Quantum Matrix patches sequentially on a single buffer array in one pass.
- **Client-Side Only:** 100% of processing happens locally within your browser, ensuring no network latency and total data privacy.
- **Multi-Format Support:** Full compatibility with standard MP4 and MOV container formats.
- **Universal Codec Compatibility:** Works seamlessly with all video encoders (H.264/AVC, H.265/HEVC, AV1, VP9, ProRes, etc.) since the engine only modifies metadata boxes and does not re-encode the actual stream.
- **Bulk Processing Queue:** Drag and drop or select multiple videos simultaneously to patch them in a sequential batch queue.
- **Fast-Start Container Fix:** Dynamically recalculates chunk offsets when structural shifts occur, ensuring patched videos do not become corrupted or unplayable.
- **High-Contrast Dark Neo-Brutalist UI:** Designed with flat offset box shadows, solid dark card panels, active tactile click feedback, and bright neon accent elements.
- **Responsive Mobile Layout Relocation:** Relocates the upload drop zone dynamically between the title and control box on mobile viewports for a fluid, natural flow.
- **Local History & Storage Limit Guard:** Keeps track of your patched files locally in IndexedDB with a strict 200MB limit check to protect browser storage from bloating.

---

## File Structure

```text
NoBlur/
├── public/
│   └── coi-serviceworker.js
├── index.html
├── style.css
├── app.js
├── db.js
├── coi-serviceworker.js
├── vite.config.js
├── package.json
├── biome.json
├── README.md
├── CHANGELOG.md
└── app.test.js
```

See [CHANGELOG.md](./CHANGELOG.md) for the full release history.

---

## Disclaimer

This utility patches standard metadata container atoms to match optimized format profiles. It is designed to work with valid MP4 and MOV containers. While every effort is made to safeguard file structures, always keep backups of your original video files before processing.
