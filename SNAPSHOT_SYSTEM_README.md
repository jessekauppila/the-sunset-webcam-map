# Webcam Snapshot Archive System

## Overview

This system automatically captures and archives snapshots of highly-rated terminator webcams to Firebase Storage, with metadata and user ratings stored in PostgreSQL.

## Features

✅ **Automatic Capture**: Monitors terminator webcams with rating ≥ 4 and captures snapshots every 15 minutes  
✅ **Firebase Storage**: Images stored in Firebase for scalable, cost-effective hosting  
✅ **User Ratings**: Anonymous users can rate snapshots (1-5 stars)  
✅ **Smart Retention**: Automatically deletes snapshots older than 7 days  
✅ **Future-Ready**: AI rating field reserved for future image quality assessment

## Architecture

### Storage Strategy

- **Firebase Storage**: Actual webcam images (JPG format)
- **PostgreSQL (Neon)**: Metadata, ratings, and relationships

### Data Flow

```
Terminator Store (Zustand)
    ↓
useArchiveSnapshots Hook (filters rating ≥ 4, debounces 15min)
    ↓
POST /api/snapshots/capture
    ↓
Download Image → Upload to Firebase → Save Metadata to DB
```

## Database Schema

### `webcam_snapshots` Table

```sql
id                  SERIAL PRIMARY KEY
webcam_id           INTEGER (references webcams)
phase               VARCHAR(10) -- 'sunrise' | 'sunset'
rank                INTEGER
initial_rating      INTEGER NULL -- Manual rating at capture time (may be NULL for AI-first captures)
calculated_rating   DECIMAL(3,2) -- Average of user ratings
ai_rating           DECIMAL(3,2) -- Reserved for AI assessment
firebase_url        TEXT -- Public URL
firebase_path       TEXT -- Storage path
captured_at         TIMESTAMP
created_at          TIMESTAMP
```

### `snapshot_ai_inferences` Table

```sql
id                  BIGSERIAL PRIMARY KEY
snapshot_id         INTEGER (references webcam_snapshots)
model_version       TEXT
raw_score           DOUBLE PRECISION
ai_rating           DECIMAL(3,2) -- Normalized 0-5
scored_at           TIMESTAMPTZ
UNIQUE(snapshot_id, model_version)
```

### `webcam_snapshot_ratings` Table

```sql
id                  SERIAL PRIMARY KEY
snapshot_id         INTEGER (references webcam_snapshots)
user_session_id     VARCHAR(255) -- Anonymous user ID
rating              INTEGER (1-5)
created_at          TIMESTAMP
UNIQUE(snapshot_id, user_session_id) -- One rating per user
```

## File Structure

### Core Libraries

- **`app/lib/firebase.ts`** - Firebase Admin SDK initialization
- **`app/lib/userSession.ts`** - Anonymous user session management (UUID)
- **`app/lib/webcamSnapshot.ts`** - Image download/upload utilities + debouncing

### API Routes

- **`POST /api/snapshots/capture`** - Capture and store snapshots
- **`GET /api/snapshots`** - Fetch snapshots with filtering
- **`POST /api/snapshots/[id]/rate`** - Rate a snapshot
- **`POST /api/snapshots/cleanup`** - Delete snapshots older than 7 days

### Hooks

- **`app/components/hooks/useArchiveSnapshots.ts`** - Automatic capture hook

### Integration

- **`app/page.tsx`** - Calls `useArchiveSnapshots()` to enable auto-archiving

## API Usage

### Capture Snapshots

```typescript
POST /api/snapshots/capture
Body: {
  webcams: WindyWebcam[]
}
Response: {
  success: number,
  failed: number,
  snapshots: Array<{ webcamId, snapshotId, url }>,
  errors: Array<{ webcamId, error }>
}
```

### Fetch Snapshots

```typescript
GET /api/snapshots?webcam_id=123&phase=sunset&min_rating=4.0&limit=20&offset=0
Response: {
  snapshots: Snapshot[],
  total: number,
  limit: number,
  offset: number
}
```

### Rate a Snapshot

```typescript
POST /api/snapshots/[id]/rate
Body: {
  userSessionId: string,
  rating: number (1-5)
}
Response: {
  success: true,
  snapshotId: number,
  calculatedRating: number,
  ratingCount: number
}
```

### Cleanup Old Snapshots

```typescript
POST /api/snapshots/cleanup
Headers: Authorization: Bearer <CRON_SECRET>
Response: {
  success: true,
  deleted: number,
  failed: number,
  errors: string[]
}
```

### Inspect AI Rating Outputs

```typescript
GET /api/debug/ai-ratings?limit=50&secret=<CRON_SECRET>
Response: {
  limit: number,
  webcams: Array<{ id, title, ai_rating, ai_model_version, updated_at }>,
  snapshotAiInferences: Array<{ snapshot_id, model_version, raw_score, ai_rating, scored_at }>
}
```

## Configuration

### Environment Variables

```bash
# Firebase
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_STORAGE_BUCKET=your-project.appspot.com

# Cron Secret
CRON_SECRET=your_random_secret_here
```

### Debouncing

- **Interval**: 15 minutes between captures
- **Implementation**: In-memory timestamp tracking
- **Note**: For distributed systems, consider Redis

## User Session Management

Anonymous users are tracked via UUID stored in localStorage:

```typescript
import { getUserSessionId } from '@/app/lib/userSession';

const sessionId = getUserSessionId(); // Auto-generates if needed
```

## Rating System

### Three Rating Types

1. **Initial Rating** (`initial_rating`)

   - Original manual webcam rating when snapshot was captured
   - May be NULL for AI-first captures without manual seed rating

