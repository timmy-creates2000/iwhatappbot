import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListGroups,
  useCreateGroup,
  useUpdateGroup,
  useDeleteGroup,
  useAddContactsToGroup,
  useSyncWhatsAppGroups,
  useGetGroupSyncStatus,
  getGetGroupSyncStatusQueryKey,
  useListContacts,
  getListGroupsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Users, Plus, RefreshCw, Trash2, Pencil, UserPlus } from "lucide-react";

interface Group {
  id: number;
  groupId: string;
  name: string;
  description?: string | null;
  memberCount?: number | null;
}

export default function Groups() {
  const queryClient = useQueryClient();
  const { data: groups, isLoading } = useListGroups();
  const { data: contacts } = useListContacts();
  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();
  const deleteGroup = useDeleteGroup();
  const syncGroups = useSyncWhatsAppGroups();
  const addContact = useAddContactsToGroup();
  const { toast } = useToast();

  // Always poll sync status: fast while syncing, slow otherwise (for cacheSize)
  const [polling, setPolling] = useState(false);
  const prevStatus = useRef<string | undefined>(undefined);
  const { data: syncStatus } = useGetGroupSyncStatus({
    query: {
      queryKey: getGetGroupSyncStatusQueryKey(),
      refetchInterval: polling ? 2000 : 10000,
    },
  });

  // Augment the type with our extra field
  const cacheSize = (syncStatus as (typeof syncStatus & { cacheSize?: number }) | undefined)?.cacheSize ?? 0;

  useEffect(() => {
    if (!syncStatus) return;
    if (syncStatus.status === "idle" && prevStatus.current === "syncing") {
      setPolling(false);
      void queryClient.invalidateQueries({ queryKey: getListGroupsQueryKey() });
      if (syncStatus.error) {
        toast({ title: syncStatus.error, variant: "destructive" });
      } else if (syncStatus.lastSync) {
        const { total } = syncStatus.lastSync;
        toast({ title: `Synced ${total} group${total !== 1 ? "s" : ""} from WhatsApp` });
      }
    }
    prevStatus.current = syncStatus.status;
  }, [syncStatus, queryClient, toast]);

  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const [selected, setSelected] = useState<Group | null>(null);
  const [form, setForm] = useState({ name: "", description: "", whatsappGroupId: "" });
  const [selectedContactIds, setSelectedContactIds] = useState<number[]>([]);

  function openAdd() {
    setForm({ name: "", description: "", whatsappGroupId: "" });
    setShowAdd(true);
  }

  function openEdit(g: Group) {
    setSelected(g);
    setForm({
      name: g.name ?? "",
      description: g.description ?? "",
      whatsappGroupId: g.groupId ?? "",
    });
    setShowEdit(true);
  }

  function openDelete(g: Group) {
    setSelected(g);
    setShowDelete(true);
  }

  function openAddContact(g: Group) {
    setSelected(g);
    setSelectedContactIds([]);
    setShowAddContact(true);
  }

  function handleDelete() {
    if (!selected) return;
    deleteGroup.mutate(
      { id: selected.id },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getListGroupsQueryKey() });
          toast({ title: "Group removed from list" });
          setShowDelete(false);
        },
        onError: () => toast({ title: "Failed to remove group", variant: "destructive" }),
      }
    );
  }

  function handleAdd() {
    if (!form.name) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    createGroup.mutate(
      {
        data: {
          name: form.name,
          groupId: form.whatsappGroupId || undefined,
        },
      },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getListGroupsQueryKey() });
          toast({ title: "Group created" });
          setShowAdd(false);
        },
        onError: () => toast({ title: "Failed to create group", variant: "destructive" }),
      }
    );
  }

  function handleEdit() {
    if (!selected) return;
    updateGroup.mutate(
      {
        id: selected.id,
        data: {
          name: form.name,
          groupId: form.whatsappGroupId || undefined,
        },
      },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getListGroupsQueryKey() });
          toast({ title: "Group updated" });
          setShowEdit(false);
        },
        onError: () => toast({ title: "Failed to update", variant: "destructive" }),
      }
    );
  }

  function handleAddContact() {
    if (!selected || selectedContactIds.length === 0) return;
    addContact.mutate(
      { id: selected.id, data: { contactIds: selectedContactIds } },
      {
        onSuccess: (data) => {
          const msg = (data as { message?: string })?.message
            ?? `${selectedContactIds.length} contact${selectedContactIds.length !== 1 ? "s" : ""} added`;
          toast({ title: msg });
          setShowAddContact(false);
        },
        onError: (err) => {
          const msg = (err as { data?: { error?: string } })?.data?.error ?? "Failed to add contacts";
          toast({ title: msg, variant: "destructive" });
        },
      }
    );
  }

  function handleSync() {
    syncGroups.mutate(undefined, {
      onSuccess: () => {
        prevStatus.current = "syncing";
        setPolling(true);
      },
      onError: (err) => {
        const msg = (err as { data?: { message?: string } }).data?.message
          ?? "Sync failed. Make sure WhatsApp is connected.";
        toast({ title: msg, variant: "destructive" });
      },
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Groups</h1>
          <p className="text-muted-foreground mt-1">Manage your WhatsApp groups.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSync} disabled={syncGroups.isPending || polling}>
            <RefreshCw className={`w-4 h-4 mr-2 ${(syncGroups.isPending || polling) ? "animate-spin" : ""}`} />
            {polling
              ? "Syncing…"
              : cacheSize > 0
              ? `Sync from WhatsApp (${cacheSize})`
              : "Sync from WhatsApp"}
          </Button>
          <Button onClick={openAdd}>
            <Plus className="w-4 h-4 mr-2" />
            New Group
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          [1, 2, 3].map((i) => <Skeleton key={i} className="h-40" />)
        ) : (groups ?? []).length === 0 ? (
          <div className="col-span-3 py-16 text-center text-muted-foreground">
            <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No groups yet. Create one or sync from WhatsApp.</p>
          </div>
        ) : (
          (groups ?? []).map((g) => (
            <Card key={g.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                      <Users className="w-5 h-5" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{g.name}</CardTitle>
                      {g.memberCount != null && (
                        <p className="text-xs text-muted-foreground">{g.memberCount} members</p>
                      )}
                    </div>
                  </div>
                  {g.groupId && !g.groupId.startsWith("local-") && (
                    <Badge variant="secondary" className="text-xs">Synced</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col gap-3">
                <div className="flex gap-2 mt-auto pt-2 border-t border-border">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => openAddContact(g)}>
                    <UserPlus className="w-3 h-3 mr-1" />
                    Add Member
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openEdit(g)}>
                    <Pencil className="w-3 h-3" />
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => openDelete(g)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Add Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Group</DialogTitle></DialogHeader>
          <GroupForm form={form} onChange={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={createGroup.isPending}>
              {createGroup.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Group</DialogTitle></DialogHeader>
          <GroupForm form={form} onChange={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={updateGroup.isPending}>
              {updateGroup.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Group</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{selected?.name}</strong> from your list?
              {selected?.groupId && !selected.groupId.startsWith("local-")
                ? " The bot will also leave the WhatsApp group."
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Contact to Group */}
      <Dialog open={showAddContact} onOpenChange={setShowAddContact}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Members to {selected?.name}</DialogTitle></DialogHeader>
          <AddContactsForm
            contacts={contacts ?? []}
            selectedIds={selectedContactIds}
            onChange={setSelectedContactIds}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddContact(false)}>Cancel</Button>
            <Button onClick={handleAddContact} disabled={addContact.isPending || selectedContactIds.length === 0}>
              {addContact.isPending ? "Adding..." : `Add ${selectedContactIds.length > 0 ? selectedContactIds.length : ""} Contact${selectedContactIds.length !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GroupForm({
  form,
  onChange,
}: {
  form: { name: string; description: string; whatsappGroupId: string };
  onChange: (f: { name: string; description: string; whatsappGroupId: string }) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>Name *</Label>
        <Input value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} placeholder="Group name" />
      </div>
      <div className="space-y-1">
        <Label>Description</Label>
        <Input value={form.description} onChange={(e) => onChange({ ...form, description: e.target.value })} placeholder="Optional description" />
      </div>
      <div className="space-y-1">
        <Label>WhatsApp Group ID</Label>
        <Input value={form.whatsappGroupId} onChange={(e) => onChange({ ...form, whatsappGroupId: e.target.value })} placeholder="120363000000000000@g.us" />
      </div>
    </div>
  );
}

function AddContactsForm({
  contacts,
  selectedIds,
  onChange,
}: {
  contacts: Array<{ id: number; name: string; phone: string }>;
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}) {
  const allSelected = contacts.length > 0 && selectedIds.length === contacts.length;
  const someSelected = selectedIds.length > 0 && !allSelected;

  function toggleAll() {
    onChange(allSelected ? [] : contacts.map((c) => c.id));
  }

  function toggle(id: number) {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id]
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Select Contacts ({selectedIds.length} / {contacts.length})</Label>
        {contacts.length > 0 && (
          <button type="button" onClick={toggleAll} className="text-xs text-primary hover:underline">
            {allSelected ? "Deselect all" : "Select all"}
          </button>
        )}
      </div>
      <div className="max-h-64 overflow-y-auto border border-border rounded-md divide-y divide-border">
        {contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground p-3">No contacts available.</p>
        ) : (
          <>
            <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40 bg-muted/20 sticky top-0">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected; }}
                onChange={toggleAll}
                className="rounded"
              />
              <span className="text-sm font-medium">All contacts</span>
            </label>
            {contacts.map((c) => (
              <label key={c.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(c.id)}
                  onChange={() => toggle(c.id)}
                  className="rounded"
                />
                <span className="text-sm">{c.name}</span>
                <span className="text-xs text-muted-foreground ml-auto">{c.phone}</span>
              </label>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
