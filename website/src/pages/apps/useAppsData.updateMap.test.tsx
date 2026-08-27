/**
 * useAppsData — the `updateMap` return contract (PR2 App Store split).
 *
 * PR2's Updates surfaces (Discover Updates sub-tab, sidebar badge, Library
 * hint row) all render from `updateMap`, so the hook must RETURN it — before
 * PR2 it existed only internally. This pins:
 *
 * - the hook returns `updateMap` as a `Map(name -> new version)` built from
 *   registry rows with `updateAvailable`, and ONLY those rows;
 * - the map agrees with the rows the pages already consume: `installedApps`
 *   carries the same `updateAvailable`/`_newVersion`, and `updatables` holds
 *   exactly the gateway-lifecycle installed apps the map names.
 *
 * Real hook, mocked API boundary — the derivation itself is the code under
 * test, so it is NOT mocked (`buildUpdateMap` runs for real).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { listApps, listRegistry, listRegistries } = vi.hoisted(() => ({
  listApps: vi.fn(),
  listRegistry: vi.fn(),
  listRegistries: vi.fn(),
}))

vi.mock('../../api/client', () => ({
  api: {
    listApps: (...a: unknown[]) => listApps(...a),
    listRegistry: (...a: unknown[]) => listRegistry(...a),
    listRegistries: (...a: unknown[]) => listRegistries(...a),
  },
}))

import useAppsData from './useAppsData'

const registryRows = [
  // Installed with a pending update (gateway lifecycle → also updatable).
  { name: 'radar', displayName: 'Radar', version: '1.1.0', updateAvailable: true },
  // Update available but installed with a self-managed lifecycle → in the
  // map (the map is registry-derived) but NOT in `updatables`.
  { name: 'selfrun', displayName: 'Selfrun', version: '3.0.0', updateAvailable: true },
  // No update → must not appear in the map.
  { name: 'notes', displayName: 'Notes', version: '1.0.0' },
]

const installedRows = [
  { name: 'radar', displayName: 'Radar', version: '1.0.0', enabled: true, origin: 'registry', lifecycle: 'gateway' },
  { name: 'selfrun', displayName: 'Selfrun', version: '2.9.0', enabled: true, origin: 'registry', lifecycle: 'app' },
  { name: 'notes', displayName: 'Notes', version: '1.0.0', enabled: true, origin: 'local', lifecycle: 'gateway' },
]

function renderData() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(() => useAppsData(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  })
}

describe('useAppsData — updateMap export', () => {
  beforeEach(() => {
    listApps.mockReset().mockResolvedValue(installedRows)
    listRegistry.mockReset().mockResolvedValue({
      apps: registryRows, categoryOrder: [], editorialSections: [],
    })
    listRegistries.mockReset().mockResolvedValue({ registries: [] })
  })

  it('returns updateMap: name → new version for exactly the updateAvailable rows', async () => {
    const { result } = renderData()
    await waitFor(() => expect(result.current.loading).toBe(false))

    const { updateMap } = result.current
    expect(updateMap).toBeInstanceOf(Map)
    expect(updateMap.get('radar')).toBe('1.1.0')
    expect(updateMap.get('selfrun')).toBe('3.0.0')
    expect(updateMap.has('notes')).toBe(false)
    expect(updateMap.size).toBe(2)
  })

  it('agrees with the rows the pages consume: installedApps update state and updatables', async () => {
    const { result } = renderData()
    await waitFor(() => expect(result.current.loading).toBe(false))

    const byName = new Map(result.current.installedApps.map(a => [a.name, a]))
    expect(byName.get('radar')).toMatchObject({ updateAvailable: true, _newVersion: '1.1.0' })
    expect(byName.get('notes')).toMatchObject({ updateAvailable: false })
    expect(byName.get('notes')?._newVersion).toBeUndefined()

    // `updatables` = in the map AND gateway lifecycle: selfrun is mapped but
    // manages its own updates, so Update All must not touch it.
    expect(result.current.updatables.map(a => a.name)).toEqual(['radar'])
  })
})
