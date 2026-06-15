"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface EmailIframeProps {
  html: string;
  className?: string;
}

function buildSrcDoc(html: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html { overflow-x: hidden; }
  body {
    margin: 0; padding: 16px 20px 24px;
    max-width: 720px; margin-left: auto; margin-right: auto;
    font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
    font-size: 14px; line-height: 1.6;
    word-break: break-word; -webkit-font-smoothing: antialiased;
  }
  table { border-collapse: collapse; max-width: 100%; }
  td, th { word-break: break-word; }
  img { max-width: 100%; height: auto; }
  div, table { max-width: 100%; }
  a { color: #2563eb; }
  pre, code { white-space: pre-wrap; word-break: break-all; font-size: 12.5px; }
  blockquote { border-left: 3px solid #e5e7eb; margin: 8px 0; padding: 2px 12px; color: #6b7280; }
</style>
</head>
<body>${html}</body>
</html>`;
}

export function EmailIframe({ html, className }: EmailIframeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(0);
  const [ready, setReady] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const srcDoc = useMemo(
    () => (mounted ? buildSrcDoc(html) : ""),
    [html, mounted],
  );

  const measure = useCallback((iframe: HTMLIFrameElement) => {
    const body = iframe.contentDocument?.body;
    if (!body) return;
    iframe.style.height = "1px";
    const h = body.scrollHeight;
    if (h > 0) {
      iframe.style.height = `${h}px`;
      setHeight(h);
      setReady(true);
    }
  }, []);

  const patchLinks = useCallback((iframe: HTMLIFrameElement) => {
    iframe.contentDocument
      ?.querySelectorAll<HTMLAnchorElement>("a[href]")
      .forEach((a) => {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      });
  }, []);

  const onLoad = useCallback(
    (e: React.SyntheticEvent<HTMLIFrameElement>) => {
      const iframe = e.currentTarget;
      patchLinks(iframe);
      measure(iframe);
      iframe.contentDocument?.querySelectorAll("img").forEach((img) => {
        img.addEventListener("load", () => measure(iframe));
      });
    },
    [measure, patchLinks],
  );

  if (!mounted) {
    return (
      <div
        className={className}
        style={{ width: "100%", minHeight: 100 }}
      />
    );
  }

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox="allow-same-origin"
      referrerPolicy="no-referrer"
      title="Email content"
      onLoad={onLoad}
      className={className}
      style={{
        width: "100%",
        height: ready ? height : 0,
        border: "none",
        opacity: ready ? 1 : 0,
        transition: "opacity 0.15s ease",
      }}
    />
  );
}
