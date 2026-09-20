import { ImageResponse } from 'next/og';
import { createElement } from 'react';

export const size = { width: 180, height: 180 };
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
          borderRadius: '40px',
          position: 'relative',
          overflow: 'hidden'
        }
      },
      createElement('div', {
        style: {
          position: 'absolute',
          width: '126px',
          height: '79px',
          borderRadius: '4px',
          border: '3px solid rgba(255,255,255,.92)',
          transform: 'rotate(-7deg)',
          boxShadow: '0 30px 70px rgba(0,0,0,.45)'
        }
      }),
      createElement('div', {
        style: {
          position: 'absolute',
          left: '46px',
          top: '70px',
          width: '30px',
          height: '22px',
          borderRadius: '12px',
          background: 'linear-gradient(135deg, #fff0a0, #c7932e 58%, #755015)',
          boxShadow: 'inset 0 0 0 2px rgba(74,48,8,.35)'
        }
      }),
      createElement(
        'div',
        {
          style: {
            color: '#ffffff',
            fontSize: '38px',
            fontWeight: 800,
            letterSpacing: '-2px',
            transform: 'translate(23px, 1px)'
          }
        },
        'CS'
      )
    ),
    size
  );
}
