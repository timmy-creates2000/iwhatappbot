import { useState } from "react";
import {
  useListCampaigns,
  useCreateCampaign,
  useUpdateCampaign,
  useDeleteCampaign,
  useStartCampaign,
  useListContacts,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Send, Plus, Play, Trash2, Pencil, Users, CheckCircle2, XCircle, Clock } from "lucide-react";

interface Campaign {
  id: number;
  name: string;
  messageTemplate: string;
  status: string;
  startDate?: string | null;
  createdAt: string;
  sentCount: number;
  failedCount: number;
  totalCount: number;
}

const STATUS_CONFIG: Record<string, { label: string; variant: "secondary" | "default" | "destructive" | "outline"; icon: React.ReactNode }> = {
  draft: { label: "Draft", variant: "secondary", icon: <Clock className="w-3 h-3" /> },
  running: { label: "Running", variant: "default", icon: <Play className="w-3 h-3" /> },
  completed: { label: "Completed", variant: "outline", icon: <CheckCircle2 className="w-3 h-3" /> },
  failed: { label: "Failed", variant: "destructive", icon: <XCircle className="w-3 h-3" /> },
  paused: { label: "Paused", variant: "secondary", icon: <Clock className="w-3 h-3" /> },
};

type FormState = {
  name: string;
  messageTemplate: string;
  contactIds: number[];
};

export default function Campaigns() {
  const { data: campaigns, isLoading } = useListCampaigns();
  const { data: contacts } = useListContacts();
  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const deleteCampaign = useDeleteCampaign();
  const runCampaign = useStartCampaign();
  const { toast } = useToast();

  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [form, setForm] = useState<FormState>({ name: "", messageTemplate: "", contactIds: [] });

  function openAdd() {
    setForm({ name: "", messageTemplate: "", contactIds: [] });
    setShowAdd(true);
  }

  function openEdit(c: Campaign) {
    setSelected(c);
    // Fetch existing contact IDs for this campaign so they aren't cleared on save
    setForm({ name: c.name, messageTemplate: c.messageTemplate, contactIds: [] });
    setShowEdit(true);
  }

  function openDelete(c: Campaign) {
    setSelected(c);
    setShowDelete(true);
  }

  function handleAdd() {
    if (!form.name || !form.messageTemplate) {
      toast({ title: "Name and message are required", variant: "destructive" });
      return;
    }
    createCampaign.mutate(
      { data: { name: form.name, messageTemplate: form.messageTemplate, contactIds: form.contactIds } },
      {
        onSuccess: () => { toast({ title: "Campaign created" }); setShowAdd(false); },
        onError: () => toast({ title: "Failed to create campaign", variant: "destructive" }),
      }
    );
  }

  function handleEdit() {
    if (!selected) return;
    updateCampaign.mutate(
      { id: selected.id, data: { name: form.name, messageTemplate: form.messageTemplate } },
      {
        onSuccess: () => { toast({ title: "Campaign updated" }); setShowEdit(false); },
        onError: () => toast({ title: "Failed to update", variant: "destructive" }),
      }
    );
  }

  function handleDelete() {
    if (!selected) return;
    deleteCampaign.mutate(
      { id: selected.id },
      {
        onSuccess: () => { toast({ title: "Campaign deleted" }); setShowDelete(false); },
        onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
      }
    );
  }

  function handleRun(c: Campaign) {
    runCampaign.mutate(
      { id: c.id },
      {
        onSuccess: () => toast({ title: `Campaign "${c.name}" started` }),
        onError: (err) => {
          const msg = (err as { data?: { error?: string } }).data?.error
            ?? "Failed to run campaign. Check WhatsApp connection.";
          toast({ title: msg, variant: "destructive" });
        },
      }
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Campaigns</h1>
          <p className="text-muted-foreground mt-1">Create and run bulk messaging campaigns.</p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="w-4 h-4 mr-2" />
          New Campaign
        </Button>
      </div>

      <div className="grid gap-4">
        {isLoading ? (
          [1, 2, 3].map((i) => <Skeleton key={i} className="h-40 w-full" />)
        ) : (campaigns ?? []).length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <Send className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No campaigns yet. Create your first one!</p>
          </div>
        ) : (
          (campaigns ?? []).map((c) => {
            const statusCfg = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.draft;
            const isDraft = c.status === "draft";
            return (
              <Card key={c.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0 pr-4">
                      <CardTitle className="text-lg">{c.name}</CardTitle>
                      <CardDescription className="mt-1 line-clamp-2">{c.messageTemplate}</CardDescription>
                    </div>
                    <Badge variant={statusCfg.variant} className="flex items-center gap-1 shrink-0">
                      {statusCfg.icon}
                      {statusCfg.label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Users className="w-4 h-4" />
                        {c.totalCount} contacts
                      </div>
                      {c.sentCount > 0 && (
                        <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                          <CheckCircle2 className="w-4 h-4" />
                          {c.sentCount} sent
                        </div>
                      )}
                      {c.failedCount > 0 && (
                        <div className="flex items-center gap-1 text-destructive">
                          <XCircle className="w-4 h-4" />
                          {c.failedCount} failed
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {(c.status === "draft" || c.status === "paused") && (
                        <Button size="sm" onClick={() => handleRun(c)} disabled={runCampaign.isPending}>
                          <Play className="w-3 h-3 mr-1" />
                          {c.status === "paused" ? "Resume" : "Run"}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => openDelete(c)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Add Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New Campaign</DialogTitle></DialogHeader>
          <CampaignForm
            form={form}
            onChange={setForm}
            contacts={contacts ?? []}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={createCampaign.isPending}>
              {createCampaign.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Campaign</DialogTitle></DialogHeader>
          <CampaignForm
            form={form}
            onChange={setForm}
            contacts={contacts ?? []}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={updateCampaign.isPending}>
              {updateCampaign.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Campaign</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{selected?.name}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CampaignForm({
  form,
  onChange,
  contacts,
}: {
  form: FormState;
  onChange: (f: FormState) => void;
  contacts: Array<{ id: number; name: string; phone: string }>;
}) {
  function toggleContact(id: number) {
    const next = form.contactIds.includes(id)
      ? form.contactIds.filter((c) => c !== id)
      : [...form.contactIds, id];
    onChange({ ...form, contactIds: next });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>Campaign Name *</Label>
        <Input
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          placeholder="My Campaign"
        />
      </div>
      <div className="space-y-1">
        <Label>Message Template *</Label>
        <Textarea
          value={form.messageTemplate}
          onChange={(e) => onChange({ ...form, messageTemplate: e.target.value })}
          placeholder="Hi {{name}}, we have an exciting announcement for you!"
          className="min-h-[100px] resize-none"
        />
        <p className="text-xs text-muted-foreground">Use {"{{name}}"} and {"{{phone}}"} as placeholders.</p>
      </div>
      <div className="space-y-1">
        <Label>Target Contacts ({form.contactIds.length} selected)</Label>
        <div className="max-h-40 overflow-y-auto border border-border rounded-md divide-y divide-border">
          {contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground p-3">No contacts available. Add contacts first.</p>
          ) : (
            contacts.map((c) => (
              <label key={c.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40">
                <input
                  type="checkbox"
                  checked={form.contactIds.includes(c.id)}
                  onChange={() => toggleContact(c.id)}
                  className="rounded"
                />
                <span className="text-sm">{c.name}</span>
                <span className="text-xs text-muted-foreground ml-auto">{c.phone}</span>
              </label>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
