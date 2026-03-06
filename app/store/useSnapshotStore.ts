'use client';

import { create } from 'zustand';
import type { Snapshot } from '../lib/types';
import { getUserSessionId } from '../lib/userSession';

type State = {
  // Shared state
  loading: boolean;
  error?: string;

  // Archive state (offset-based pagination)
  archive: Snapshot[];
  archivePage: number;
  archivePageSize: number;
  archiveTotal: number;

  // Curated state (exclusion-based pagination)
  curated: Snapshot[];
  curatedPage: number;
  curatedPageSize: number;
  curatedSeen: Set<number>;
  curatedTotal: number;

  // Unrated queue state (exclusion-based refill for rapid labeling)
  unrated: Snapshot[];
  unratedPageSize: number;
  unratedSeen: Set<number>;
  unratedTotal: number;
  unratedArchiveTotal: number;
  unratedRatedTotal: number;

  // Legacy support (deprecated - kept for backward compatibility)
  snapshots: Snapshot[];
  setSnapshots: (snapshots: Snapshot[]) => void;
  clearSnapshots: () => void;

  // Shared actions
  setLoading: (v: boolean) => void;
  setError: (e?: string) => void;

  // Page management
  setPageSize: (
    mode: 'archive' | 'curated' | 'unrated',
    size: number
  ) => void;
  goToPage: (
    mode: 'archive' | 'curated' | 'unrated',
    page: number
  ) => void;
  nextPage: (mode: 'archive' | 'curated' | 'unrated') => void;
  prevPage: (mode: 'archive' | 'curated' | 'unrated') => void;

  // Fetch operations
  fetchMore: (
    mode: 'archive' | 'curated' | 'unrated'
  ) => Promise<void>;

  // Reset operations
  resetArchive: () => void;
  resetCurated: () => void;
  resetUnrated: () => void;

  // Unrated queue operations
  removeUnratedSnapshot: (snapshotId: number) => void;
  insertUnratedSnapshot: (snapshot: Snapshot, index?: number) => void;

  // Rate a snapshot
  setRating: (snapshotId: number, rating: number) => Promise<void>;
};

// Load curatedSeen from sessionStorage
const loadCuratedSeen = (): Set<number> => {
  if (typeof window === 'undefined') return new Set();
  try {
    const stored = sessionStorage.getItem('snapshot_curated_seen');
    if (stored) {
      const ids = JSON.parse(stored) as number[];
      return new Set(ids);
    }
  } catch (error) {
    console.error(
      'Error loading curated seen from sessionStorage:',
      error
    );
  }
  return new Set();
};

// Save curatedSeen to sessionStorage
const saveCuratedSeen = (seen: Set<number>) => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(
      'snapshot_curated_seen',
      JSON.stringify([...seen])
    );
  } catch (error) {
    console.error(
      'Error saving curated seen to sessionStorage:',
      error
    );
  }
};

const UNRATED_SEEN_STORAGE_KEY = 'snapshot_unrated_seen';

const loadUnratedSeen = (): Set<number> => {
  if (typeof window === 'undefined') return new Set();
  try {
    const stored = sessionStorage.getItem(UNRATED_SEEN_STORAGE_KEY);
    if (stored) {
      const ids = JSON.parse(stored) as number[];
      return new Set(ids);
    }
  } catch (error) {
    console.error(
      'Error loading unrated seen from sessionStorage:',
      error
    );
  }
  return new Set();
};

const saveUnratedSeen = (seen: Set<number>) => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(
      UNRATED_SEEN_STORAGE_KEY,
      JSON.stringify([...seen])
    );
  } catch (error) {
    console.error(
      'Error saving unrated seen to sessionStorage:',
      error
    );
  }
};

