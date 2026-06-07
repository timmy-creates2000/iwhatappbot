import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  MessageSquarePlus,
  Send,
  ScrollText,
  Smartphone,
  LogOut,
  Menu,
  X,
  UsersRound,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { getStoredPassword, clearPassword } from "@/lib/app-password";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/groups", label: "Groups", icon: UsersRound },
  { href: "/campaigns", label: "Campaigns", icon: Send },
  { href: "/compose", label: "AI Compose", icon: MessageSquarePlus },
  { href: "/logs", label: "Logs", icon: ScrollText },
  { href: "/connect", label: "Connection", icon: Smartphone },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  return (
    <nav className="flex-1 overflow-y-auto p-4 space-y-1">
      <div className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider mb-4 mt-2 px-2">
        Operations
      </div>
      {NAV_ITEMS.map((item) => {
        const isActive =
          location === item.href ||
          (item.href !== "/" && location.startsWith(item.href));
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground/80"
            }`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarHeader() {
  return (
    <div className="h-16 flex items-center px-6 border-b border-sidebar-border font-bold text-xl tracking-tight text-white gap-2 shrink-0">
      <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground">
        <MessageSquarePlus className="w-5 h-5" />
      </div>
      CommGrowth
    </div>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    const storedPassword = getStoredPassword();
    setIsPending(true);
    try {
      const res = await fetch("/api/whatsapp/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(storedPassword ? { "x-app-password": storedPassword } : {}),
        },
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        if (res.status === 401) {
          toast({
            title: "Password required — go to the Connection page to disconnect",
            variant: "destructive",
          });
        } else {
          toast({
            title: body.error ?? "Failed to disconnect",
            variant: "destructive",
          });
        }
        return;
      }

      toast({ title: "Disconnected — scan QR to connect a new number" });
      setLocation("/connect");
    } catch {
      toast({ title: "Failed to disconnect", variant: "destructive" });
    } finally {
      setIsPending(false);
    }
  };

  const SignOutButton = () => (
    <div className="p-4 border-t border-sidebar-border shrink-0">
      <Button
        variant="ghost"
        className="w-full justify-start text-sidebar-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent"
        onClick={() => {
          void handleLogout();
        }}
        disabled={isPending}
      >
        <LogOut className="w-4 h-4 mr-2" />
        {isPending ? "Disconnecting..." : "Sign Out"}
      </Button>
    </div>
  );

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside className="hidden md:flex w-64 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex-col shrink-0">
        <SidebarHeader />
        <NavLinks />
        <SignOutButton />
      </aside>

      {/* ── Mobile top bar + slide-in drawer ────────────────────────────── */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <div className="md:hidden flex items-center h-14 px-4 border-b border-border bg-sidebar text-sidebar-foreground w-full shrink-0 absolute top-0 left-0 z-30">
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="text-sidebar-foreground mr-3">
              <Menu className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <span className="font-bold text-lg tracking-tight flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-primary flex items-center justify-center text-primary-foreground">
              <MessageSquarePlus className="w-4 h-4" />
            </div>
            CommGrowth
          </span>
        </div>

        <SheetContent
          side="left"
          className="p-0 w-72 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col"
        >
          <SidebarHeader />
          <NavLinks onNavigate={() => setMobileOpen(false)} />
          <SignOutButton />
        </SheetContent>
      </Sheet>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
        {/* Spacer so content doesn't hide behind mobile top bar */}
        <div className="md:hidden h-14 shrink-0" />
        <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
