"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";

const SIZES = ["16", "32", "48", "192"];
const CACHE_V = "5";

function applyFavicon(isDark: boolean) {
  const variant = isDark ? "dark" : "light";
  for (const size of SIZES) {
    let link = document.querySelector<HTMLLinkElement>(
      `link[rel="icon"][sizes="${size}x${size}"]`,
    );
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      link.sizes = `${size}x${size}`;
      document.head.appendChild(link);
    }
    link.href = `/favicon-${variant}-${size}.png?v=${CACHE_V}`;
  }
  let appleTouch = document.querySelector<HTMLLinkElement>(
    'link[rel="apple-touch-icon"]',
  );
  if (!appleTouch) {
    appleTouch = document.createElement("link");
    appleTouch.rel = "apple-touch-icon";
    document.head.appendChild(appleTouch);
  }
  appleTouch.href = isDark
    ? `/favicon-dark-180.png?v=${CACHE_V}`
    : `/favicon-light-180.png?v=${CACHE_V}`;
  let shortcut = document.querySelector<HTMLLinkElement>(
    'link[rel="shortcut icon"]',
  );
  if (!shortcut) {
    shortcut = document.createElement("link");
    shortcut.rel = "shortcut icon";
    document.head.appendChild(shortcut);
  }
  shortcut.href = isDark
    ? `/favicon-dark-32.png?v=${CACHE_V}`
    : `/favicon-light-32.png?v=${CACHE_V}`;
}

export function ThemeFavicon() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    applyFavicon(resolvedTheme === "dark");
  }, [resolvedTheme]);
  return null;
}
