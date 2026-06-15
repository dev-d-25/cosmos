import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import he from "he"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function decodeHtmlEntities(str: string | undefined | null): string {
  if (!str) return "";
  return he.decode(str);
}

const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/g;

export function linkifyText(text: string | undefined | null): string {
  if (!text) return "";
  const decoded = decodeHtmlEntities(text);
  const safe = decoded
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return safe.replace(URL_REGEX, (url) => {
    const href = url.replace(/[.,;:!?)]+$/, "");
    const trailing = url.slice(href.length);
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-primary underline underline-offset-2 hover:text-primary/80">${href}</a>${trailing}`;
  });
}
