import { useEffect, useState, Component, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/app-layout";
import Dashboard from "@/pages/dashboard";
import Connect from "@/pages/connect";
import Contacts from "@/pages/contacts";
import Groups from "@/pages/groups";
import Campaigns from "@/pages/campaigns";
import Compose from "@/pages/compose";
import Logs from "@/pages/logs";
import NotFound from "@/pages/not-found";
import { setDefaultHeaders } from "@workspace/api-client-react";
import { getStoredPassword } from "@/lib/app-password";

const queryClient = new QueryClient();

// ── Error Boundary ────────────────────────────────────────────────────────────
interface ErrorBoundaryState { hasError: boolean; message: string }

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : "An unexpected error occurred.",
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-8">
          <div className="max-w-md text-center space-y-4">
            <h1 className="text-2xl font-bold text-destructive">Something went wrong</h1>
            <p className="text-muted-foreground text-sm">{this.state.message}</p>
            <button
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm"
              onClick={() => { this.setState({ hasError: false, message: "" }); window.location.reload(); }}
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Auth Gate ─────────────────────────────────────────────────────────────────

function AuthGate({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const pwd = getStoredPassword();
    if (pwd) {
      setDefaultHeaders({ "x-app-password": pwd });
      setReady(true);
    } else {
      setLocation("/connect");
      setReady(true);
    }
  }, [setLocation]);

  if (!ready) return null;
  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/connect" component={Connect} />
      <Route>
        <AuthGate>
          <AppLayout>
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/contacts" component={Contacts} />
              <Route path="/groups" component={Groups} />
              <Route path="/campaigns" component={Campaigns} />
              <Route path="/compose" component={Compose} />
              <Route path="/logs" component={Logs} />
              <Route component={NotFound} />
            </Switch>
          </AppLayout>
        </AuthGate>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
