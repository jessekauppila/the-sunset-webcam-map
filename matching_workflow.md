# Matching Workflow Implementation Plan
**Focus**: T8 (Events) → T9 (API) → T15 (UI)

## 1. The Kitchen Metaphor (Refined)

| Component                     | Kitchen Role         | Technical Role    | Status        |
| :---------------------------  | :------------------- | :---------------- | :-----------  |
| **Resume Upload / Job Post**  | **The Customer**     | **Trigger**       | Exists        |
| **Match Events Service (T8)** | **The Ticket Wheel** | **Queue Manager** | *To Be Built* |
| **The Event**                 | **The Ticket**       | **Database Row**  | *To Be Built* |
| **Vector Embeddings**         | **The Ingredients**  | **Data Layer**    | Exists (DB)   |
| **Matching Utils (T7)**       | **The Recipe**       | **Logic Layer**   | *To Be Built* |
| **Matching Worker (T10)**     | **The Chef**         | **The Processor** | *To Be Built* |
| **Matches API (T9)**          | **The Waiter**       | **Read-Only API** | *To Be Built* |
| **Matches Page (T15)**        | **The Table**        | **UI Display**    | *To Be Built* |

### Architecture Note: "Asynchronous Event-Driven"
This process is technically called an **Asynchronous Event-Driven Architecture** (specifically the **Producer-Consumer** pattern).
*   **Producer**: The User App (creates the ticket).
*   **Queue**: The `match_events` table.
*   **Consumer**: The Matching Worker (picks up the ticket and cooks).

**Where do the Vectors go?**
The "Abstracted Vector Layers" are the **Ingredients** stored in your database (`candidate_bullets.embedding`, etc.).
*   **Storage**: They live in Supabase (pgvector).
*   **Calculation**: The **Chef (T10)** pulls these vectors, uses the **Recipe (T7)** to calculate cosine similarity (the "taste test"), and produces the final **Match Score**.

## 2. Data Flow & Mocking Strategy (How to Test Without T10)

You are correct: **T9 (API) depends on the database rows that T10 (Worker) creates.**
To test T9 and T15 *before* T10 is built, we must **Mock the Chef** by manually inserting the "cooked food" (Match Rows) into the database.

### Step 1: The Ticket (T8 - Match Events)
*   **Input**: `createMatchEvent('resume_ready', 'user_123')`
*   **Table**: `match_events`
*   **Columns**:
    *   `id`: UUID (Auto)
    *   `event_type`: 'resume_ready'
    *   `entity_id`: 'user_123'
    *   `status`: 'pending'
*   **Mocking (SQL)**:
    ```sql
    INSERT INTO match_events (event_type, entity_id, status)
    VALUES ('resume_ready', 'user_123', 'pending');
    ```

### Step 2: The Meal (T10 - Worker Output)
*   **Input**: Reads `match_events`, calculates vectors.
*   **Table**: `job_candidate_matches`
*   **Columns** (This is what T9 reads!):
    *   `job_post_id`: UUID (The Job)
    *   `candidate_user_id`: UUID (The Candidate)
    *   `match_score`: 0.95 (Float)
    *   `band`: 'top'
    *   `top_skills`: `['React', 'Node.js']` (JSONB/Array)
    *   `reasons`: `['Great experience', 'Local']` (JSONB/Array)


*   **Mocking (SQL)**: *Run this to test T9/T15 without T10*
    ```sql
    -- Replace with REAL IDs from your database
    INSERT INTO job_candidate_matches 
    (job_post_id, candidate_user_id, match_score, band, top_skills, reasons, status)
    VALUES 
    ('JOB_UUID_HERE', 'USER_UUID_HERE', 0.95, 'top', '["React", "Node"]', '["Perfect Match"]', 'new');
    ```

### Step 3: The Service (T9 - API)
*   **Input**: `GET /api/matches/employer/[jobId]`
*   **Action**: `SELECT * FROM job_candidate_matches WHERE job_post_id = [jobId]`
*   **Output**: JSON Array of matches.

---

## 3. Revised Task Breakdown

### T8: Create Match Events Service (Server-Side)
**Correction**: This service must be **Server-Side** because it is primarily used by the **Matching Worker** (Node.js) to fetch pending jobs.

**Prompt**:
```typescript
Create lib/services/match-events.ts as a Server-Side Domain Service.

Requirements:
1. Use `createServerSupabaseClient` (or `getAdminClient` for workers).
2. Do NOT use browser-only Supabase clients.

Functions:
1. createMatchEvent(eventType: 'resume_ready' | 'job_post_published', entityId: string): Promise<string>
   - Inserts into `match_events` table.
   - Default status: 'pending'.
   - Returns event_id.

2. getPendingMatchEvents(limit: number = 10): Promise<MatchEvent[]>
   - Selects where status = 'pending'.
   - Ordered by created_at ASC.
   - Used by the Worker to pull tickets.

3. updateMatchEventStatus(eventId: string, status: 'processing' | 'completed' | 'failed', error?: string): Promise<void>
   - Updates status and `processed_at`.
   - If failed, increments `retry_count`.

Deliverable: `lib/services/match-events.ts` + `tests/services/match-events.test.ts`
```

