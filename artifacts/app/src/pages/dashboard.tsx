import { useGetDashboardStats, useGetRecentActivity, useGetWhatsAppStatus } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, MessagesSquare, Send, AlertCircle, CheckCircle2, ShieldCheck, Activity } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function Dashboard() {
  const { data: stats, isLoading: isLoadingStats } = useGetDashboardStats();
  const { data: activity, isLoading: isLoadingActivity } = useGetRecentActivity();
  const { data: status } = useGetWhatsAppStatus();

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Command Center</h1>
          <p className="text-muted-foreground mt-1">Overview of your community operations.</p>
        </div>
        
        <Card className="bg-card w-full md:w-auto">
          <CardContent className="p-4 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${status?.connected ? 'bg-primary/20 text-primary' : 'bg-destructive/20 text-destructive'}`}>
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">WhatsApp Status</p>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  {status?.connected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>}
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${status?.connected ? 'bg-primary' : 'bg-destructive'}`}></span>
                </span>
                <p className="text-xs text-muted-foreground">{status?.connected ? 'Connected' : 'Disconnected'}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard 
          title="Total Contacts" 
          value={stats?.totalContacts} 
          icon={<Users className="w-4 h-4 text-muted-foreground" />} 
          loading={isLoadingStats} 
        />
        <StatCard 
          title="Total Groups" 
          value={stats?.totalGroups} 
          icon={<MessagesSquare className="w-4 h-4 text-muted-foreground" />} 
          loading={isLoadingStats} 
        />
        <StatCard 
          title="Messages Sent (Today)" 
          value={stats?.messagesSentToday} 
          icon={<Send className="w-4 h-4 text-muted-foreground" />} 
          loading={isLoadingStats} 
        />
        <StatCard 
          title="Active Campaigns" 
          value={stats?.activeCampaigns} 
          icon={<Activity className="w-4 h-4 text-muted-foreground" />} 
          loading={isLoadingStats} 
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
        <Card className="lg:col-span-4 bg-card border-border">
          <CardHeader>
            <CardTitle>System Performance</CardTitle>
            <CardDescription>Message delivery success rate across all campaigns.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center p-6 h-[300px]">
            {isLoadingStats ? (
              <Skeleton className="w-full h-full" />
            ) : (
              <div className="text-center space-y-4">
                <div className="text-6xl font-bold text-primary">{stats?.successRate || 0}%</div>
                <div className="flex gap-8 justify-center text-sm text-muted-foreground">
                  <div className="flex flex-col items-center">
                    <span className="font-semibold text-foreground">{stats?.totalMessagesSent || 0}</span>
                    <span>Delivered</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="font-semibold text-destructive">{stats?.totalMessagesFailed || 0}</span>
                    <span>Failed</span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        
        <Card className="lg:col-span-3 bg-card border-border">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest operations and system events.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingActivity ? (
              <div className="space-y-4">
                {[1,2,3,4,5].map(i => <Skeleton key={i} className="w-full h-12" />)}
              </div>
            ) : activity && activity.length > 0 ? (
              <div className="space-y-6">
                {activity.map((item) => (
                  <div key={item.id} className="flex items-start gap-4">
                    <div className="mt-0.5">
                      {item.status === 'success' ? (
                        <CheckCircle2 className="w-5 h-5 text-primary" />
                      ) : item.status === 'failed' ? (
                        <AlertCircle className="w-5 h-5 text-destructive" />
                      ) : (
                        <Activity className="w-5 h-5 text-blue-500" />
                      )}
                    </div>
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium leading-none text-foreground">{item.message}</p>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wider">{item.type}</Badge>
                        <p className="text-xs text-muted-foreground">
                          {new Date(item.timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>No recent activity.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, loading }: { title: string, value?: number, icon: React.ReactNode, loading: boolean }) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <div className="text-2xl font-bold text-foreground">{value || 0}</div>
        )}
      </CardContent>
    </Card>
  );
}