export const useSnapshotStore = create<State>()((set, get) => ({
  // Shared state
  loading: false,
  error: undefined,

  // Archive state
  archive: [],
  archivePage: 1,
  archivePageSize: 10,
  archiveTotal: 0,

  // Curated state
  curated: [],
  curatedPage: 1,
  curatedPageSize: 10,
  curatedSeen: loadCuratedSeen(),
  curatedTotal: 0,

  // Unrated queue state
  unrated: [],
  unratedPageSize: 100,
  unratedSeen: loadUnratedSeen(),
  unratedTotal: 0,
  unratedArchiveTotal: 0,
  unratedRatedTotal: 0,

  // Legacy support
  snapshots: [],
  setSnapshots: (snapshots) => set({ snapshots }),
  clearSnapshots: () => set({ snapshots: [] }),

  // Shared actions
  setLoading: (v) => set({ loading: v }),
  setError: (e) => set({ error: e }),

  // Page management
  setPageSize: (mode, size) => {
    if (mode === 'archive') {
      set({ archivePageSize: size });
    } else if (mode === 'curated') {
      set({ curatedPageSize: size });
    } else {
      set({ unratedPageSize: size });
    }
  },

  goToPage: (mode, page) => {
    if (mode === 'archive') {
      const { archive, archivePageSize, archiveTotal } = get();
      const totalPages = Math.ceil(archiveTotal / archivePageSize);
      const targetPage = Math.max(1, Math.min(page, totalPages));
      set({ archivePage: targetPage });

      // If page is beyond current buffer, fetch more
      const bufferEndPage = Math.floor(
        archive.length / archivePageSize
      );
      if (targetPage > bufferEndPage) {
        get().fetchMore('archive');
      }
    } else if (mode === 'curated') {
      set({ curatedPage: page });

      // Check if we need to fetch more for curated view
      const { curated, curatedPageSize } = get();
      const bufferEndPage = Math.floor(
        curated.length / curatedPageSize
      );
      if (page > bufferEndPage) {
        get().fetchMore('curated');
      }
    } else {
      // Unrated queue uses queue semantics, not page navigation.
      // Keep this a no-op for API parity with shared controls.
      return;
    }
  },

  nextPage: (mode) => {
    const { goToPage, archivePage, curatedPage } = get();
    const currentPage =
      mode === 'archive' ? archivePage : curatedPage;
    goToPage(mode, currentPage + 1);
  },

  prevPage: (mode) => {
    const { goToPage, archivePage, curatedPage } = get();
    const currentPage =
      mode === 'archive' ? archivePage : curatedPage;
    goToPage(mode, currentPage - 1);
  },

  // Reset operations
  resetArchive: () =>
    set({
      archive: [],
      archivePage: 1,
      archiveTotal: 0,
    }),

  resetCurated: () => {
    set({
      curated: [],
      curatedPage: 1,
      curatedTotal: 0,
      curatedSeen: new Set(),
    });
    saveCuratedSeen(new Set());
  },

  resetUnrated: () => {
    set({
      unrated: [],
      unratedTotal: 0,
      unratedArchiveTotal: 0,
      unratedRatedTotal: 0,
      unratedSeen: new Set(),
    });
    saveUnratedSeen(new Set());
  },

  removeUnratedSnapshot: (snapshotId) => {
    set((state) => ({
      unrated: state.unrated.filter(
        (entry) => entry?.snapshot?.id !== snapshotId
      ),
      unratedTotal: Math.max(0, state.unratedTotal - 1),
    }));
  },

  insertUnratedSnapshot: (snapshot, index) => {
    set((state) => {
      const existingIndex = state.unrated.findIndex(
        (entry) => entry?.snapshot?.id === snapshot.snapshot.id
      );
      if (existingIndex !== -1) {
        return state;
      }

      const targetIndex =
        typeof index === 'number'
          ? Math.max(0, Math.min(index, state.unrated.length))
          : 0;
      const next = [...state.unrated];
      next.splice(targetIndex, 0, snapshot);
      return {
        unrated: next,
        unratedTotal: state.unratedTotal + 1,
      };
    });
  },

  // Fetch operations
  fetchMore: async (mode) => {
    const state = get();
    set({ loading: true, error: undefined });

    try {
      const userSessionId = getUserSessionId();
      let url = '';

      if (mode === 'archive') {
        const { archivePage, archivePageSize } = state;
        const offset = (archivePage - 1) * archivePageSize;
        url = `/api/snapshots?mode=archive&limit=${archivePageSize}&offset=${offset}&user_session_id=${userSessionId}`;
      } else if (mode === 'curated') {
        const { curatedSeen } = state;
        const seenIdsArray = [...curatedSeen];
        const excludeIds =
          seenIdsArray.length > 0 ? seenIdsArray.join(',') : '';
        url = `/api/snapshots?mode=curated&limit=100&user_session_id=${userSessionId}${
          excludeIds ? `&exclude_ids=${excludeIds}` : ''
        }`;
      } else {
        const { unratedSeen, unratedPageSize } = state;
        const seenIdsArray = [...unratedSeen];
        const excludeIds =
          seenIdsArray.length > 0 ? seenIdsArray.join(',') : '';
        url = `/api/snapshots?mode=archive&unrated_only=true&limit=${unratedPageSize}&user_session_id=${userSessionId}${
          excludeIds ? `&exclude_ids=${excludeIds}` : ''
        }`;
      }

      const response = await fetch(url);
      if (!response.ok) {
        const errorText = await response.text();
        console.error('API error response:', errorText);
        throw new Error(
          `Failed to fetch snapshots: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();

      if (mode === 'archive') {
        // Archive mode: replace the current page's snapshots
        const { archive, archivePage, archivePageSize } = get();
        const startIdx = (archivePage - 1) * archivePageSize;
        //const endIdx = startIdx + archivePageSize;

        // Expand archive array if needed
        const newArchive = [...archive];
        for (
          let i = startIdx;
          i < startIdx + data.snapshots.length;
          i++
        ) {
          newArchive[i] = data.snapshots[i - startIdx];
        }

        set({
          archive: newArchive,
          archiveTotal: data.total,
          loading: false,
        });
      } else if (mode === 'curated') {
        // Curated mode: append to buffer and update seen set
        const { curated, curatedSeen } = get();
        const newSeen = new Set(curatedSeen);
        (data.returnedIds as number[]).forEach((id) =>
          newSeen.add(id)
        );

        // Deduplicate: filter out snapshots that already exist in curated array
        const existingIds = new Set(
          curated
            .map((s) => s?.snapshot?.id)
            .filter((id): id is number => id !== undefined)
        );
        const newSnapshots = (data.snapshots as Snapshot[]).filter(
          (snapshot: Snapshot) =>
            !existingIds.has(snapshot.snapshot.id)
        );

        set({
          curated: [...curated, ...newSnapshots],
          curatedSeen: newSeen,
          curatedTotal: data.total,
          loading: false,
        });
        saveCuratedSeen(newSeen);
      } else {
        // Unrated mode: append queue and update seen set
        const { unrated, unratedSeen } = get();
        const newSeen = new Set(unratedSeen);
        (data.returnedIds as number[]).forEach((id) =>
          newSeen.add(id)
        );

        const existingIds = new Set(
          unrated
            .map((s) => s?.snapshot?.id)
            .filter((id): id is number => id !== undefined)
        );
        const newSnapshots = (data.snapshots as Snapshot[]).filter(
          (snapshot: Snapshot) =>
            !existingIds.has(snapshot.snapshot.id)
        );

        set({
          unrated: [...unrated, ...newSnapshots],
          unratedSeen: newSeen,
          unratedTotal: data.unrated ?? data.total ?? 0,
          unratedArchiveTotal:
            data.archiveTotal ?? data.total ?? 0,
          unratedRatedTotal:
            data.rated ??
            Math.max(
              0,
              (data.archiveTotal ?? data.total ?? 0) -
                (data.unrated ?? data.total ?? 0)
            ),
          loading: false,
        });
        saveUnratedSeen(newSeen);
      }
    } catch (error) {
      console.error('Error fetching snapshots:', error);
      set({
        error:
          error instanceof Error
            ? error.message
            : 'Failed to fetch snapshots',
        loading: false,
      });
    }
  },

  setRating: async (snapshotId, rating) => {
    // Store original snapshots for rollback (check all lists)
    const state = useSnapshotStore.getState();
    const findSnapshotById = (list: Snapshot[]) =>
      list.find(
        (entry) => entry && entry.snapshot?.id === snapshotId
      );

    const originalSnapshot =
      findSnapshotById(state.snapshots) ||
      findSnapshotById(state.archive) ||
      findSnapshotById(state.curated) ||
      findSnapshotById(state.unrated);

    const originalUserRating = originalSnapshot?.snapshot.userRating;
    const originalCalculatedRating =
      originalSnapshot?.snapshot.calculatedRating;
    const originalRatingCount =
      originalSnapshot?.snapshot.ratingCount;

    // Update helper function
    const updateSnapshotInList = (snapshots: Snapshot[]) =>
      snapshots.map((entry) => {
        if (!entry || entry.snapshot?.id !== snapshotId) {
          return entry;
        }

        return {
          ...entry,
          snapshot: {
            ...entry.snapshot,
            userRating: rating,
          },
        };
      });

    // Optimistic update - update all lists immediately
    set((state) => ({
      snapshots: updateSnapshotInList(state.snapshots),
      archive: updateSnapshotInList(state.archive),
      curated: updateSnapshotInList(state.curated),
      unrated: updateSnapshotInList(state.unrated),
    }));

    // API call to persist to database
    try {
      const userSessionId = getUserSessionId();

      const response = await fetch(
        `/api/snapshots/${snapshotId}/rate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ userSessionId, rating }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to update rating');
      }

      const result = await response.json();

      // Update with server response (calculated rating and count)
      const updateSnapshotWithServerResult = (
        snapshots: Snapshot[]
      ) =>
        snapshots.map((entry) => {
          if (!entry || entry.snapshot?.id !== snapshotId) {
            return entry;
          }

          return {
            ...entry,
            snapshot: {
              ...entry.snapshot,
              userRating: rating,
              calculatedRating: result.calculatedRating ?? null,
              ratingCount: result.ratingCount,
            },
          };
        });

      set((state) => ({
        snapshots: updateSnapshotWithServerResult(state.snapshots),
        archive: updateSnapshotWithServerResult(state.archive),
        curated: updateSnapshotWithServerResult(state.curated),
        unrated: updateSnapshotWithServerResult(state.unrated),
      }));
    } catch (error) {
      // Rollback on failure - restore original ratings
      const rollbackSnapshot = (snapshots: Snapshot[]) =>
        snapshots.map((entry) => {
          if (!entry || entry.snapshot?.id !== snapshotId) {
            return entry;
          }

          return {
            ...entry,
            snapshot: {
              ...entry.snapshot,
              userRating: originalUserRating,
              calculatedRating: originalCalculatedRating ?? null,
              ratingCount: originalRatingCount || 0,
            },
          };
        });

      set((state) => ({
        snapshots: rollbackSnapshot(state.snapshots),
        archive: rollbackSnapshot(state.archive),
        curated: rollbackSnapshot(state.curated),
        unrated: rollbackSnapshot(state.unrated),
      }));
      console.error('Failed to update snapshot rating:', error);
      throw error; // Re-throw so components can handle the error
    }
  },
}));
