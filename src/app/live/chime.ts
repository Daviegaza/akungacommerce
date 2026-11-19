import { useLocalString } from './storage'

const CHIME_KEY = 'rafu.saleChime'

/** Sale chime preference, off by default (docs/DESIGN.md). Stored per device. */
export function useChimeSetting(): [boolean, (on: boolean) => void] {
  const [raw, set] = useLocalString(CHIME_KEY)
  return [raw === 'on', (on) => set(on ? 'on' : null)]
}

let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  ctx ??= new Ctor()
  return ctx
}

/**
 * Gentle two-note "ka-ching" (E6 then A6) synthesised with WebAudio, so no
 * audio file is downloaded. Browsers may keep audio locked until the user has
 * interacted with the page; then this silently does nothing.
 */
export function playChime() {
  const ac = audio()
  if (!ac) return
  const start = () => {
    const t0 = ac.currentTime + 0.02
    const notes: [number, number][] = [
      [1318.5, 0],
      [1760, 0.12],
    ]
    for (const [freq, offset] of notes) {
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, t0 + offset)
      gain.gain.setValueAtTime(0.0001, t0 + offset)
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + offset + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.55)
      osc.connect(gain).connect(ac.destination)
      osc.start(t0 + offset)
      osc.stop(t0 + offset + 0.6)
    }
  }
  if (ac.state === 'suspended') {
    ac.resume().then(start, () => undefined)
  } else {
    start()
  }
}
