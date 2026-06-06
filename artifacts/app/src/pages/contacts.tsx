import { useState } from "react";
import {
  useListContacts,
  useCreateContact,
  useUpdateContact,
  useDeleteContact,
  useBulkCreateContacts,
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
import { Users, Plus, Search, Upload, Trash2, Pencil, Phone } from "lucide-react";

interface Contact {
  id: number;
  name: string;
  phone: string;
  tags?: string[] | null;
  notes?: string | null;
}

export default function Contacts() {
  const { data: contacts, isLoading } = useListContacts();
  const createContact = useCreateContact();
  const updateContact = useUpdateContact();
  const deleteContact = useDeleteContact();
  const bulkImport = useBulkCreateContacts();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [selected, setSelected] = useState<Contact | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", tags: "", notes: "" });

  const filtered = (contacts ?? []).filter(
    (c) =>
      c.name?.toLowerCase().includes(search.toLowerCase()) ||
      c.phone?.includes(search)
  );

  function openAdd() {
    setForm({ name: "", phone: "", tags: "", notes: "" });
    setShowAdd(true);
  }

  function openEdit(c: Contact) {
    setSelected(c);
    setForm({
      name: c.name ?? "",
      phone: c.phone ?? "",
      tags: (c.tags ?? []).join(", "),
      notes: c.notes ?? "",
    });
    setShowEdit(true);
  }

  function openDelete(c: Contact) {
    setSelected(c);
    setShowDelete(true);
  }

  function handleAdd() {
    if (!form.name || !form.phone) {
      toast({ title: "Name and phone are required", variant: "destructive" });
      return;
    }
    createContact.mutate(
      {
        data: {
          name: form.name,
          phone: form.phone,
          tags: form.tags ? form.tags.split(",").map((t) => t.trim()) : [],
          notes: form.notes || undefined,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Contact added" });
          setShowAdd(false);
        },
        onError: () => toast({ title: "Failed to add contact", variant: "destructive" }),
      }
    );
  }

  function handleEdit() {
    if (!selected) return;
    updateContact.mutate(
      {
        id: selected.id,
        data: {
          name: form.name,
          phone: form.phone,
          tags: form.tags ? form.tags.split(",").map((t) => t.trim()) : [],
          notes: form.notes || undefined,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Contact updated" });
          setShowEdit(false);
        },
        onError: () => toast({ title: "Failed to update", variant: "destructive" }),
      }
    );
  }

  function handleDelete() {
    if (!selected) return;
    deleteContact.mutate(
      { id: selected.id },
      {
        onSuccess: () => {
          toast({ title: "Contact deleted" });
          setShowDelete(false);
        },
        onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
      }
    );
  }

  function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      bulkImport.mutate(
        { data: { text } },
        {
          onSuccess: (res) => toast({ title: `Imported ${res.imported ?? 0} contacts` }),
          onError: () => toast({ title: "Import failed", variant: "destructive" }),
        }
      );
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Contacts</h1>
          <p className="text-muted-foreground mt-1">Manage your WhatsApp contacts.</p>
        </div>
        <div className="flex gap-2">
          <label htmlFor="csv-upload">
            <Button variant="outline" asChild>
              <span className="cursor-pointer">
                <Upload className="w-4 h-4 mr-2" />
                Import CSV
              </span>
            </Button>
          </label>
          <input id="csv-upload" type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} />
          <Button onClick={openAdd}>
            <Plus className="w-4 h-4 mr-2" />
            Add Contact
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by name or phone..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            {isLoading ? "Loading..." : `${filtered.length} Contacts`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No contacts yet. Add one or import a CSV.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((c) => (
                <div key={c.id} className="flex items-center gap-4 px-6 py-4 hover:bg-muted/30 transition-colors">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
                    {c.name?.[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">{c.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Phone className="w-3 h-3 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">{c.phone}</p>
                    </div>
                  </div>
                  <div className="flex gap-1 flex-wrap justify-end max-w-[200px]">
                    {(c.tags ?? []).slice(0, 3).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                    ))}
                  </div>
                  <div className="flex gap-1 ml-2">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(c)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => openDelete(c)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Contact</DialogTitle></DialogHeader>
          <ContactForm form={form} onChange={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={createContact.isPending}>
              {createContact.isPending ? "Adding..." : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Contact</DialogTitle></DialogHeader>
          <ContactForm form={form} onChange={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={updateContact.isPending}>
              {updateContact.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Contact</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{selected?.name}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ContactForm({
  form,
  onChange,
}: {
  form: { name: string; phone: string; tags: string; notes: string };
  onChange: (f: { name: string; phone: string; tags: string; notes: string }) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>Name *</Label>
        <Input value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} placeholder="John Doe" />
      </div>
      <div className="space-y-1">
        <Label>Phone *</Label>
        <Input value={form.phone} onChange={(e) => onChange({ ...form, phone: e.target.value })} placeholder="+1234567890" />
      </div>
      <div className="space-y-1">
        <Label>Tags (comma separated)</Label>
        <Input value={form.tags} onChange={(e) => onChange({ ...form, tags: e.target.value })} placeholder="vip, customer, prospect" />
      </div>
      <div className="space-y-1">
        <Label>Notes</Label>
        <Input value={form.notes} onChange={(e) => onChange({ ...form, notes: e.target.value })} placeholder="Optional notes..." />
      </div>
    </div>
  );
}
