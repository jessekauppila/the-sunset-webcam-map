'use client';

// Client-side Firebase SDK configuration
// Use this for browser-based Firebase features (auth, analytics, etc.)
// NOT used for the snapshot system - that uses firebase-admin on the server

import { initializeApp, getApps } from 'firebase/app';
import { getAnalytics } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: 'AIzaSyBEBT_i9t7KBsnwIs_7jJOmzysv1O7xl1Q',
  authDomain: 'sunrisesunset-32a25.firebaseapp.com',
  projectId: 'sunrisesunset-32a25',
  storageBucket: 'sunrisesunset-32a25.firebasestorage.app',
  messagingSenderId: '382399424039',
  appId: '1:382399424039:web:006ce2efa448067926d002',
  measurementId: 'G-JHJQMHC66N',
};

// Initialize Firebase (client-side)
// Only initialize if not already initialized
export function initFirebaseClient() {
  if (getApps().length === 0) {
    const app = initializeApp(firebaseConfig);

    // Only initialize analytics in the browser
    if (typeof window !== 'undefined') {
      getAnalytics(app);
    }

    return app;
  }
  return getApps()[0];
}

// Export the app for use in components
export const firebaseApp = initFirebaseClient();
