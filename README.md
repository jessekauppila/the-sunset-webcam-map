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

## Terminator Ring Structure

The terminator ring is used in two places:

- **Query ring (cron)**: `app/api/cron/update-windy/route.ts` uses
  `createTerminatorQueryRing` to generate coordinates for Windy API requests.
- **Visualization ring (UI)**: `app/components/Map/hooks/useUpdateTerminatorRing.ts`
  uses `createTerminatorVisualizationRing` to draw the ring, points, and search
  circles.

Shared configuration lives in `app/lib/masterConfig.ts`:

- `TERMINATOR_PRECISION_DEG`: spacing between ring points (controls API call count)
- `TERMINATOR_SUN_ALTITUDE_DEG`: base sun altitude used in radius = `90 - altitude`
- `SEARCH_RADIUS_DEG`: Windy API bounding box radius (degrees)
- `TERMINATOR_RING_OFFSETS_DEG`: offsets applied to the base ring
  (currently `[0, 2 * SEARCH_RADIUS_DEG]` for main + west)

########################################

### Guide To Future Use

## Terminator Ring Layer

useSetWebCam s: "const INITIAL_IMMEDIATE_BATCHES = 17; // or pass this in from caller later"

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

┌─────────────────────────────────────────────────────────────────────┐
│ SWIPE GALLERY SYSTEM │
└─────────────────────────────────────────────────────────────────────┘

1. DATA FLOW
   ───────────────────────────────────────────────────────────────────────

┌──────────────┐ ┌─────────────────┐ ┌──────────────────┐
│ Page.tsx │──────▶│SwipeSnapshot │──────▶│ useSnapshotStore │
│ │ mode │Gallery │ │ │
└──────────────┘ 'swipe'└─────────────────┘ └────────┬─────────┘
fetchUnrated│
│
▼
┌──────────────────┐
│ /api/snapshots │
│ ?unrated_only= │
│ true │
└────────┬─────────┘
│ SQL JOIN
▼
┌──────────────────┐
┌───────▶│ webcam_snapshots │
│ │ JOIN │
│ │ webcams │
│ │ LEFT JOIN │
│ │snapshot_ratings │
│ └──────────────────┘
│
│ Returns: Snapshot[]
│ (sorted by captured_at DESC)
│
▼
┌──────────────────┐
┌───────▶│SnapshotCard │
│ │ (animated card) │
│ └──────────────────┘
│
│ User Swipes Right/Like
│
▼
┌──────────────────────────────────┐
│ handleLike() / handleDislike() │
└──────────────┬───────────────────┘
│
│ POST /api/snapshots/[id]/rate
│ { userSessionId, rating: 5 or 1 }
▼
┌──────────────────────────────────┐
│ webcam_snapshot_ratings table │
│ (INSERT rating) │
└──────────────┬───────────────────┘
│
│ Recalculate avg rating
│ UPDATE webcam_snapshots
│ SET calculated_rating = AVG(...)
▼
┌──────────────────────────────────┐
│ Store updates with optimistic UI │
│ Add to actionHistory for undo │
└──────────────┬───────────────────┘
│
│ Auto-advance to next
│ currentIndex += 1
▼
┌──────────────────────────────────┐
│ Next unrated snapshot loads │
│ (newest remaining) │
└──────────────────────────────────┘

2. COMPONENT HIERARCHY
   ───────────────────────────────────────────────────────────────────────

Page.tsx
│
├─▶ MainViewContainer (mode='swipe')
│ │
│ └─▶ SwipeSnapshotGallery
│ │
│ ├─▶ SnapshotCard (current)
│ │ ├─ Image: snapshot.firebaseUrl
│ │ ├─ Metadata overlay
│ │ └─ Swipe gestures (framer-motion)
│ │
│ ├─▶ SnapshotCard (preview, behind current)
│ │ └─ Shows next card
│ │
│ └─▶ SwipeControls (bottom)
│ ├─ Progress bar (rated/total counts)
│ ├─ Dislike | Skip | Like buttons
│ └─ Undo button (conditional)
│
└─▶ MapMosaicModeToggle
└─ "Rate" button (sets mode='swipe')

3. STATE MANAGEMENT (Zustand)
   ───────────────────────────────────────────────────────────────────────

useSnapshotStore
├─ snapshots: Snapshot[]
│ └─ From API: unrated snapshots sorted DESC
│
├─ currentIndex: number
│ └─ Managed in SwipeSnapshotGallery
│
├─ actionHistory: Array<{
│ snapshotId: number
│ rating: number
│ timestamp: number
│ }>
│ └─ Tracks last action for undo
│
├─ Methods:
│ ├─ fetchUnrated()
│ │ └─ Calls /api/snapshots?unrated_only=true
│ │
│ ├─ setRating(id, rating)
│ │ ├─ Optimistic UI update
│ │ ├─ API call
│ │ ├─ Update actionHistory
│ │ └─ Rollback on error
│ │
│ └─ undoLastRating()
│ ├─ Remove from actionHistory
│ ├─ DELETE /api/snapshots/[id]/rate
│ └─ Remove userRating from state

4. DATABASE SCHEMA
   ───────────────────────────────────────────────────────────────────────

