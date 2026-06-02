import { useState } from "react";
import { useListMessageLogs, useListGroupLogs } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { CheckCircle2, XCircle, Clock, Send, Users, Search } from "lucide-react";

export default function Logs() {
  const { data: messageLogs, isLoading: isLoadingMsg } = useListMessageLogs();
  const { data: groupLogs, isLoading: isLoadingGroup } = useListGroupLogs();
  const [search, setSearch] = useState("");

  const filteredMsg = (messageLogs ?? []).filter(
    (l) =>
      l.contactPhone?.includes(search) ||
      l.message?.toLowerCase().includes(search.toLowerCase()) ||
      l.campaignId?.toString().includes(search)
  );

  const filteredGroup = (groupLogs ?? []).filter(
    (l) =>
      l.groupName?.toLowerCase().includes(search.toLowerCase()) ||
      l.contactName?.toLowerCase().includes(search.toLowerCase()) ||
      l.status?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Activity Logs</h1>
        <p className="text-muted-foreground mt-1">Track all message and group activity.</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search logs..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Tabs defaultValue="messages">
        <TabsList className="mb-4">
          <TabsTrigger value="messages" className="flex items-center gap-2">
            <Send className="w-4 h-4" />
            Message Logs
            {(messageLogs ?? []).length > 0 && (
              <Badge variant="secondary" className="ml-1">{messageLogs?.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="groups" className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            Group Logs
            {(groupLogs ?? []).length > 0 && (
              <Badge variant="secondary" className="ml-1">{groupLogs?.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="messages">
          <Card>
            <CardHeader>
              <CardTitle>Message Delivery Logs</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoadingMsg ? (
                <div className="p-4 space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              ) : filteredMsg.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground">
                  <Send className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No message logs yet.</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filteredMsg.map((log) => (
                    <div key={log.id} className="flex items-start gap-4 px-6 py-4 hover:bg-muted/30 transition-colors">
                      <div className="mt-0.5 shrink-0">
                        {log.status === "sent" ? (
                          <CheckCircle2 className="w-5 h-5 text-green-500" />
                        ) : log.status === "failed" ? (
                          <XCircle className="w-5 h-5 text-destructive" />
                        ) : (
                          <Clock className="w-5 h-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-medium text-foreground">{log.contactPhone ?? log.contactName ?? "Unknown"}</p>
                          {log.campaignId && (
                            <Badge variant="outline" className="text-xs">Campaign #{log.campaignId}</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-1">{log.message}</p>
                        {log.recipientPhone && (
                          <p className="text-xs text-muted-foreground mt-0.5">→ {log.recipientPhone}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <StatusBadge status={log.status ?? "pending"} />
                        <p className="text-xs text-muted-foreground mt-1">
                          {log.sentAt ? new Date(log.sentAt).toLocaleString() : "—"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="groups">
          <Card>
            <CardHeader>
              <CardTitle>Group Activity Logs</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoadingGroup ? (
                <div className="p-4 space-y-3">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              ) : filteredGroup.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground">
                  <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No group activity yet.</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filteredGroup.map((log) => (
                    <div key={log.id} className="flex items-start gap-4 px-6 py-4 hover:bg-muted/30 transition-colors">
                      <div className="mt-0.5 shrink-0">
                        {log.status === "success" ? (
                          <CheckCircle2 className="w-5 h-5 text-green-500" />
                        ) : log.status === "failed" ? (
                          <XCircle className="w-5 h-5 text-destructive" />
                        ) : (
                          <Clock className="w-5 h-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-medium text-foreground capitalize">{log.contactName ? `Added ${log.contactName}` : "Group action"}</p>
                          {log.groupId && (
                            <Badge variant="outline" className="text-xs">Group #{log.groupId}</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{log.groupName ? `Group: ${log.groupName}` : ""}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <StatusBadge status={log.status ?? "pending"} />
                        <p className="text-xs text-muted-foreground mt-1">
                          {log.createdAt ? new Date(log.createdAt).toLocaleString() : "—"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    sent: "text-green-600 bg-green-50 dark:bg-green-950",
    success: "text-green-600 bg-green-50 dark:bg-green-950",
    failed: "text-red-600 bg-red-50 dark:bg-red-950",
    pending: "text-yellow-600 bg-yellow-50 dark:bg-yellow-950",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${map[status] ?? "text-muted-foreground bg-muted"}`}>
      {status}
    </span>
  );
}
