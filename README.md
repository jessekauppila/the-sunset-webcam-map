# The Sunset Webcam Map

A real-time webcam mapping application that shows live webcam feeds from locations experiencing sunset around the world.

## Features

- 🌅 **Real-time Sunset Tracking**: Automatically finds locations experiencing sunset
- 📹 **Live Webcam Feeds**: Displays webcam streams from sunset locations
- 🗺️ **Interactive Map**: Built with Mapbox for smooth navigation
- 📍 **Closest Webcam**: Automatically flies to the nearest webcam to your location
- 🎯 **Canvas Rendering**: High-performance webcam image display using HTML5 Canvas

## Tech Stack

- **Frontend**: Next.js 14, React, TypeScript
- **Mapping**: Mapbox GL JS
- **Styling**: Tailwind CSS
- **Testing**: Vitest
- **Data Source**: Windy.com Webcam API

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Mapbox access token

## Project Structure

```
app/
├── components/
│   ├── Map/                 # Map-related components
│   │   ├── hooks/          # Custom React hooks
│   │   └── lib/            # Map utilities
│   ├── WebcamConsole.tsx   # Webcam data display
│   └── WebcamDisplay.tsx   # Canvas-based webcam viewer
├── lib/
│   └── types.ts            # TypeScript type definitions
└── page.tsx                 # Main application page
```

## Key Components

- **SimpleMap**: Main map component with sunset tracking
- **WebcamConsole**: Displays webcam data in a console-like interface
- **WebcamDisplay**: Canvas-based webcam image renderer

########################################

### Guide To Future Use

## Terminator Ring Layer

useSetWebCamMarkers: "const INITIAL_IMMEDIATE_BATCHES = 17; // or pass this in from caller later"

- needs to be adjust for greater terminator ring fidelity down the road.

terminatorRing: precisionDeg = 10

- also needs to be adjust for greater terminator ring fidelity down the road.

## Terminator Ring Layer

terminatorRingLineLayer: can uncommment layer to show terminator ring line on map

########################################

### Installation

## Development

### Running Tests

```bash
npm test
```

### Building for Production

```bash
npm run build
```

## Author

**Jesse Kauppila**

- GitHub: [@jessekauppila](https://github.com/jessekauppila)

## Acknowledgments

- Windy.com for providing webcam data
- Mapbox for mapping services
- The React and Next.js communities

## License

Copyright (c) 2025 Jesse Kauppila. All rights reserved.

This software is proprietary and confidential. No part of this software may be:

- Copied, modified, or distributed
- Used for commercial purposes
- Reverse engineered
- Shared with third parties

without explicit written permission from the copyright holder.

┌─────────────────────────────────────────────────────────────────────────────────┐
│ COMPLETE DATA FLOW ARCHITECTURE │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────┐
│ DATA INGESTION FLOW │
└─────────────────────────────────────────────────────────────────────────────────┘

1️⃣ CRON JOB (External Data)
📅 /api/cron/update-terminator/route.ts
├── Calculates sunrise/sunset terminator coordinates
├── Fetches webcams from Windy API at those coordinates
├── Deduplicates webcams by webcamId
└── UPSERTS to database tables:
├── webcams (basic webcam data - NO rating/orientation)
└── terminator_webcam_state (sunrise/sunset phase + rank)

                    ⬇️ WRITES TO DATABASE

┌─────────────────────────────────────────────────────────────────────────────────┐
│ DATABASE LAYER │
└─────────────────────────────────────────────────────────────────────────────────┘

🗄️ PostgreSQL Database
├── webcams table
│ ├── Basic data (title, location, images, etc.) ← FROM CRON
│ ├── rating (NULL initially) ← FROM CLIENT
│ └── orientation (NULL initially) ← FROM CLIENT
└── terminator_webcam_state table
├── webcam_id, phase (sunrise/sunset), rank ← FROM CRON
└── active flag

                    ⬇️ READS FROM DATABASE

┌─────────────────────────────────────────────────────────────────────────────────┐
│ DATA RETRIEVAL FLOW │
└─────────────────────────────────────────────────────────────────────────────────┘

2️⃣ READ API
📖 /api/db-terminator-webcams/route.ts
├── JOINs webcams + terminator_webcam_state tables
├── Returns combined data including rating & orientation
└── Transforms to WindyWebcam[] format

                    ⬇️ FETCHED BY CLIENT

3️⃣ CLIENT DATA LOADING
🔄 useLoadTerminatorWebcams() hook
├── Uses SWR to fetch from /api/db-terminator-webcams
├── Refreshes every 60 seconds
└── Feeds data into Zustand store

                    ⬇️ STORES IN STATE

┌─────────────────────────────────────────────────────────────────────────────────┐
│ STATE MANAGEMENT │
└─────────────────────────────────────────────────────────────────────────────────┘

4️⃣ ZUSTAND STORE (Central State)
🏪 useTerminatorStore.ts
├── Stores: { sunrise: WindyWebcam[], sunset: WindyWebcam[] }
├── setRows() ← Updates from API data
├── setRating() ← Updates local state from UI
└── setOrientation() ← Updates local state from UI

                    ⬇️ CONSUMED BY COMPONENTS

5️⃣ UI COMPONENTS
🖥️ React Components
├── Read webcam data from Zustand store
├── Display ratings & orientations
└── Allow user to modify rating/orientation

                    ⬇️ USER INTERACTIONS

┌─────────────────────────────────────────────────────────────────────────────────┐
│ CLIENT UPDATE FLOW │
└─────────────────────────────────────────────────────────────────────────────────┘

6️⃣ CLIENT UPDATES (User Changes)
✏️ useUpdateWebcam() hook
├── updateRating(webcamId, rating)
├── updateOrientation(webcamId, orientation)
└── updateWebcam(webcamId, {rating, orientation})

                    ⬇️ SENDS TO API

7️⃣ UPDATE APIs (Client → Database)
📝 /api/webcams/[id]/route.ts (or individual rating/orientation routes)
├── Validates input data
├── UPDATEs webcams table with new rating/orientation
└── Returns success/error response

                    ⬇️ WRITES TO DATABASE

8️⃣ DATA SYNC
🔄 Next SWR refresh (60s) picks up the changes
└── Updates Zustand store with persisted data

---

## Rating Calculation Logic

When a user rates a snapshot:

1. Upsert rating in `webcam_snapshot_ratings` (one per user per snapshot)
2. Calculate average: `SELECT AVG(rating) FROM webcam_snapshot_ratings WHERE snapshot_id = ?`
3. Update `webcam_snapshots.calculated_rating` with the average
4. This keeps reads fast (no JOIN needed) while maintaining data integrity
