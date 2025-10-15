import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

// Initialize Firebase Admin SDK (server-side only)
// This should only be used in API routes and server components
export function initFirebaseAdmin() {
  if (getApps().length === 0) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(
      /\\n/g,
      '\n'
    );

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        'Missing Firebase credentials. Please check FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in .env.local'
      );
    }

    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
  }

  return getStorage().bucket();
}

// Get Firebase Storage bucket
export function getFirebaseBucket() {
  return initFirebaseAdmin();
}
