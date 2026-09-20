import { ImageResponse } from 'next/og';
import { createElement } from 'react';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    createElement(
      'div',
      {
        style: {
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(145deg, #111827 0%, #000000 58%, #1f2937 100%)',
          position: 'relative',
          overflow: 'hidden'
        }
      },
      createElement('div', {
        style: {
          position: 'absolute',
          width: '360px',
          height: '226px',
          borderRadius: '34px',
          border: '8px solid rgba(255,255,255,.92)',
          transform: 'rotate(-7deg)',
          boxShadow: '0 30px 70px rgba(0,0,0,.45)'
        }
      }),
      createElement('div', {
        style: {
          position: 'absolute',
          left: '132px',
          top: '201px',
          width: '84px',
          height: '62px',
          borderRadius: '12px',
          background: 'linear-gradient(135deg, #fff0a0, #c7932e 58%, #755015)',
          boxShadow: 'inset 0 0 0 4px rgba(74,48,8,.35)'
        }
      }),
      createElement(
        'div',
        {
          style: {
            color: '#ffffff',
            fontSize: '108px',
            fontWeight: 800,
            letterSpacing: '-7px',
            transform: 'translate(64px, 4px)'
          }
        },
        'CS'
      )
    ),
    size
  );
}
