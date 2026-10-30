/**
 * Update state that only matters while eepy is running: the release found by the last check,
 * whether a check is in flight, and download progress. What has to survive a restart (auto-check
 * switch, last check, newest build, notified build) lives in the persisted store under
 * `settings.updates`.
 */
import { create } from 'zustand';

import type { ReleaseBuild, UpdateError } from './releases';

export type DownloadState =
  | { phase: 'idle' }
  | { phase: 'downloading'; build: number; written: number; /** -1 when unknown */ total: number }
  /** Android's installer is open. */
  | { phase: 'installing'; build: number }
  /** Downloaded, but the installer was closed without updating (cancelled or not allowed yet). */
  | { phase: 'ready'; build: number }
  | { phase: 'error'; build: number; message: string };

export interface UpdateStatus {
  checking: boolean;
  /** Newest installable build from the last check this session. */
  latest?: ReleaseBuild;
  /** Why the last check failed (cleared by a successful one). */
  error?: UpdateError;
  /** Last check attempt this session, successful or not. */
  lastAttempt?: number;
  download: DownloadState;
}

export const useUpdateStatus = create<UpdateStatus>(() => ({ checking: false, download: { phase: 'idle' } }));
