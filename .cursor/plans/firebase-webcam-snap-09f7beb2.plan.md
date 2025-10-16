<!-- 09f7beb2-bc96-4ffb-8896-3b1679c26095 97f0d301-3e80-4c42-984a-4c05926c8fee -->
# Snapshot Rating Console - Updated Plan

## Goal

Create a UI for users to browse and rate archived webcam snapshots, with proper state management and reusable data structures.

## Type System

### 1. New Snapshot Type

**File:** `app/lib/types.ts`

```typescript
export interface SnapshotMetadata {
  id: number;
  webcamId: number;
  phase: 'sunrise' | 'sunset';
  rank: number | null;
  initialRating: number;  // Rating when captured
  calculatedRating: number | null;  // Average of user ratings
  aiRating: number | null;  // Future AI rating
  firebaseUrl: string;
  firebasePath: string;
  capturedAt: string;
  createdAt: string;
  ratingCount: number;  // Number of user ratings
  userRating?: number;  // Current user's rating (if rated)
}

// Snapshot = WindyWebcam data + snapshot metadata
export interface Snapshot extends WindyWebcam {
  snapshot: SnapshotMetadata;
}
```

## State Management

### 2. Snapshot Store

**File:** `app/store/useSnapshotStore.ts`

**Follows same pattern as `useAllWebcamsStore.ts`:**

```typescript
interface SnapshotStore {
  snapshots: Snapshot[];
  loading: boolean;
  error?: string;
  
  // Fetch snapshots with filters
  fetchSnapshots: (filters?: SnapshotFilters) => Promise<void>;
  
  // Update user rating for a snapshot
  setRating: (snapshotId: number, rating: number) => Promise<void>;
  
  // Clear snapshots
  clearSnapshots: () => void;
}

interface SnapshotFilters {
  unrated?: boolean;  // Only show unrated by current user
  limit?: number;
  offset?: number;
  minRating?: number;
}
```

### 3. Snapshot Loading Hook

**File:** `app/store/useLoadSnapshots.ts`

**Similar to `useLoadTerminatorWebcams.ts`:**

- Uses SWR for auto-refresh
- Fetches from `/api/snapshots`
- Automatically loads snapshots on mount
- Updates Zustand store

## Data Fetching & Merging

### 4. Enhanced Snapshots API

**File:** `app/api/snapshots/route.ts` (modify existing)

**Add query parameter:** `?user_session_id=xxx`

**Enhanced response:**

```typescript
{
  snapshots: [{
    // Snapshot metadata
    id, webcamId, phase, rank,
    initialRating, calculatedRating, aiRating,
    firebaseUrl, capturedAt, ratingCount,
    
    // Add user's rating if session provided
    userRating: 4  // or null if not rated
  }],
  total: 100
}
```

**Join with webcams table to get full webcam data:**

```sql
SELECT 
  s.*, 
  w.*,  -- All webcam columns
  ur.rating as user_rating  -- User's rating if exists
FROM webcam_snapshots s
JOIN webcams w ON w.id = s.webcam_id
LEFT JOIN webcam_snapshot_ratings ur ON ur.snapshot_id = s.id 
  AND ur.user_session_id = $user_session_id
```

### 5. Transform Utility

**File:** `app/lib/snapshotTransform.ts`

```typescript
// Transform API response to Snapshot type
export function transformSnapshot(row: any): Snapshot {
  return {
    // WindyWebcam fields
    webcamId: row.webcam_id,
    title: row.title,
    location: { ... },
    images: row.images,
    // ... all other WindyWebcam fields
    
    // Snapshot metadata
    snapshot: {
      id: row.snapshot_id,
      webcamId: row.webcam_id,
      phase: row.phase,
      rank: row.rank,
      initialRating: row.initial_rating,
      calculatedRating: row.calculated_rating,
      aiRating: row.ai_rating,
      firebaseUrl: row.firebase_url,
      firebasePath: row.firebase_path,
      capturedAt: row.captured_at,
      createdAt: row.created_at,
      ratingCount: row.rating_count,
      userRating: row.user_rating,
    }
  };
}
```

## Rating System

### 6. Unified Rating Pattern

**File:** `app/lib/rating.ts`

**Two functions following same pattern as webcam rating:**

