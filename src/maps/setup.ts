/**
 * MapLibre v6 loads its worker from a file next to its own module
 * (`new URL('maplibre-gl-worker.mjs', import.meta.url)`). Vite pre-bundles the
 * library into node_modules/.vite/deps, where that sibling file does not exist,
 * so the worker fails to load. Point MapLibre at the real, self-contained worker
 * file: in dev Vite serves it from node_modules, in builds `?url` emits it as an asset.
 * Imported (for its side effect) by every lazy map module before a map is created.
 */
import 'maplibre-gl/dist/maplibre-gl.css'
import { getWorkerUrl, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

if (getWorkerUrl() !== workerUrl) setWorkerUrl(workerUrl)
