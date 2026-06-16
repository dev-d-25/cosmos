"use client";

import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface RecipientSuggestion {
  email: string;
  name?: string;
}

interface RecipientInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export const RecipientInput = forwardRef<HTMLInputElement, RecipientInputProps>(
  function RecipientInput(
    { value, onChange, placeholder = "recipient@email.com", className },
    ref,
  ) {
  const [suggestions, setSuggestions] = useState<RecipientSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse current input for autocomplete
  const currentValue = value.split(",").pop()?.trim() || "";

  const fetchSuggestions = useCallback(async (query: string) => {
    if (!query || query.length < 2) {
      setSuggestions([]);
      return;
    }

    try {
      const res = await fetch(`/api/mail/suggestions?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        setSuggestions(data.suggestions || []);
        setShowSuggestions(true);
      }
    } catch {
      // Silent fail
    }
  }, []);

  // Debounced suggestion fetch
  useEffect(() => {
    if (!currentValue || currentValue.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timer = setTimeout(() => {
      fetchSuggestions(currentValue);
    }, 300);

    return () => clearTimeout(timer);
  }, [currentValue, fetchSuggestions]);

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = useCallback(
    (suggestion: RecipientSuggestion) => {
      const parts = value.split(",").map((p) => p.trim());
      parts.pop(); // Remove current input
      parts.push(suggestion.email);
      onChange(parts.filter(Boolean).join(", "));
      setShowSuggestions(false);
      setSelectedIndex(-1);
      inputRef.current?.focus();
    },
    [value, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showSuggestions || suggestions.length === 0) {
        if (e.key === "Escape") {
          inputRef.current?.blur();
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : 0,
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : suggestions.length - 1,
          );
          break;
        case "Enter":
        case "Tab":
          if (selectedIndex >= 0 && suggestions[selectedIndex]) {
            e.preventDefault();
            handleSelect(suggestions[selectedIndex]);
          }
          break;
        case "Escape":
          setShowSuggestions(false);
          setSelectedIndex(-1);
          break;
      }
    },
    [showSuggestions, suggestions, selectedIndex, handleSelect],
  );

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <input
        ref={(node) => {
          inputRef.current = node;
          if (typeof ref === "function") {
            ref(node);
          } else if (ref) {
            ref.current = node;
          }
        }}
        className="bg-transparent text-foreground placeholder:text-muted-foreground w-full px-1 py-2.5 text-sm outline-none"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setSelectedIndex(-1);
        }}
        onFocus={() => {
          if (suggestions.length > 0) {
            setShowSuggestions(true);
          }
        }}
        onKeyDown={handleKeyDown}
      />

      {showSuggestions && suggestions.length > 0 && (
        <div className="bg-popover absolute top-full left-0 z-50 mt-1 max-h-[200px] w-full overflow-y-auto border shadow-md">
          {suggestions.map((suggestion, i) => (
            <button
              key={suggestion.email}
              type="button"
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                i === selectedIndex && "bg-accent",
              )}
              onClick={() => handleSelect(suggestion)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <div className="bg-muted flex size-6 items-center justify-center rounded-full text-[0.6rem] font-medium">
                {suggestion.name?.[0] || suggestion.email[0]}
              </div>
              <div className="min-w-0 flex-1">
                {suggestion.name && (
                  <div className="truncate text-xs font-medium">{suggestion.name}</div>
                )}
                <div className="text-muted-foreground truncate text-xs">{suggestion.email}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
