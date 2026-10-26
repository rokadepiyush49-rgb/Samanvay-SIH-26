export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${fmtDate(iso)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${v}%`;
}

export function num(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : v.toLocaleString("en-IN");
}

export const CHANNEL_LABEL: Record<string, string> = {
  CPGRAMS: "CPGRAMS", EMAIL: "E-mail", LETTER: "Letter", REFERRAL: "Referral", REGISTER: "Unit register",
  PORTAL: "Portal", WALK_IN: "Walk-in", COURT: "Court", PARLIAMENT: "Parliament",
};

export function label(code: string | null | undefined): string {
  if (!code) return "—";
  return code.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}
