import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

// Generated at build/request time rather than a checked-in binary — no
// design asset existed anywhere in the repo before this, and this keeps
// the "G" mark's color a single source of truth (approximating
// globals.css's `--color-brand`, which ImageResponse's renderer can't
// consume directly since it doesn't evaluate oklch()).
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#2f5fd1',
          color: 'white',
          fontSize: 22,
          fontWeight: 700,
          fontFamily: 'sans-serif',
          borderRadius: 6,
        }}
      >
        G
      </div>
    ),
    { ...size }
  );
}
