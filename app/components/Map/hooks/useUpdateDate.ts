import { useEffect, useState } from 'react';

export function useUpdateDate() {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    // 🎯 SETUP: What happens when the component mounts
    console.log('🚀 Setting up interval...');

    // ⏰ INTERVAL: Create a timer that runs every 60,000ms (1 minute)
    const interval = setInterval(() => {
      console.log('⏰ Interval fired! Updating time...');

      // 🔄 UPDATE: Change the state to trigger a re-render
      setCurrentTime(new Date());
    }, 60000); // 60,000 milliseconds = 1 minute

    // 🧹 CLEANUP: What happens when the component unmounts
    return () => {
      console.log('🧹 Cleaning up interval...');
      clearInterval(interval); // Stop the timer
    };
  }, []); // 📋 DEPENDENCIES: Empty array = run once on mount

  return currentTime;
}
