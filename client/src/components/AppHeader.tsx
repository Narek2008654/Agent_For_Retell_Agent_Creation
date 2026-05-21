import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useSession, signOut } from "@/lib/authClient";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { LogOutIcon } from "lucide-react";

interface AppHeaderProps {
  /** The nav link shown on the right side of the title (e.g. Memory or Chat) */
  navLink: { to: string; label: string };
}

export function AppHeader({ navLink }: AppHeaderProps) {
  const navigate = useNavigate();
  const { data: session } = useSession();
  const email = session?.user?.email ?? "";
  const initial = email ? email[0].toUpperCase() : "?";

  async function handleSignOut() {
    await signOut();
    navigate("/login");
  }

  return (
    <header className="flex h-12 items-center justify-between border-b px-4">
      <span className="font-heading font-semibold">AI Chatbot</span>

      <div className="flex items-center gap-3">
        <Link
          to={navLink.to}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          {navLink.label}
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger>
            <Avatar size="sm" className="cursor-pointer">
              <AvatarFallback>{initial}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="truncate max-w-[180px]">
              {email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                handleSignOut().catch((err: unknown) => {
                  toast.error(err instanceof Error ? err.message : "Sign out failed");
                });
              }}
            >
              <LogOutIcon />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
