/**
 * Black swan silhouette — small bottom-right watermark on the home page.
 * Same bezier paths as the time-travel navigator's drawBlackSwan() (lines 86-122
 * of time_travel_navigator.html). Sized small + tucked into a corner so it
 * marks the page without crowding the chat. The unexpected event the framework
 * has to be able to absorb.
 */
export function SwanBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute select-none"
      style={{
        right: 16,
        bottom: 16,
        width: 96,
        height: 96,
        opacity: 0.6,
        zIndex: 0,
      }}
    >
      <svg
        viewBox="-100 -140 200 200"
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full"
      >
        <g
          fill="rgba(0, 0, 0, 0.85)"
          stroke="rgba(0, 255, 136, 0.55)"
          strokeWidth="1.2"
        >
          {/* Body */}
          <path d="M -90 30 C -90 -10, -40 -50, 20 -45 C 70 -42, 90 -20, 95 20 C 80 38, 40 45, -10 45 C -60 45, -88 40, -90 30 Z" />
          {/* Neck */}
          <path d="M -30 -30 C -50 -70, -40 -110, -10 -125 C 15 -135, 30 -125, 22 -110 C 15 -100, 0 -95, -5 -100 C -12 -100, -22 -95, -25 -85 C -32 -60, -40 -45, -30 -30 Z" />
          {/* Beak */}
          <path d="M 22 -110 L 38 -108 L 28 -103 Z" />
        </g>
        {/* Eye — faint green dot */}
        <circle cx="15" cy="-118" r="2.2" fill="rgba(0, 255, 136, 1)" />
      </svg>
    </div>
  );
}
