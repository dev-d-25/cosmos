"use client";

export const EXAMPLE_QUERIES = [
  "What unread emails do I have?",
  "Draft a reply to the most recent email from Stripe",
  "Schedule a 30-minute meeting tomorrow at 2pm",
  "Find the email about the launch from last week",
];

interface ChatEmptyStateProps {
  onQueryClick: (query: string) => void;
  onSend: (text: string) => void;
}

export function ChatEmptyState({ onQueryClick, onSend }: ChatEmptyStateProps) {
  return (
    <div className="pointer-events-auto flex flex-col items-center px-4">
      <div className="text-foreground text-center font-semibold text-2xl tracking-tight md:text-3xl">
        How can I help you?
      </div>
      <div className="text-muted-foreground/80 mt-3 text-center text-sm">
        Ask anything about your emails and calendar
      </div>

      <div className="mt-8 flex w-full max-w-lg gap-2.5 sm:grid sm:grid-cols-2">
        {EXAMPLE_QUERIES.map((query) => (
          <button
            key={query}
            onClick={() => onSend(query)}
            className="border-border/50 bg-card/30 hover:bg-card/60 hover:text-foreground min-w-[200px] shrink-0 rounded-none border px-4 py-3 text-left text-[13px] leading-relaxed text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm sm:min-w-0 sm:shrink sm:whitespace-normal"
          >
            {query}
          </button>
        ))}
      </div>
    </div>
  );
}
