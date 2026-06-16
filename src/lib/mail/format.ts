export function initialsOf(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return "?";
  const local = trimmed.includes("@") ? trimmed.split("@")[0]! : trimmed;
  const parts = local.split(/[ ._<>]+/).filter(Boolean);
  if (parts.length === 0) return local.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

export function formatReceived(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  const months = [
    "Jan","Feb","Mar","Apr","May","Jun",
    "Jul","Aug","Sep","Oct","Nov","Dec",
  ];
  const mon = months[d.getMonth()];
  const day = d.getDate();
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear ? `${mon} ${day}` : `${mon} ${day}, ${d.getFullYear()}`;
}
