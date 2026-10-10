import type { SVGProps } from "react";

const paths = {
  home: "m3 11 9-8 9 8M5 10v11h5v-7h4v7h5V10",
  search: "M15 15 21 21M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  customize:
    "M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h3a5 5 0 0 0 5-5c0-3-4-5-9-5ZM7 8h.01M12 6h.01M17 8h.01M6 13h.01",
  eraser: "m14 3 7 7-10 11H6l-4-4L14 3ZM7 12l7 7M10 21h12",
  undo: "M4 10h10a7 7 0 0 1 0 14M4 10l5-5M4 10l5 5",
  redo: "M20 10H10a7 7 0 0 0 0 14m10-14-5-5m5 5-5 5",
  swatches: "M3 3h7v18H3V3Zm7 4 6-3 7 16-6 3-7-16ZM3 16h7",
  shield: "m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Zm-5 10 3 3 7-7",
  monitor: "M3 3h18v13H3V3Zm9 13v5M7 21h10",
  moon: "M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z",
  folder: "M3 5h7l2 3h9v13H3V5Z",
  globe: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z",
  bolt: "m13 2-9 12h7l-1 8 10-13h-8l1-7Z",
  expand: "M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5",
  arrow: "M12 19V5m-6 6 6-6 6 6",
  back: "m14 6-6 6 6 6",
  close: "m6 6 12 12M6 18 18 6",
  plus: "M12 5v14M5 12h14",
  stop: "M6 6h12v12H6z",
  chat: "M5 5h14v11H9l-4 4V5Z",
  notes: "M6 3h12v18l-6-4-6 4V3Z",
  pin: "m15 3 6 6-4 1-4 4v3l-3-3-5 5m5-5-3-3h3l4-4 1-4Z",
  camera: "M4 7h4l2-3h4l2 3h4v13H4V7Zm12 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z",
  learn: "m3 9 9-5 9 5-9 5-9-5Zm4 3v5c3 3 7 3 10 0v-5M21 9v8",
  video: "M4 5h16v14H4V5Zm6 4 6 3-6 3V9Z",
  sketch: "m4 16 12-12 4 4L8 20H4v-4Zm9-9 4 4",
  notebook: "M6 3h14v18H6V3ZM3 7h5M3 12h5M3 17h5M11 8h5M11 12h5",
  settings: "M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6",
  link: "m9 15 6-6m-8 4-2 2a4 4 0 0 0 6 6l3-3m3-7 2-2a4 4 0 0 0-6-6l-3 3",
  pause: "M8 5v14M16 5v14",
  task: "M9 6h11M9 12h11M9 18h11m-16-12 1 1 2-2m-3 7 1 1 2-2m-3 7 1 1 2-2",
  external: "M13 4h7v7m0-7L10 14M9 4H4v16h16v-5",
  trash: "M4 7h16M9 3h6l1 4H8l1-4Zm-3 4 1 14h10l1-14M10 11v6M14 11v6",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  check: "m5 12 4 4L19 6",
  rewind: "m11 6-7 6 7 6V6Zm9 0-7 6 7 6V6Z",
  play: "m7 4 14 8-14 8V4Z",
  hint: "M9 18h6m-5 3h4M8 14c-5-5-1-11 4-11s9 6 4 11l-1 2H9l-1-2Z",
  image: "M4 4h16v16H4V4Zm0 12 5-5 4 4 3-3 4 4M15 8h.01",
} as const;

export type IconName = keyof typeof paths;
export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