webcam_snapshots
├─ id (PK)
├─ webcam_id (FK → webcams)
├─ phase ('sunrise' | 'sunset')
├─ rank
├─ initial_rating (manual seed rating; nullable for AI-first captures)
├─ calculated_rating (AVG of user ratings)
├─ firebase_url (image URL)
├─ firebase_path
└─ captured_at

webcam_snapshot_ratings
├─ id (PK)
├─ snapshot_id (FK → webcam_snapshots)
├─ user_session_id (anonymous user)
├─ rating (1-5)
└─ created_at

5. KEYBOARD SHORTCUTS
   ───────────────────────────────────────────────────────────────────────

← (Left Arrow) → handleDislike()
→ (Right Arrow) → handleLike()
[Space] → handleSkip()
Cmd/Ctrl + Z → handleUndo()

6. USER SESSION TRACKING
   ───────────────────────────────────────────────────────────────────────

getUserSessionId()
├─ Check localStorage/cookie
├─ Generate UUID if doesn't exist
└─ Store in localStorage + cookie

└─ Used for:
├─ Filtering unrated snapshots (LEFT JOIN with user_session_id)
├─ POSTing ratings
└─ DELETEing ratings (undo)

7. API ENDPOINTS
   ───────────────────────────────────────────────────────────────────────

GET /api/snapshots
├─ ?user_session_id=xxx
├─ ?unrated_only=true
└─ Returns: { snapshots, total, unrated, limit, offset }

POST /api/snapshots/[id]/rate
├─ Body: { userSessionId, rating }
└─ Inserts rating, recalculates avg

DELETE /api/snapshots/[id]/rate
├─ Body: { userSessionId }
└─ Removes rating, recalculates avg

---

## ML Pipeline (Sunset Quality Scoring)

The ML pipeline trains an image classifier that scores webcam snapshots on
a continuous 0.0-1.0 sunset quality scale. Scores drive snapshot archiving,
gallery ranking, and display. The pipeline uses LLM-generated labels
(Gemini Flash) instead of noisy human ratings, and can supplement webcam
data with Creative-Commons-licensed images scraped from Flickr.

**Key scripts:**

- `ml/run_experiment.py` -- single-entrypoint experiment runner (config YAML -> export -> train -> evaluate -> plot)
- `ml/llm_rater.py` -- rates images via vision LLM for continuous 0.0-1.0 quality labels
- `ml/flickr_scraper.py` -- scrapes external sunset images from Flickr to address class imbalance
- `ml/export_onnx_versioned.py` -- exports trained models to ONNX for production deployment

**Full operating guide:** [ml/OPERATING_GUIDE.md](ml/OPERATING_GUIDE.md) --
covers environment setup, experiment workflow, diagnostic interpretation,
LLM rating pipeline, Flickr scraper, ONNX deployment, and historical
findings.

---

## AI Rating V1 Data Ownership

The rating system now separates human votes from model outputs:

- `webcam_snapshot_ratings`: public/manual ratings only (one per user per snapshot)
- `webcam_snapshots.calculated_rating`: aggregate human rating for fast reads
- `snapshot_ai_inferences`: model output history (`raw_score`, normalized `ai_rating`, `model_version`, `scored_at`)
- `webcams.ai_rating` + `webcams.ai_model_version`: legacy latest webcam-level AI score (kept for compatibility)
- `webcams.ai_rating_binary` + `webcams.ai_model_version_binary`: latest binary model score shown in map popup
- `webcams.ai_rating_regression` + `webcams.ai_model_version_regression`: latest regression model score shown in map popup

This keeps user labels clean for future model training while preserving AI scoring history for inspection.

## AI Rating V1 Verification

- Cron summary logs in `/api/cron/update-windy` now include:
  - `total_scored`
  - `above_threshold`
  - `snapshots_captured`
  - `inference_rows_written`
  - `failures`
- Debug endpoint:
  - `GET /api/debug/ai-ratings?limit=50&secret=<CRON_SECRET>`
  - Returns latest webcam AI fields and recent snapshot inference rows

### Runtime AI Scoring Config

- `AI_SCORING_MODE`: `baseline` (default) or `onnx`
- `AI_MODEL_VERSION`: legacy single-model version string (still accepted)
- `AI_ONNX_MODEL_PATH`: legacy single-model ONNX path (still accepted)
- `AI_BINARY_MODEL_VERSION`: binary model version string
- `AI_REGRESSION_MODEL_VERSION`: regression model version string
- `AI_ONNX_BINARY_MODEL_PATH`: binary ONNX path
- `AI_ONNX_REGRESSION_MODEL_PATH`: regression ONNX path
- Threshold and snapshot recency behavior are configured in `app/lib/masterConfig.ts`:
  - `AI_BINARY_DECISION_THRESHOLD`: default positive/negative decision cutoff (`0.5`)
  - `AI_SNAPSHOT_MIN_RAW_SCORE_THRESHOLD`: minimum raw score for snapshot capture (`0.8`)
  - `AI_SNAPSHOT_MIN_RATING_THRESHOLD`: legacy 0-5 threshold kept for rating-scale logic (`4.0`)