### T9: Create Matches API (The Reader)
The API reads the *results* of the matching process.

**Prompt**:
```typescript
Create app/api/matches/employer/[jobId]/route.ts.

Flow:
1. Validate User (Employer) owns the Job.
2. Fetch matches from `job_candidate_matches` table.
   - This table is populated by the Worker (T10) *after* it processes the Event (T8).
3. Join with `account_unlocked_candidates` to see if they are unlocked.
4. Return top 10 matches with "Why This Matches" explanations.

Deliverable: `app/api/matches/employer/[jobId]/route.ts` + tests
```

### T15: Matches Page (The Viewer)
The UI displays the results.

**Prompt**:
```typescript
Create app/employer/jobs/[jobId]/matches/page.tsx.

Features:
1. Fetch matches using the API (T9).
2. Display `MatchCard` components.
3. Handle "Unlock" interactions (calling the Unlock API).
4. Auto-Refresh: If matches are empty, poll `getEventStatus` (via a new API endpoint) to see if matching is still "processing".

Deliverable: `app/employer/jobs/[jobId]/matches/page.tsx`

## 4. Detailed Testing Plan

This section outlines how to verify the matching workflow, covering the Event Service (T8), API (T9), and UI (T15).

### T8: Match Events Service (The Ticket Wheel)
**Goal**: Verify that events are created, queued, and status-updated correctly.

#### Automated Tests
*   **File**: `tests/services/match-events.test.ts`
*   **Coverage**: 8+ test cases
*   **Key Scenarios**:
    *   `createMatchEvent` returns a valid UUID.
    *   `getPendingMatchEvents` returns events ordered by `created_at` ASC.
    *   `updateMatchEventStatus` transitions 'pending' -> 'processing' -> 'completed'.
    *   Error handling increments `retry_count`.

#### Manual Verification (Browser Console)
1.  **Create Event**: Call `createMatchEvent('resume_ready', 'user_123')`.
    *   *Check*: Returns an ID?
    *   *SQL Check*: `SELECT * FROM match_events WHERE entity_id='user_123';` (Status should be 'pending').
2.  **Fetch Pending**: Call `getPendingMatchEvents()`.
    *   *Check*: Returns the event created above?
3.  **Update Status**: Call `updateMatchEventStatus(eventId, 'completed')`.
    *   *SQL Check*: Status is now 'completed'?

---

### T9: Matches API (The Waiter)
**Goal**: Verify the API correctly serves "cooked" matches from the database.

#### Automated Tests
*   **File**: `tests/api/matches.test.ts`
*   **Coverage**: 6+ test cases
*   **Key Scenarios**:
    *   Returns 200 OK with array of matches for valid Job ID.
    *   Returns 403 Forbidden if user doesn't own the job.
    *   Returns 404 Not Found for invalid Job ID.
    *   `unlocked` boolean is correctly set based on `account_unlocked_candidates`.
    *   Results limited to 10 items.

#### Manual Verification (Postman/cURL)
*Prerequisite*: Run the "Mocking (SQL)" script from Section 2 to insert test matches.

1.  **Happy Path**: `GET /api/matches/employer/{jobId}`
    *   *Check*: JSON response contains the mocked matches.
    *   *Check*: `match_score` and `band` match the SQL data.
2.  **Access Control**: Try with a different user's token.
    *   *Check*: Returns 403.
3.  **Unlock Status**: Manually insert a record into `account_unlocked_candidates`.
    *   *Check*: The specific match now returns `unlocked: true`.

---

### T15: Matches Page (The Table)
**Goal**: Verify the UI displays matches and handles the unlock flow.

#### Automated Tests
*   **File**: `tests/pages/matches.test.ts`
*   **Coverage**: 5+ test cases
*   **Key Scenarios**:
    *   Renders list of `MatchCard` components.
    *   "Unlock" button opens the `UnlockModal`.
    *   Confirming unlock calls the consume API and refreshes the list.
    *   Empty state displays correctly when API returns [].

#### Manual Verification (Browser)
1.  **View Matches**: Navigate to `/employer/jobs/{jobId}/matches`.
    *   *Check*: Cards appear with correct data (Score, Band, Skills).
2.  **Unlock Flow**:
    *   Click "Unlock to View" on a locked candidate.
    *   *Check*: Modal appears with credit balance.
    *   Click "Confirm".
    *   *Check*: Modal closes, card updates to "Unlocked" (Green badge).
    *   *Check*: "View Profile" button is now visible.
3.  **Empty State**: Navigate to a job with no matches.
    *   *Check*: Friendly "No matches yet" message appears.
```