```typescript
// Rate a webcam (existing pattern)
export async function rateWebcam(webcamId: number, rating: number) {
  const response = await fetch(`/api/webcams/${webcamId}/rating`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating }),
  });
  return response.json();
}

// Rate a snapshot (new, similar pattern)
export async function rateSnapshot(snapshotId: number, rating: number) {
  const userSessionId = getUserSessionId();
  
  const response = await fetch(`/api/snapshots/${snapshotId}/rate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userSessionId, rating }),
  });
  return response.json();
}
```

**Store implementation follows webcam pattern:**

```typescript
// In useSnapshotStore.ts
setRating: async (snapshotId, rating) => {
  set({ loading: true });
  try {
    const result = await rateSnapshot(snapshotId, rating);
    
    // Update local state
    set((state) => ({
      snapshots: state.snapshots.map(s =>
        s.snapshot.id === snapshotId
          ? {
              ...s,
              snapshot: {
                ...s.snapshot,
                userRating: rating,
                calculatedRating: result.calculatedRating,
                ratingCount: result.ratingCount,
              }
            }
          : s
      ),
      loading: false,
    }));
  } catch (error) {
    set({ error: 'Failed to update rating', loading: false });
  }
}
```

## UI Components

### 7. SnapshotConsole Component

**File:** `app/components/SnapshotConsole.tsx`

**Same structure as WebcamConsole but for Snapshots:**

```typescript
export function SnapshotConsole({ 
  snapshots, 
  title 
}: { 
  snapshots: Snapshot[]; 
  title: string; 
}) {
  const setRating = useSnapshotStore((s) => s.setRating);
  const [updatingSnapshots, setUpdatingSnapshots] = useState<Set<number>>(new Set());
  
  // Same rating handler pattern as WebcamConsole
  const handleRatingChange = async (snapshotId: number, rating: number) => {
    setUpdatingSnapshots(prev => new Set(prev).add(snapshotId));
    try {
      await setRating(snapshotId, rating);
    } finally {
      setUpdatingSnapshots(prev => {
        const newSet = new Set(prev);
        newSet.delete(snapshotId);
        return newSet;
      });
    }
  };
  
  // Render cards...
}
```

**Card shows:**

- Firebase snapshot image (not Windy preview)
- All WindyWebcam metadata (title, location, etc.)
- Snapshot metadata (phase, rank, captured time)
- Initial rating (stars)
- Calculated rating (stars) + count
- User's rating (if exists)
- Rating controls (1-5 buttons, same as WebcamConsole)

### 8. Consolidated Styling

**File:** `app/globals.css`

Add utility classes for both WebcamConsole and SnapshotConsole:

```css
.console-container { @apply p-4 bg-gray-200 rounded-lg; }
.console-grid { @apply grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3; }
.console-card { @apply bg-white p-3 rounded border; }
.console-card-image { @apply w-full h-24 object-contain rounded; }
.console-card-title { @apply font-semibold text-gray-900 text-sm mb-1; }
.rating-controls { @apply mt-2 mb-2; }
.rating-button { @apply w-6 h-6 text-xs rounded border cursor-pointer; }
.rating-button-active { @apply bg-yellow-400 border-yellow-500 text-yellow-900; }
.rating-button-inactive { @apply bg-gray-100 border-gray-300 text-gray-600 hover:bg-gray-200; }
.rating-button-disabled { @apply opacity-50 cursor-not-allowed; }
```

### 9. Update WebcamConsole

**File:** `app/components/WebcamConsole.tsx`

Replace inline Tailwind classes with new utility classes for consistency.

### 10. Add Snapshot Tab

**File:** `app/page.tsx`

```typescript
import { useLoadSnapshots } from '@/app/store/useLoadSnapshots';
import { useSnapshotStore } from '@/app/store/useSnapshotStore';
import { SnapshotConsole } from './components/SnapshotConsole';

// In component:
useLoadSnapshots();  // Auto-fetch snapshots
const snapshots = useSnapshotStore((s) => s.snapshots);

// Add 3rd tab in Tabs component
<Tab label="Snapshot Archive" />

// Add tab content
{tabValue === 2 && (
  <Box>
    <SnapshotConsole
      snapshots={snapshots}
      title="Snapshot Archive"
    />
  </Box>
)}
```

## Implementation Order

1. **Add Snapshot types to types.ts**
2. **Enhance /api/snapshots to join webcams table and include user ratings**
3. **Create transform utility for API response**
4. **Create Zustand snapshot store**
5. **Create useLoadSnapshots hook**
6. **Create unified rating utilities**
7. **Add consolidated CSS classes**
8. **Update WebcamConsole to use new classes**
9. **Create SnapshotConsole component**
10. **Add Snapshot Archive tab to page.tsx**

## Key Differences from Original Plan

✅ **Zustand store** - Centralized state management

✅ **Snapshot type** - Extends WindyWebcam with snapshot metadata

✅ **Unified rating pattern** - Follows existing webcam rating approach

✅ **Data merging in API** - Server-side JOIN instead of client-side merging

✅ **Reusable snapshots** - Can use Snapshot[] anywhere in the app

✅ **User ratings included** - API response includes current user's rating

## Success Criteria

✅ Snapshot type extends WindyWebcam with metadata

✅ Zustand store manages snapshot state

✅ API returns merged snapshot + webcam data

✅ Rating follows same pattern as webcam rating

✅ SnapshotConsole reuses WebcamConsole patterns

✅ Styling is consolidated and maintainable

✅ Snapshots can be used throughout the app

### To-dos

- [ ] Consolidate console styling into global.css and update WebcamConsole
- [ ] Create useSnapshots hook to fetch snapshots from API
- [ ] Create snapshot rating utilities with user session tracking
- [ ] Create SnapshotConsole component with grid layout and rating controls
- [ ] Add Snapshot Archive tab to page.tsx drawer
- [ ] Test end-to-end snapshot rating workflow