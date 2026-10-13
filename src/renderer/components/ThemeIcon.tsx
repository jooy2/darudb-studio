/*
 * The picture on the theme switch: a sun while the dark theme is on, which is
 * what pressing it brings, and a moon while the light theme is on.
 *
 * Drawn inline in `currentColor`, so it takes the button's color in either
 * theme. It is decorative: the button around it carries the label.
 * */

// The angles of the eight rays around the sun, in radians
const SUN_RAY_ANGLES = Array.from({ length: 8 }, (_, index) => (index * Math.PI) / 4);

export default function ThemeIcon({ darkTheme }: { darkTheme: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {darkTheme ? (
        <>
          <circle cx="12" cy="12" r="4" />
          {SUN_RAY_ANGLES.map((angle) => (
            <line
              key={angle}
              x1={12 + Math.cos(angle) * 7}
              y1={12 + Math.sin(angle) * 7}
              x2={12 + Math.cos(angle) * 9.5}
              y2={12 + Math.sin(angle) * 9.5}
            />
          ))}
        </>
      ) : (
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
      )}
    </svg>
  );
}
