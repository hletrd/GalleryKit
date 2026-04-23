
import { ImageResponse } from 'next/og'

// Image metadata
export const size = {
  width: 32,
  height: 32,
}
export const contentType = 'image/png'

// Image generation
export default function Icon() {
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
          borderRadius: 8,
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 120 120"
          fill="none"
        >
          {/* Image frame */}
          <rect x="16" y="26" width="88" height="68" rx="8" stroke="#a1a1aa" strokeWidth="6" fill="none" />
          {/* Sun circle */}
          <circle cx="42" cy="48" r="9" stroke="#e4e4e7" strokeWidth="5" fill="none" />
          {/* Mountain landscape */}
          <path d="M16 78 L46 54 L68 72 L82 60 L104 82" stroke="#e4e4e7" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </div>
    ),
    {
      ...size,
    }
  )
}
