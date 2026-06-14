import Link from "next/link";
import { type VariantProps } from "class-variance-authority";
import { buttonVariants } from "@/components/ui/button";

export function ConnectButton({
  plugin,
  variant,
  size,
}: { plugin: string } & VariantProps<typeof buttonVariants>) {
  const label =
    plugin === "gmail" ? "Connect Gmail" : "Connect Google Calendar";

  return (
    <Link
      href={`/api/connect?plugin=${plugin}`}
      className={buttonVariants({ variant: variant ?? "outline", size })}
    >
      {label}
    </Link>
  );
}
