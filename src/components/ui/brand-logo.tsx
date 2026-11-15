import React from "react";

interface BrandLogoProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  className?: string;
  showText?: boolean;
}

export function BrandLogo({
  size = 32,
  className = "",
  showText = false,
  ...props
}: BrandLogoProps) {
  if (showText) {
    return (
      <div className={`flex items-center gap-3 ${className}`}>
        <BrandIcon size={size} />
        <div>
          <span className="block font-bold tracking-widest text-white text-sm">
            ASSISTDESK
          </span>
          <span className="block text-[10px] text-zinc-400 tracking-wider uppercase font-medium">
            AI Support
          </span>
        </div>
      </div>
    );
  }

  return <BrandIcon size={size} className={className} {...props} />;
}

export function BrandIcon({
  size = 32,
  className = "",
  ...props
}: React.SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      viewBox="0 0 280 280"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="AssistDesk Logo"
      {...props}
    >
      {/* Background Frame */}
      <rect width="280" height="280" rx="44" fill="#000000" />
      <rect
        x="2"
        y="2"
        width="276"
        height="276"
        rx="42"
        fill="none"
        stroke="#27272a"
        strokeWidth="3"
      />

      {/* Semicircle Crown Arch */}
      <path
        d="M 65 130 A 75 75 0 0 1 215 130"
        stroke="#FFFFFF"
        strokeWidth="16"
        strokeLinecap="butt"
      />

      {/* Symmetrical Lateral Ear Slabs */}
      <rect x="57" y="138" width="16" height="54" rx="8" fill="#FFFFFF" />
      <rect x="207" y="138" width="16" height="54" rx="8" fill="#FFFFFF" />

      {/* The 'A' Crossbar (Floating Data Plank) */}
      <rect x="85" y="142" width="110" height="8" rx="4" fill="#FFFFFF" />

      {/* 45-degree Angled Mic Stem + Precision Diamond Spark */}
      <path
        d="M 215 180 L 215 210 L 175 230"
        stroke="#FFFFFF"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polygon points="165,230 170,225 175,230 170,235" fill="#FFFFFF" />
    </svg>
  );
}
