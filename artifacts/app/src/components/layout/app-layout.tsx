import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Users, 
  MessageSquarePlus, 
  Send, 
  ScrollText, 
  Smartphone,
  LogOut
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { getStoredPassword, clearPassword } from "@/lib/app-password";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/groups", label: "Groups", icon: Users },
  { href: "/campaigns", label: "Campaigns", icon: Send },
  { href: "/compose", label: "AI Compose", icon: MessageSquarePlus },
  { href: "/logs", label: "Logs", icon: ScrollText },
  { href: "/connect", label: "Connection", icon: Smartphone },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);

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
        const body = await res.json().catch(() => ({})) as { error?: string };
        if (res.status === 401) {
          toast({ title: "Password required — go to the Connection page to disconnect", variant: "destructive" });
        } else {
          toast({ title: body.error ?? "Failed to disconnect", variant: "destructive" });
        }
        return;
      }

      // Don't clear password — keep it so QR screen shows immediately on /connect
      toast({ title: "Disconnected — scan QR to connect a new number" });
      setLocation("/connect");
    } catch {
      toast({ title: "Failed to disconnect", variant: "destructive" });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-sidebar-border font-bold text-xl tracking-tight text-white gap-2">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground">
            <MessageSquarePlus className="w-5 h-5" />
          </div>
          CommGrowth
        </div>
        
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          <div className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider mb-4 mt-2 px-2">
            Operations
          </div>
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            const Icon = item.icon;
            
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive 
                    ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground/80"
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        
        <div className="p-4 border-t border-sidebar-border">
          <Button 
            variant="ghost" 
            className="w-full justify-start text-sidebar-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={() => { void handleLogout(); }}
            disabled={isPending}
          >
            <LogOut className="w-4 h-4 mr-2" />
            {isPending ? "Disconnecting..." : "Sign Out"}
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
        <div className="flex-1 overflow-y-auto p-6 md:p-8">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
