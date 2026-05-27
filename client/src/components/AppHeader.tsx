import { Link } from "react-router-dom";
import { UserButton } from "@clerk/clerk-react";
import { ThemeToggle } from "@/components/ThemeToggle";

interface AppHeaderProps {
  /** Nav links shown on the right side of the title (links to the other sections). */
  navLinks: { to: string; label: string }[];
}

export function AppHeader({ navLinks }: AppHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/70 bg-background/80 px-5 backdrop-blur-sm">
      <Link to="/" className="group flex items-center gap-2.5">
        {/* Inked monogram tile — the Atelier mark. */}
        <span className="flex size-7 items-center justify-center rounded-[9px] bg-primary font-display text-[1.05rem] italic font-semibold leading-none text-primary-foreground shadow-sm transition-transform group-hover:-rotate-3">
          a
        </span>
        <span className="font-display text-[1.15rem] font-semibold tracking-tight">
          AI Chatbot
        </span>
      </Link>

      <div className="flex items-center gap-1.5">
        {navLinks.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="rounded-md px-2.5 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {link.label}
          </Link>
        ))}

        <ThemeToggle />

        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

        <UserButton afterSignOutUrl="/login" />
      </div>
    </header>
  );
}
