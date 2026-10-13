import React from 'react';

interface GesLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showTagline?: boolean;
  variant?: 'blue' | 'white' | 'dark';
}

export const GesLogo: React.FC<GesLogoProps> = ({
  className = '',
  size = 'md',
  showTagline = true,
  variant = 'blue'
}) => {
  // Height sizing
  const heights = {
    sm: 'h-8',
    md: 'h-11',
    lg: 'h-16',
    xl: 'h-24'
  };

  const currentHeight = heights[size] || heights.md;

  // Colors based on variant
  const logoBlue = variant === 'white' ? '#FFFFFF' : '#2238C3';
  const tagColor = variant === 'white' ? '#CBD5E1' : (variant === 'dark' ? '#0F172A' : '#475569');

  return (
    <div className={`inline-flex flex-col items-center justify-center select-none ${className}`}>
      <svg
        viewBox="0 0 350 120"
        className={`${currentHeight} w-auto max-w-full`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <g fill={logoBlue}>
          {/* LETTER G */}
          <path d="M 127 15
                   L 65 15
                   A 33 33 0 0 0 65 81
                   L 127 81
                   L 127 41
                   L 80 41
                   L 90 55
                   L 113 55
                   L 113 67
                   L 65 67
                   A 19 19 0 0 1 65 29
                   L 127 29
                   Z" />

          {/* LETTER E */}
          <rect x="147" y="15" width="70" height="14" />
          <rect x="147" y="41" width="70" height="14" />
          <rect x="147" y="67" width="70" height="14" />

          {/* LETTER S */}
          <path 
            d="M 317 22 L 257 22 A 13 13 0 0 0 257 48 L 297 48 A 13 13 0 0 1 297 74 L 237 74" 
            fill="none" 
            stroke={logoBlue} 
            strokeWidth="14" 
            strokeLinecap="butt" 
          />
        </g>

        {/* TAGLINE: CONSTRUCTION */}
        {showTagline && (
          <text
            x="171"
            y="112"
            textAnchor="middle"
            fill={tagColor}
            fontSize="16"
            fontWeight="800"
            style={{ letterSpacing: '9.5px' }}
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            CONSTRUCTION
          </text>
        )}
      </svg>
    </div>
  );
};

