/**
 * Shared update contract for the App Store pages (PR2 App Store split).
 *
 * LibraryPage and the Discover Updates sub-page both update the same apps
 * through the same endpoint, so the pieces that define *how* an update
 * behaves — the recorded-source routing, the per-app pending state, and the
 * sequential Update All loop with its progress and failure aggregation —
 * live here, MOVED from LibraryPage (not rewritten). Two inline copies of
 * this plumbing is the drift shape `useAppActions` already exists to prevent.
 *
 * Message DISPLAY stays in the pages: the hook reports outcomes through the
 * `setError` / `setSuccess` callbacks it is given, and each page renders (and
 * auto-dismisses) them in its own notice surface.
 */

import { useState } from 'react'
import { api } from '../../api/client'
import { i18nT } from '../../i18n/t'
import { isRegistrySourced } from '../../components/appstore/types'
import type { AppsData } from './useAppsData'

type AppUpdatesInput = Pick<AppsData, 'apps' | 'updatables' | 'announceAppsChanged'> & {
  /** Detail-page update navigation from `useAppActions` (registry-sourced apps). */
  updateApp: (name: string) => void
  /** Report a failure into the page's error notice. */
  setError: (msg: string) => void
  /** Show a transient success message (the page owns display + auto-dismiss). */
  setSuccess: (msg: string) => void
}

export function useAppUpdates({
  apps, updatables, announceAppsChanged, updateApp, setError, setSuccess,
}: AppUpdatesInput) {
  /** Sequential Update All progress, or null when no batch is running. */
  const [updatingAll, setUpdatingAll] = useState<{ done: number; total: number } | null>(null)
  /** Name of the app whose single in-place update is in flight, or null. */
  const [updatePending, setUpdatePending] = useState<string | null>(null)

  // Update dispatches on the RECORDED SOURCE, mirroring ``handle_update_app``'s
  // own branch. A registry-sourced app is re-cloned from its registry and the
  // detail page owns that flow (streaming log plus the trust consent modal), so
  // it navigates there. An app installed from a path has no registry row: it is
  // refreshed in place from the directory recorded at install — the same call
  // Update All makes — and routing it at the registry instead failed every sync
  // with "not found in registry". A row absent from this list carries no source
  // to read, so it navigates and the detail page re-dispatches on the record it
  // loads. Blocked while Update All is running so the same update can't run
  // twice concurrently.
  const runUpdate = async (name: string) => {
    if (updatingAll) return
    const target = apps.find(a => a.name === name)
    if (!target || isRegistrySourced(target)) {
      updateApp(name)
      return
    }
    setUpdatePending(name)
    setError('')
    try {
      await api.updateApp(name)
      announceAppsChanged()
      // An in-place sync is the one action here whose success is otherwise
      // INVISIBLE: re-copying a source directory usually carries the same
      // version, so the card re-renders byte-identical and the dev cannot tell
      // whether new bytes landed. Reflect it the way `disable` already does.
      setSuccess(i18nT('pages.appsPage.synced_from_its_source_directory', {
        name: target.displayName || name,
      }))
    } catch (e) {
      setError((e as Error)?.message || i18nT('pages.appsPage.action_failed', { action: 'update', name }))
    } finally {
      setUpdatePending(null)
    }
  }

  const updateAll = async () => {
    if (updatingAll) return
    const targets = updatables.map(a => a.name)
    setUpdatingAll({ done: 0, total: targets.length })
    setError('')
    const failed: string[] = []
    for (let i = 0; i < targets.length; i++) {
      try {
        await api.updateApp(targets[i])
        // Announce EACH success as it lands, so the Updates list (which
        // renders from `updateMap`) drops rows while the batch is still
        // running instead of all at once at the end. This replaces the old
        // single trailing announce: every success has already announced, and
        // a run with zero successes changed nothing worth refreshing.
        announceAppsChanged()
      } catch {
        failed.push(targets[i])
      }
      setUpdatingAll({ done: i + 1, total: targets.length })
    }
    setUpdatingAll(null)
    if (failed.length) setError(i18nT('pages.appsPage.failed_to_update', { names: failed.join(', ') }))
    else setSuccess(i18nT('pages.appsPage.updated_app', { count: targets.length }))
  }

  return { updatingAll, updatePending, runUpdate, updateAll }
}
