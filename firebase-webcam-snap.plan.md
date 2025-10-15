# Firebase Webcam Snapshot System - Updated Plan

## Architecture

**Storage Strategy:**

- Firebase Storage: Store actual webcam images
- Neon PostgreSQL: Store metadata + ratings

**Trigger:** Zustand `useTerminatorStore` changes
**Filter:** Only webcams with `rating >= 4` (4 or 5 stars)
**Debouncing:** 15 minutes between captures
**Retention:** 7-day rolling window (auto-cleanup)
**User Tracking:** Anonymous session/cookie ID (no authentication required)

## Implementation Steps

### 1. Firebase Setup

- Install Firebase packages: `firebase`, `firebase-admin`
- Create Firebase project configuration file at `app/lib/firebase.ts`
- Add Firebase credentials to environment variables (`.env.local`)
- Initialize Firebase Admin SDK for server-side operations

### 2. Database Schema

**Table: `webcam_snapshots`**

```sql
CREATE TABLE webcam_snapshots (
  id SERIAL PRIMARY KEY,
  webcam_id INTEGER REFERENCES webcams(id),
  phase VARCHAR(10) NOT NULL,  -- 'sunrise' or 'sunset'
  rank INTEGER,
  initial_rating INTEGER NOT NULL,  -- Original webcam rating at capture time (4 or 5)
  calculated_rating DECIMAL(3,2),  -- Average of user ratings (updated when users rate)
  ai_rating DECIMAL(3,2),  -- Future: AI-generated rating based on image analysis
  firebase_url TEXT NOT NULL,  -- Firebase Storage public URL
  firebase_path TEXT NOT NULL,  -- Path in Firebase Storage
  captured_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_webcam_snapshots_captured_at ON webcam_snapshots(captured_at);
CREATE INDEX idx_webcam_snapshots_webcam_id ON webcam_snapshots(webcam_id);
CREATE INDEX idx_webcam_snapshots_calculated_rating ON webcam_snapshots(calculated_rating);
```

**Table: `webcam_snapshot_ratings`**

```sql
CREATE TABLE webcam_snapshot_ratings (
  id SERIAL PRIMARY KEY,
  snapshot_id INTEGER REFERENCES webcam_snapshots(id) ON DELETE CASCADE,
  user_session_id VARCHAR(255) NOT NULL,  -- Anonymous user identifier
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(snapshot_id, user_session_id)  -- One rating per user per snapshot
);

CREATE INDEX idx_snapshot_ratings_snapshot_id ON webcam_snapshot_ratings(snapshot_id);
CREATE INDEX idx_snapshot_ratings_user_session ON webcam_snapshot_ratings(user_session_id);
```

### 3. User Session Management

**File:** `app/lib/userSession.ts`

- Generate UUID for anonymous users on first visit
- Store in localStorage + HTTP-only cookie
- Utility functions to get/set session ID

### 4. Core Capture Logic

**File:** `app/lib/webcamSnapshot.ts`

- Function to download image from webcam URL
- Function to upload image to Firebase Storage
- Function to save metadata to PostgreSQL
- Debouncing tracker using in-memory timestamp

### 5. Snapshot Archive Hook

**File:** `app/components/hooks/useArchiveSnapshots.ts` (new)

- Custom hook that watches terminator store `combined` webcams
- Filter webcams with `rating >= 4` (4 or 5 stars)
- Check 15-minute debounce threshold
- Trigger snapshot capture via API route
- Called from `page.tsx` to keep side effects out of store

### 6. API Routes

**File:** `app/api/snapshots/capture/route.ts` (POST)

- Accept array of webcam IDs to capture
- Download images from webcam preview URLs
- Upload to Firebase Storage (path: `snapshots/{webcam_id}/{timestamp}.jpg`)
- Store metadata in `webcam_snapshots` table with initial_rating

**File:** `app/api/snapshots/[id]/rate/route.ts` (POST)

- Accept snapshot ID, user session ID, and rating (1-5)
- Upsert rating in `webcam_snapshot_ratings` table
- Recalculate average rating
- Update `calculated_rating` in `webcam_snapshots` table

**File:** `app/api/snapshots/cleanup/route.ts` (GET/POST)

- Delete snapshots older than 7 days from PostgreSQL
- Delete corresponding images from Firebase Storage
- Cascade will auto-delete related ratings
- Can be called manually or via cron job

**File:** `app/api/snapshots/route.ts` (GET)

- Fetch snapshots with ratings
- Support filtering by date, webcam_id, phase, calculated_rating
- Include rating count and average

### 7. Environment Variables

Add to `.env.local`:

```
FIREBASE_PROJECT_ID=
FIREBASE_PRIVATE_KEY=
FIREBASE_CLIENT_EMAIL=
FIREBASE_STORAGE_BUCKET=
```

### 8. Optional: Cron Job for Cleanup

**File:** `vercel.json`

- Add cron job to run cleanup daily
- Alternative: trigger cleanup on each capture

## Key Files to Modify/Create

- `app/lib/firebase.ts` (new)
- `app/lib/webcamSnapshot.ts` (new)
- `app/lib/userSession.ts` (new)
- `app/components/hooks/useArchiveSnapshots.ts` (new)
- `app/page.tsx` (modify - call useArchiveSnapshots hook)
- `app/api/snapshots/capture/route.ts` (new)
- `app/api/snapshots/[id]/rate/route.ts` (new)
- `app/api/snapshots/route.ts` (new)
- `app/api/snapshots/cleanup/route.ts` (new)
- `.env.local` (add Firebase config)
- `package.json` (add dependencies)

## Dependencies

- `firebase` - Firebase client SDK
- `firebase-admin` - Firebase Admin SDK (server-side)
- `uuid` - Generate session IDs

## Rating Calculation Logic

When a user rates a snapshot:

1. Upsert rating in `webcam_snapshot_ratings` (one per user per snapshot)
2. Calculate average: `SELECT AVG(rating) FROM webcam_snapshot_ratings WHERE snapshot_id = ?`
3. Update `webcam_snapshots.calculated_rating` with the average
4. This keeps reads fast (no JOIN needed) while maintaining data integrity

## To-dos

- [ ] Install Firebase packages and create Firebase configuration
- [ ] Create user session management utilities
- [ ] Create webcam_snapshots table in Neon PostgreSQL
- [ ] Create webcam_snapshot_ratings table in Neon PostgreSQL
- [ ] Create webcam snapshot utility library with download/upload functions
- [ ] Create API route for capturing and storing snapshots
- [ ] Create API route for rating snapshots
- [ ] Create API route for fetching snapshots
- [ ] Create useArchiveSnapshots hook to trigger captures with debouncing (rating >= 4)
- [ ] Integrate useArchiveSnapshots into page.tsx
- [ ] Create cleanup API route for 7-day retention
- [ ] Optional: Add cron job for automatic cleanup
