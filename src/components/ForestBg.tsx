import { useMemo } from 'react'
import { useStore } from '../store'

const SCENES = {
  forest: { sky: ['#f4f3e6', '#dfe6d6'], sun: '#fff7c9', layers: ['#c9d5c0', '#a9bba4', '#7f9a83', '#5f7d66'] },
  dusk: { sky: ['#f6e3d6', '#d9c6d6'], sun: '#ffd9b0', layers: ['#cdb8c4', '#a993a8', '#7d6b86', '#594a66'] },
  lake: { sky: ['#e7f0f3', '#cfdfe6'], sun: '#ffffff', layers: ['#bcd0d6', '#98b5bd', '#6f939d', '#4f727c'] },
}

function rand(seed: number) {
  let s = seed
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280)
}

/** Nền rừng thông mờ sương vẽ bằng SVG */
export function ForestBg({ scene }: { scene: keyof typeof SCENES }) {
  const customBg = useStore((s) => s.settings.customBg)
  const c = SCENES[scene]
  const layers = useMemo(() => {
    const r = rand(7)
    return [0, 1, 2, 3].map((li) => {
      const base = 560 + li * 120
      const size = 28 + li * 22
      const trees: string[] = []
      for (let x = -40; x < 1640; x += size * (0.5 + r() * 0.7)) {
        const h = size * (2.6 + r() * 1.6)
        const w = h * 0.42
        const y = base + r() * 30
        const cx = x + w / 2
        // cây thông 3 tầng
        for (let t = 0; t < 3; t++) {
          const top = y - h + (h * t) / 3.4
          const bot = y - (h * (2 - t)) / 4.2
          const half = (w / 2) * (0.55 + t * 0.25)
          trees.push(`M${cx - half},${bot} L${cx},${top} L${cx + half},${bot} Z`)
        }
        trees.push(`M${cx - 2},${y} h4 v-${h * 0.3} h-4 Z`)
      }
      return { d: trees.join(' '), base, li }
    })
  }, [])

  if (customBg)
    return <div className="bg custom-bg" style={{ backgroundImage: `url("${customBg}")` }} aria-hidden />

  return (
    <div className="bg">
      <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={c.sky[0]} />
            <stop offset="1" stopColor={c.sky[1]} />
          </linearGradient>
          <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor={c.sun} stopOpacity="1" />
            <stop offset="1" stopColor={c.sun} stopOpacity="0" />
          </radialGradient>
          <filter id="soft"><feGaussianBlur stdDeviation="3" /></filter>
          <linearGradient id="mist" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.55" />
          </linearGradient>
        </defs>
        <rect width="1600" height="1000" fill="url(#sky)" />
        <circle cx="1080" cy="230" r="320" fill="url(#sun)" />
        {layers.map((l) => (
          <g key={l.li} filter={l.li < 2 ? 'url(#soft)' : undefined}>
            <path d={l.d} fill={c.layers[l.li]} opacity={0.55 + l.li * 0.12} />
            <rect y={l.base - 5} width="1600" height={1000} fill={c.layers[l.li]} opacity={0.55 + l.li * 0.12} />
            <rect y={l.base - 220} width="1600" height="260" fill="url(#mist)" />
          </g>
        ))}
        <rect width="1600" height="1000" fill="#fff" opacity="0.18" />
      </svg>
    </div>
  )
}
