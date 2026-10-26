import type { SVGProps } from "react";

/** Line icons (24px grid, 1.8 stroke) drawn for Samanvay; colour follows currentColor. */
type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const IconDesk = (p: P) => <Svg {...p}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></Svg>;
export const IconCases = (p: P) => <Svg {...p}><path d="M4 7h16v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M4 12h16" /></Svg>;
export const IconLink = (p: P) => <Svg {...p}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></Svg>;
export const IconBuilding = (p: P) => <Svg {...p}><path d="M3 21h18M5 21V9l7-5 7 5v12" /><path d="M9 21v-5h6v5M9 11h.01M15 11h.01" /></Svg>;
export const IconGauge = (p: P) => <Svg {...p}><path d="M4 18a8 8 0 1 1 16 0" /><path d="M12 18l4-6" /><circle cx="12" cy="18" r="1" /></Svg>;
export const IconReport = (p: P) => <Svg {...p}><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h4" /></Svg>;
export const IconUpload = (p: P) => <Svg {...p}><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></Svg>;
export const IconChart = (p: P) => <Svg {...p}><path d="M4 20V4M4 20h16" /><path d="M8 16v-4M12 16V8M16 16v-6" /></Svg>;
export const IconGear = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Svg>;
export const IconShield = (p: P) => <Svg {...p}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></Svg>;
export const IconBell = (p: P) => <Svg {...p}><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10 20a2 2 0 0 0 4 0" /></Svg>;
export const IconSearch = (p: P) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Svg>;
export const IconArrow = (p: P) => <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
export const IconPlus = (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const IconCheck = (p: P) => <Svg {...p}><path d="M5 12l5 5 9-10" /></Svg>;
export const IconAlert = (p: P) => <Svg {...p}><path d="M12 3l10 18H2z" /><path d="M12 10v4M12 18h.01" /></Svg>;
export const IconClock = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>;
export const IconTransfer = (p: P) => <Svg {...p}><path d="M4 8h13l-3-3M20 16H7l3 3" /></Svg>;
export const IconLock = (p: P) => <Svg {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Svg>;
export const IconLogout = (p: P) => <Svg {...p}><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h10" /></Svg>;
export const IconDoc = (p: P) => <Svg {...p}><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4" /></Svg>;
export const IconStop = (p: P) => <Svg {...p}><path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z" /><path d="M12 8v5M12 16h.01" /></Svg>;
export const IconMenu = (p: P) => <Svg {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Svg>;
export const IconX = (p: P) => <Svg {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>;

/** Large line illustrations for the pastel tiles (inspired by the reference: drawn in the tile's ink colour). */
export function TileArt({ kind }: { kind: "inbox" | "link" | "clock" | "check" | "transfer" | "alert" | "stack" | "building" }) {
  const common = { width: 92, height: 92, viewBox: "0 0 96 96", fill: "none", stroke: "currentColor", strokeWidth: 2.4,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (kind) {
    case "inbox":
      return <svg {...common}><rect x="18" y="22" width="60" height="52" rx="8" /><path d="M18 52h16l6 8h16l6-8h16" /><path d="M40 36h16" /></svg>;
    case "link":
      return <svg {...common}><circle cx="34" cy="48" r="16" /><circle cx="62" cy="48" r="16" /><path d="M44 30l8-8M52 74l-8-8" /></svg>;
    case "clock":
      return <svg {...common}><circle cx="48" cy="50" r="26" /><path d="M48 34v16l11 7M38 16h20" /></svg>;
    case "check":
      return <svg {...common}><rect x="22" y="18" width="52" height="62" rx="8" /><path d="M34 50l9 9 18-20" /></svg>;
    case "transfer":
      return <svg {...common}><rect x="12" y="26" width="30" height="40" rx="6" /><rect x="54" y="30" width="30" height="40" rx="6" /><path d="M36 20h26l-6-6M60 76H34l6 6" /></svg>;
    case "alert":
      return <svg {...common}><path d="M48 16l34 60H14z" /><path d="M48 40v16M48 64v.5" /></svg>;
    case "stack":
      return <svg {...common}><path d="M16 36l32-16 32 16-32 16z" /><path d="M16 50l32 16 32-16M16 64l32 16 32-16" /></svg>;
    default:
      return <svg {...common}><path d="M14 80h68M22 80V40l26-18 26 18v40" /><path d="M40 80V62h16v18M36 46h.5M60 46h.5" /></svg>;
  }
}
