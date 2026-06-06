import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useGetWhatsAppStatus, useGetWhatsAppQR, useLogoutWhatsApp } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Smartphone, ShieldCheck, Loader2, Lock, LogOut, Eye, EyeOff } from "lucide-react";
import { getStoredPassword, storePassword, clearPassword } from "@/lib/app-password";
import { useToast } from "@/hooks/use-toast";

export default function ConnectPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Password gate state
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [authedPassword, setAuthedPassword] = useState<string | null>(
    () => getStoredPassword()
  );
  const [isVerifying, setIsVerifying] = useState(false);

  // WhatsApp status — always public, no password needed
  const { data: statusData, isLoading: isLoadingStatus } = useGetWhatsAppStatus({
    query: { refetchInterval: 3000 },
  });
  const isConnected = statusData?.connected;

  // QR — only fetched after password is verified
  // Poll every 2 s so we pick up the QR as soon as Baileys generates it
  const { data: qrData, isLoading: isLoadingQR, error: qrError } = useGetWhatsAppQR({
    query: {
      enabled: !!authedPassword && !isConnected,
      refetchInterval: 2000,
      retry: false,
    },
    request: {
      headers: { "x-app-password": authedPassword ?? "" },
    },
  });

  const logout = useLogoutWhatsApp();

  // Redirect to dashboard once connected
  useEffect(() => {
    if (isConnected) {
      setLocation("/");
    }
  }, [isConnected, setLocation]);

  // If QR returns 401 the stored password is wrong — clear it
  useEffect(() => {
    if (qrError && (qrError as { status?: number }).status === 401) {
      clearPassword();
      setAuthedPassword(null);
      toast({ title: "Incorrect password", variant: "destructive" });
    }
  }, [qrError, toast]);

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;

    setIsVerifying(true);
    try {
      // Probe the QR endpoint with the supplied password to verify it.
      // Use VITE_API_URL as the base when set (Render), else relative path (Replit/local).
      const base = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
      const res = await fetch(`${base}/api/whatsapp/qr`, {
        headers: { "x-app-password": password },
      });

      if (res.status === 401) {
        toast({ title: "Wrong password", variant: "destructive" });
        return;
      }

      // 409 = already connected — password is valid, redirect to dashboard
      if (res.status === 409) {
        storePassword(password);
        setAuthedPassword(password);
        setLocation("/");
        return;
      }

      // 200 — password correct, show QR
      storePassword(password);
      setAuthedPassword(password);
    } finally {
      setIsVerifying(false);
      setPassword("");
    }
  }

  function handleDisconnect() {
    if (!authedPassword) return;
    logout.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Disconnected — scan QR to connect a new number" });
        // Keep authedPassword so QR screen shows immediately (no re-enter password)
        // The QR polling will pick up the new QR code automatically
      },
      onError: () => {
        toast({ title: "Failed to disconnect", variant: "destructive" });
      },
    });
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md bg-card border-card-border shadow-xl">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4 text-primary">
            <Smartphone className="w-6 h-6" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight text-card-foreground">
            Connect WhatsApp
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Link your device to start managing your community operations.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col items-center">
          {isLoadingStatus ? (
            /* ── Loading status ── */
            <div className="flex flex-col items-center py-8 space-y-4">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Checking connection status...</p>
            </div>

          ) : isConnected ? (
            /* ── Already connected ── */
            <div className="flex flex-col items-center py-8 space-y-4 w-full">
              <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center text-green-600 dark:text-green-400">
                <ShieldCheck className="w-8 h-8" />
              </div>
              <p className="text-sm font-medium text-foreground">Successfully Connected</p>
              <p className="text-xs text-muted-foreground">
                {statusData?.displayName
                  ? `Linked as ${statusData.displayName} (${statusData.phoneNumber})`
                  : statusData?.phoneNumber ?? ""}
              </p>
              <p className="text-xs text-muted-foreground">Redirecting to dashboard...</p>

              {/* Allow disconnect only if the password is already unlocked */}
              {authedPassword && (
                <Button
                  variant="destructive"
                  className="mt-2 w-full"
                  onClick={handleDisconnect}
                  disabled={logout.isPending}
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  {logout.isPending ? "Disconnecting..." : "Disconnect WhatsApp"}
                </Button>
              )}
            </div>

          ) : !authedPassword ? (
            /* ── Password gate ── */
            <form onSubmit={handlePasswordSubmit} className="w-full py-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="app-password" className="text-sm font-medium text-foreground">
                  App Password
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="app-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your app password"
                    className="pl-9 pr-10"
                    autoComplete="current-password"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={isVerifying || !password.trim()}>
                {isVerifying ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Unlock"
                )}
              </Button>
            </form>

          ) : (
            /* ── QR code (password verified, not yet connected) ── */
            <div className="flex flex-col items-center w-full py-4 space-y-6">
              <div className="bg-white p-4 rounded-lg shadow-sm border border-border w-64 h-64 flex items-center justify-center relative">
                {qrData?.qr ? (
                  <img src={qrData.qr} alt="WhatsApp QR Code" className="w-full h-full object-contain" />
                ) : (
                  <div className="flex flex-col items-center gap-3 text-center px-4">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <p className="text-xs text-muted-foreground">
                      {isLoadingQR ? "Loading…" : "Connecting to WhatsApp, QR code will appear shortly…"}
                    </p>
                  </div>
                )}
              </div>

              <div className="text-sm text-center space-y-2 text-muted-foreground max-w-xs">
                <p>1. Open WhatsApp on your phone</p>
                <p>2. Tap Menu or Settings and select Linked Devices</p>
                <p>3. Tap on Link a Device</p>
                <p>4. Point your phone to this screen to capture the code</p>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="text-destructive border-destructive/50 hover:bg-destructive/10"
                onClick={() => {
                  clearPassword();
                  setAuthedPassword(null);
                }}
              >
                <Lock className="w-3 h-3 mr-2" />
                Lock this page
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
