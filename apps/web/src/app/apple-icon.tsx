
import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export const size = {
  width: 180,
  height: 180,
}
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#09090b',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 36,
        }}
      >
        <svg
          width="120"
          height="120"
          viewBox="0 0 120 120"
          fill="none"
        >
          <rect x="16" y="26" width="88" height="68" rx="8" stroke="#a1a1aa" strokeWidth="4" fill="none" />
          <circle cx="42" cy="48" r="9" stroke="#e4e4e7" strokeWidth="4" fill="none" />
          <path d="M16 78 L46 54 L68 72 L82 60 L104 82" stroke="#e4e4e7" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </div>
    ),
    {
      ...size,
    }
  )
}
