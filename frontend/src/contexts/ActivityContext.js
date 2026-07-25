import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';

const ActivityContext = createContext(null);

/**
 * Tracks foreground-queued jobs (sync, reprocess, etc.) plus periodically
 * fetches recent sync logs from the backend so the status badge always
 * reflects running background tasks even after a page refresh.
 */
export function ActivityProvider({ children }) {
  // Client-side jobs registered via addJob/updateJob
  const [jobs, setJobs] = useState([]);
  // Server-side recent sync logs + authoritative in-flight jobs
  const [recentSyncs, setRecentSyncs] = useState([]);
  const [serverActive, setServerActive] = useState([]);
  const pollRef = useRef(null);

  // ── Server polling ──────────────────────────────────────────────────────
  const fetchRecentSyncs = useCallback(async () => {
    try {
      const token = localStorage.getItem('access_token');
      if (!token) return;
      const [recent, active] = await Promise.all([
        api.get('/api/sync/recent?limit=10').catch(() => ({ data: [] })),
        api.get('/api/sync/active').catch(() => ({ data: [] })),
      ]);
      setRecentSyncs(recent.data || []);
      setServerActive(active.data || []);
    } catch (_) {}
  }, []);

  useEffect(() => {
    fetchRecentSyncs();
    // Poll every 8 seconds so running jobs update in near-real-time
    pollRef.current = setInterval(fetchRecentSyncs, 8000);
    return () => clearInterval(pollRef.current);
  }, [fetchRecentSyncs]);

  // Manually force a refresh (e.g. right after starting a sync)
  const refresh = useCallback(() => fetchRecentSyncs(), [fetchRecentSyncs]);

  // ── Client-side job API ─────────────────────────────────────────────────
  const addJob = useCallback((id, type, label) => {
    const entry = { id, type, label, status: 'running', startedAt: new Date().toISOString() };
    setJobs((prev) => [entry, ...prev.slice(0, 19)]);
  }, []);

  const updateJob = useCallback((id, updates) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...updates } : j)));
  }, []);

  // ── Derived: in-flight syncs (prefer authoritative /active, fall back to filtering) ──
  const activeSyncs = serverActive.length
    ? serverActive
    : recentSyncs.filter((s) => s.status === 'processing' || s.status === 'queued');
  const runningCount =
    jobs.filter((j) => j.status === 'running').length + activeSyncs.length;

  return (
    <ActivityContext.Provider
      value={{ jobs, recentSyncs, activeSyncs, runningCount, addJob, updateJob, refresh }}
    >
      {children}
    </ActivityContext.Provider>
  );
}

export function useActivity() {
  return useContext(ActivityContext);
}
