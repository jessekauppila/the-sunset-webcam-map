# Firebase Webcam Snapshot System - Setup Guide

This guide will walk you through setting up Firebase Storage for the webcam snapshot archiving system.

## Prerequisites

- A Google account
- Node.js and npm installed
- Access to your Neon PostgreSQL database

## Step 1: Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project" or select an existing project
3. Follow the setup wizard (you can disable Google Analytics if you don't need it)

## Step 2: Enable Firebase Storage

1. In your Firebase project, click "Storage" in the left sidebar
2. Click "Get Started"
3. Choose your security rules (you can start with test mode)
4. Select a Cloud Storage location (choose one close to your users)

## Step 3: Generate Service Account Credentials

1. In Firebase Console, go to Project Settings (gear icon) > Service Accounts
2. Click "Generate new private key"
3. Save the downloaded JSON file securely (DO NOT commit this to Git!)

## Step 4: Configure Environment Variables

Add these variables to your `.env.local` file (create it if it doesn't exist):

```bash
# Firebase Configuration
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour private key here\n-----END PRIVATE KEY-----\n"
FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com

# Cron Secret (for scheduled cleanup jobs)
CRON_SECRET=your_random_secret_here
```

**How to get these values from the service account JSON:**

- `FIREBASE_PROJECT_ID`: Copy from `project_id` field
- `FIREBASE_CLIENT_EMAIL`: Copy from `client_email` field
- `FIREBASE_PRIVATE_KEY`: Copy from `private_key` field (keep the quotes and newlines)
- `FIREBASE_STORAGE_BUCKET`: Your project ID + `.appspot.com`

**Important:** Make sure `.env.local` is in your `.gitignore` file!

## Step 5: Set Up Database Tables

Run the SQL schema in your Neon PostgreSQL database:

```bash
psql $DATABASE_URL -f database-schema-snapshots.sql
```

Or copy and paste the contents of `database-schema-snapshots.sql` into your Neon SQL Editor.

## Step 6: Configure Firebase Storage Rules (Optional)

For better security, update your Firebase Storage rules:

1. Go to Firebase Console > Storage > Rules
2. Replace with:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /snapshots/{webcamId}/{timestamp} {
      allow read: if true;  // Public read access
      allow write: if false;  // Only server can write
    }
  }
}
```

## Step 7: Test the Setup

1. Start your development server:

   ```bash
   npm run dev
   ```

2. The system will automatically:

   - Watch for terminator webcams with rating >= 4
   - Capture snapshots every 15 minutes
   - Upload to Firebase Storage
   - Save metadata to PostgreSQL

3. Check the browser console for snapshot capture logs

## Step 8: Set Up Cleanup Cron Job (Optional)

To automatically clean up snapshots older than 7 days, add this to your `vercel.json`:

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

This runs the cleanup daily at 2 AM.

Make sure to set the `CRON_SECRET` environment variable in your Vercel project settings.

## Troubleshooting

### "Missing Firebase credentials" error

- Check that all environment variables are set correctly
- Make sure `.env.local` is in the root directory
- Restart your dev server after adding environment variables

### "Failed to download image" error

- Check that the webcam image URL is accessible
- Verify your internet connection

### "Failed to upload to Firebase" error

- Verify Firebase Storage is enabled in your project
- Check that your service account has Storage Admin permissions
- Ensure the FIREBASE_STORAGE_BUCKET variable is correct

## API Endpoints

Once set up, you can use these endpoints:

- `POST /api/snapshots/capture` - Manually trigger snapshot capture
- `GET /api/snapshots` - Fetch archived snapshots
- `POST /api/snapshots/[id]/rate` - Rate a snapshot
- `POST /api/snapshots/cleanup` - Manually trigger cleanup

## Next Steps

- Monitor your Firebase Storage usage in the Firebase Console
- Set up storage quotas/alerts if needed
- Consider implementing a UI to view archived snapshots
- Add more filtering options for snapshot queries
