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

  // Legacy support (deprecated - kept for backward compatibility)
  snapshots: Snapshot[];
  setSnapshots: (snapshots: Snapshot[]) => void;
  clearSnapshots: () => void;

  // Shared actions
  setLoading: (v: boolean) => void;
  setError: (e?: string) => void;

  // Page management
  setPageSize: (mode: 'archive' | 'curated', size: number) => void;
  goToPage: (mode: 'archive' | 'curated', page: number) => void;
  nextPage: (mode: 'archive' | 'curated') => void;
  prevPage: (mode: 'archive' | 'curated') => void;

  // Fetch operations
  fetchMore: (mode: 'archive' | 'curated') => Promise<void>;

  // Reset operations
  resetArchive: () => void;
  resetCurated: () => void;

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
    console.error('Error loading curated seen from sessionStorage:', error);
  }
  return new Set();
};

// Save curatedSeen to sessionStorage
const saveCuratedSeen = (seen: Set<number>) => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem('snapshot_curated_seen', JSON.stringify([...seen]));
  } catch (error) {
    console.error('Error saving curated seen to sessionStorage:', error);
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
    } else {
      set({ curatedPageSize: size });
    }
  },

  goToPage: (mode, page) => {
    if (mode === 'archive') {
      const { archive, archivePageSize, archiveTotal } = get();
      const totalPages = Math.ceil(archiveTotal / archivePageSize);
      const targetPage = Math.max(1, Math.min(page, totalPages));
      set({ archivePage: targetPage });
      
      // If page is beyond current buffer, fetch more
      const bufferEndPage = Math.floor(archive.length / archivePageSize);
      if (targetPage > bufferEndPage) {
        get().fetchMore('archive');
      }
    } else {
      set({ curatedPage: page });
      
      // Check if we need to fetch more for curated view
      const { curated, curatedPageSize } = get();
      const bufferEndPage = Math.floor(curated.length / curatedPageSize);
      if (page > bufferEndPage) {
        get().fetchMore('curated');
      }
    }
  },

  nextPage: (mode) => {
    const { goToPage, archivePage, curatedPage } = get();
    const currentPage = mode === 'archive' ? archivePage : curatedPage;
    goToPage(mode, currentPage + 1);
  },

  prevPage: (mode) => {
    const { goToPage, archivePage, curatedPage } = get();
    const currentPage = mode === 'archive' ? archivePage : curatedPage;
    goToPage(mode, currentPage - 1);
  },

  // Reset operations
  resetArchive: () => set({ 
    archive: [], 
    archivePage: 1, 
    archiveTotal: 0 
  }),

  resetCurated: () => {
    set({ 
      curated: [], 
      curatedPage: 1, 
      curatedTotal: 0,
      curatedSeen: new Set() 
    });
    saveCuratedSeen(new Set());
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
      } else {
        const { curatedSeen } = state;
        const seenIdsArray = [...curatedSeen];
        const excludeIds = seenIdsArray.length > 0 ? seenIdsArray.join(',') : '';
        url = `/api/snapshots?mode=curated&limit=100&user_session_id=${userSessionId}${excludeIds ? `&exclude_ids=${excludeIds}` : ''}`;
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch snapshots');
      }

      const data = await response.json();

      if (mode === 'archive') {
        // Archive mode: replace the current page's snapshots
        const { archive, archivePage, archivePageSize } = get();
        const startIdx = (archivePage - 1) * archivePageSize;
        const endIdx = startIdx + archivePageSize;
        
        // Expand archive array if needed
        const newArchive = [...archive];
        for (let i = startIdx; i < startIdx + data.snapshots.length; i++) {
          newArchive[i] = data.snapshots[i - startIdx];
        }

        set({ 
          archive: newArchive, 
          archiveTotal: data.total,
          loading: false 
        });
      } else {
        // Curated mode: append to buffer and update seen set
        const { curatedSeen } = get();
        const newSeen = new Set(curatedSeen);
        (data.returnedIds as number[]).forEach((id) => newSeen.add(id));
        
        set({ 
          curated: [...get().curated, ...data.snapshots],
          curatedSeen: newSeen,
          curatedTotal: data.total,
          loading: false 
        });
        saveCuratedSeen(newSeen);
      }
    } catch (error) {
      console.error('Error fetching snapshots:', error);
      set({ 
        error: error instanceof Error ? error.message : 'Failed to fetch snapshots',
        loading: false 
      });
    }
  },

  setRating: async (snapshotId, rating) => {
    // Store original snapshots for rollback (check all lists)
    const state = useSnapshotStore.getState();
    const originalSnapshot = 
      state.snapshots.find((s) => s.snapshot.id === snapshotId) ||
      state.archive.find((s) => s.snapshot.id === snapshotId) ||
      state.curated.find((s) => s.snapshot.id === snapshotId);
      
    const originalUserRating = originalSnapshot?.snapshot.userRating;
    const originalCalculatedRating = originalSnapshot?.snapshot.calculatedRating;
    const originalRatingCount = originalSnapshot?.snapshot.ratingCount;

    // Update helper function
    const updateSnapshotInList = (snapshots: Snapshot[]) => 
      snapshots.map((s) =>
        s.snapshot.id === snapshotId
          ? {
              ...s,
              snapshot: {
                ...s.snapshot,
                userRating: rating,
              },
            }
          : s
      );

    // Optimistic update - update all lists immediately
    set((state) => ({
      snapshots: updateSnapshotInList(state.snapshots),
      archive: updateSnapshotInList(state.archive),
      curated: updateSnapshotInList(state.curated),
    }));

    // API call to persist to database
    try {
      const userSessionId = getUserSessionId();

      const response = await fetch(`/api/snapshots/${snapshotId}/rate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userSessionId, rating }),
      });

      if (!response.ok) {
        throw new Error('Failed to update rating');
      }

      const result = await response.json();

      // Update with server response (calculated rating and count)
      const updateSnapshotWithServerResult = (snapshots: Snapshot[]) =>
        snapshots.map((s) =>
          s.snapshot.id === snapshotId
            ? {
                ...s,
                snapshot: {
                  ...s.snapshot,
                  userRating: rating,
                  calculatedRating: result.calculatedRating ?? null,
                  ratingCount: result.ratingCount,
                },
              }
            : s
        );

      set((state) => ({
        snapshots: updateSnapshotWithServerResult(state.snapshots),
        archive: updateSnapshotWithServerResult(state.archive),
        curated: updateSnapshotWithServerResult(state.curated),
      }));
    } catch (error) {
      // Rollback on failure - restore original ratings
      const rollbackSnapshot = (snapshots: Snapshot[]) =>
        snapshots.map((s) =>
          s.snapshot.id === snapshotId
            ? {
                ...s,
                snapshot: {
                  ...s.snapshot,
                  userRating: originalUserRating,
                  calculatedRating: originalCalculatedRating ?? null,
                  ratingCount: originalRatingCount || 0,
                },
              }
            : s
        );

      set((state) => ({
        snapshots: rollbackSnapshot(state.snapshots),
        archive: rollbackSnapshot(state.archive),
        curated: rollbackSnapshot(state.curated),
      }));
      console.error('Failed to update snapshot rating:', error);
      throw error; // Re-throw so components can handle the error
    }
  },
}));