2. **Calculated Rating** (`calculated_rating`)

   - Average of all user ratings
   - Updated automatically when users rate
   - Enables fast queries (no JOIN needed)

3. **AI Rating** (`ai_rating`)
   - Latest score attached to a snapshot row
   - Used for quick filtering/read paths

4. **AI Inference History** (`snapshot_ai_inferences`)
   - Stores model outputs per snapshot and model version
   - Includes `raw_score` for recalibration and `scored_at` for auditability

### Webcam-level AI Display Fields

- `webcams.ai_rating`: latest score for current webcam preview
- `webcams.ai_model_version`: model version that generated latest score
- These fields support map popup visibility and do not replace snapshot-level history

### Rating Calculation Logic

```typescript
// When user rates:
1. Upsert into webcam_snapshot_ratings (one per user)
2. Calculate AVG(rating) for snapshot_id
3. Update webcam_snapshots.calculated_rating
4. Return new average and rating count
```

## Automatic Cleanup

### 7-Day Retention Policy

- Snapshots older than 7 days are automatically deleted
- Cleanup includes both Firebase Storage and PostgreSQL
- Cascade delete removes related ratings

### Cron Job Setup

Add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/snapshots/cleanup",
      "schedule": "0 2 * * *"
    }
  ]
}
```

## How It Works

### 1. Automatic Capture

```typescript
// In page.tsx
useArchiveSnapshots(); // ← Watches terminator store

// Every 15 minutes, if webcams with rating >= 4 exist:
// 1. Filter webcams by rating >= 4
// 2. Download preview images
// 3. Upload to Firebase Storage
// 4. Save metadata to PostgreSQL
```

### 2. User Ratings

```typescript
// Anonymous user rates a snapshot
const sessionId = getUserSessionId();
await fetch(`/api/snapshots/${snapshotId}/rate`, {
  method: 'POST',
  body: JSON.stringify({ userSessionId: sessionId, rating: 5 }),
});

// Backend automatically:
// - Upserts rating (one per user)
// - Recalculates average
// - Updates snapshot record
```

### 3. Cleanup

```typescript
// Runs daily via cron or manually:
// 1. Find snapshots where captured_at < NOW() - 7 days
// 2. Delete from Firebase Storage
// 3. Delete from PostgreSQL (cascade deletes ratings)
```

## Development

### Testing Locally

```bash
# 1. Set up environment variables
cp .env.local.example .env.local
# (Edit .env.local with your Firebase credentials)

# 2. Run database migrations
psql $DATABASE_URL -f database-schema-snapshots.sql

# 3. Start dev server
npm run dev

# 4. Check browser console for snapshot capture logs
```

### Manual Capture

```bash
curl -X POST http://localhost:3000/api/snapshots/capture \
  -H "Content-Type: application/json" \
  -d '{"webcams": [...]}'
```

### Manual Cleanup

```bash
curl -X POST http://localhost:3000/api/snapshots/cleanup \
  -H "Authorization: Bearer your_cron_secret"
```

## Performance Considerations

### Indexes

The system uses strategic indexes for fast queries:

- `idx_webcam_snapshots_captured_at` - For cleanup queries
- `idx_webcam_snapshots_webcam_id` - For webcam history
- `idx_webcam_snapshots_calculated_rating` - For top-rated queries

### Calculated Ratings

Instead of JOINing on every read, we store the average rating directly:

- **Pros**: Blazing fast reads, simple queries
- **Cons**: Extra write on rating update (acceptable trade-off)

## Future Enhancements

### Planned Features

- [ ] AI-based image quality scoring (`ai_rating` field)
- [ ] UI gallery to browse archived snapshots
- [ ] Filter by date range, location, phase
- [ ] Timelapse generation from historical snapshots
- [ ] Export snapshot collections
- [ ] Social sharing of top-rated snapshots

### Considerations

- Move debounce tracking to Redis for multi-instance deployments
- Implement image compression before upload
- Add WebP format support for smaller file sizes
- Consider CDN for Firebase Storage URLs

## Troubleshooting

### Snapshots Not Being Captured

1. Check browser console for errors
2. Verify webcams have `rating >= 4`
3. Ensure 15 minutes have passed since last capture
4. Check Firebase credentials in `.env.local`

### Firebase Upload Fails

1. Verify Firebase Storage is enabled
2. Check service account permissions (Storage Admin)
3. Ensure `FIREBASE_STORAGE_BUCKET` is correct
4. Check Firebase Storage rules allow server writes

### Database Errors

1. Run `database-schema-snapshots.sql` to create tables
2. Verify `DATABASE_URL` is correct
3. Check that `webcams` table exists (foreign key dependency)

## Cost Estimation

### Firebase Storage

- ~200KB per image
- ~50 webcams captured every 15 minutes
- ~4,800 captures per day
- ~960 MB per day
- With 7-day retention: ~6.7 GB stored
- Firebase pricing: ~$0.026/GB/month = ~$0.17/month

### PostgreSQL

- Metadata: ~500 bytes per snapshot
- ~4,800 snapshots per day × 7 days = ~33,600 records
- ~16 MB total
- Negligible cost in Neon free tier

**Total estimated cost: < $1/month** 🎉

## Security

### Anonymous Users

- No authentication required for viewing
- Session IDs stored in localStorage (client-side only)
- One rating per session ID per snapshot

### Cron Jobs

- Protected by `CRON_SECRET` environment variable
- Only authorized requests can trigger cleanup

### Firebase Storage

- Public read access (images are meant to be shared)
- Write access restricted to server (via service account)

## Support

For issues or questions:

1. Check `FIREBASE_SETUP.md` for setup instructions
2. Review this README for usage examples
3. Check browser console and server logs for errors
4. Verify environment variables are set correctly
