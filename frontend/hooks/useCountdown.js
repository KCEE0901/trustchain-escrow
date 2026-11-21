'use client';

import { useState, useEffect, useRef } from 'react';

/**
 * Returns a live countdown object for a future deadline ISO string / timestamp.
 *
 * Refreshes every `tickMs` milliseconds (default 1 000 ms).
 *
 * @param {string|number|Date|null} deadline  — ISO date string, Unix ms, or Date
 * @param {number} tickMs                     — tick interval in ms (default 1 000)
 * @returns {{
 *   days: number,
 *   hours: number,
 *   minutes: number,
 *   seconds: number,
 *   totalSeconds: number,
 *   isExpired: boolean,
 *   isUrgent: boolean,   // true when ≤ 24 h remain
 *   isWarning: boolean,  // true when ≤ 72 h remain
 * }}
 */
export function useCountdown(deadline, tickMs = 1_000) {
  const computeState = () => {
    if (!deadline) {
      return {
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
        totalSeconds: 0,
        isExpired: false,
        isUrgent: false,
        isWarning: false,
      };
    }

    const now = Date.now();
    const target = new Date(deadline).getTime();
    const diffMs = target - now;

    if (diffMs <= 0) {
      return {
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
        totalSeconds: 0,
        isExpired: true,
        isUrgent: false,
        isWarning: false,
      };
    }

    const totalSeconds = Math.floor(diffMs / 1_000);
    const days = Math.floor(totalSeconds / 86_400);
    const hours = Math.floor((totalSeconds % 86_400) / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;

    return {
      days,
      hours,
      minutes,
      seconds,
      totalSeconds,
      isExpired: false,
      isUrgent: totalSeconds <= 86_400,  // ≤ 24 h
      isWarning: totalSeconds <= 259_200, // ≤ 72 h
    };
  };

  const [state, setState] = useState(computeState);
  const deadlineRef = useRef(deadline);

  useEffect(() => {
    deadlineRef.current = deadline;
    setState(computeState());
  }, [deadline]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!deadline) return;

    const id = setInterval(() => {
      setState(computeState());
    }, tickMs);

    return () => clearInterval(id);
  }, [deadline, tickMs]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
