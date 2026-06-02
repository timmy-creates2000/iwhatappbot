import { useEffect } from "react";
import { useLocation } from "wouter";
import { useGetWhatsAppStatus, useGetWhatsAppQR } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Smartphone, ShieldCheck, Loader2 } from "lucide-react";

export default function ConnectPage() {
  const [, setLocation] = useLocation();
  const { data: statusData, isLoading: isLoadingStatus } = useGetWhatsAppStatus();

  const isConnected = statusData?.connected;

  const { data: qrData, isLoading: isLoadingQR } = useGetWhatsAppQR();

  useEffect(() => {
    if (isConnected) {
      setLocation("/");
    }
  }, [isConnected, setLocation]);

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
            <div className="flex flex-col items-center py-8 space-y-4">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Checking connection status...</p>
            </div>
          ) : isConnected ? (
            <div className="flex flex-col items-center py-8 space-y-4">
              <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center text-green-600 dark:text-green-400">
                <ShieldCheck className="w-8 h-8" />
              </div>
              <p className="text-sm font-medium text-foreground">Successfully Connected</p>
              <p className="text-xs text-muted-foreground">Redirecting to dashboard...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center w-full py-4 space-y-6">
              <div className="bg-white p-4 rounded-lg shadow-sm border border-border w-64 h-64 flex items-center justify-center relative">
                {isLoadingQR || !qrData?.qr ? (
                  <Skeleton className="w-full h-full absolute inset-0 rounded-lg" />
                ) : (
                  <img src={qrData.qr} alt="WhatsApp QR Code" className="w-full h-full object-contain" />
                )}
              </div>
              
              <div className="text-sm text-center space-y-2 text-muted-foreground max-w-xs">
                <p>1. Open WhatsApp on your phone</p>
                <p>2. Tap Menu or Settings and select Linked Devices</p>
                <p>3. Tap on Link a Device</p>
                <p>4. Point your phone to this screen to capture the code</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
