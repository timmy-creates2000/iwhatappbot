import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import {
  useListContacts,
  useCreateContact,
  useUpdateContact,
  useDeleteContact,
  useBulkCreateContacts,
  useBulkDeleteContacts,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Users, Plus, Search, Upload, Trash2, Pencil, Phone, FileSpreadsheet } from "lucide-react";

interface Contact {
  id: number;
  name: string;
  phone: string;
  tags?: string[] | null;
  notes?: string | null;
}

async function fileToCSVText(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "xlsx" || ext === "xls") {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_csv(sheet);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsText(file, "utf-8");
  });
}

export default function Contacts() {
  const { data: contacts, isLoading } = useListContacts();
  const createContact = useCreateContact();
  const updateContact = useUpdateContact();
  const deleteContact = useDeleteContact();
  const bulkImport = useBulkCreateContacts();
  const bulkDelete = useBulkDeleteContacts();
  const { toast } = useToast();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDeleteOne, setShowDeleteOne] = useState(false);
  const [showDeleteBulk, setShowDeleteBulk] = useState(false);
  const [selected, setSelected] = useState<Contact | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", tags: "", notes: "" });
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);

  const filtered = (contacts ?? []).filter(
    (c) =>
      c.name?.toLowerCase().includes(search.toLowerCase()) ||
      c.phone?.includes(search)
  );

  const allChecked = filtered.length > 0 && filtered.every((c) => checkedIds.has(c.id));
  const someChecked = filtered.some((c) => checkedIds.has(c.id));
  const checkedCount = filtered.filter((c) => checkedIds.has(c.id)).length;

  function toggleAll() {
    if (allChecked) {
      setCheckedIds((prev) => {
        const next = new Set(prev);
        filtered.forEach((c) => next.delete(c.id));
        return next;
      });
    } else {
      setCheckedIds((prev) => {
        const next = new Set(prev);
        filtered.forEach((c) => next.add(c.id));
        return next;
      });
    }
  }

  function toggleOne(id: number) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

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

  function openDeleteOne(c: Contact) {
    setSelected(c);
    setShowDeleteOne(true);
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

  function handleDeleteOne() {
    if (!selected) return;
    deleteContact.mutate(
      { id: selected.id },
      {
        onSuccess: () => {
          toast({ title: "Contact deleted" });
          setCheckedIds((prev) => { const next = new Set(prev); next.delete(selected.id); return next; });
          setShowDeleteOne(false);
        },
        onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
      }
    );
  }

  function handleBulkDelete() {
    const ids = filtered.filter((c) => checkedIds.has(c.id)).map((c) => c.id);
    if (!ids.length) return;
    bulkDelete.mutate(
      { data: { ids } },
      {
        onSuccess: () => {
          toast({ title: `Deleted ${ids.length} contact${ids.length > 1 ? "s" : ""}` });
          setCheckedIds(new Set());
          setShowDeleteBulk(false);
        },
        onError: () => toast({ title: "Bulk delete failed", variant: "destructive" }),
      }
    );
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setImporting(true);
    try {
      const text = await fileToCSVText(file);
      bulkImport.mutate(
        { data: { text } },
        {
          onSuccess: (res) => {
            const count = res.imported ?? 0;
            const skipped = res.skipped ?? 0;
            toast({
              title: `Imported ${count} contact${count !== 1 ? "s" : ""}`,
              description: skipped > 0 ? `${skipped} row${skipped > 1 ? "s" : ""} skipped` : undefined,
            });
          },
          onError: () => toast({ title: "Import failed", variant: "destructive" }),
          onSettled: () => setImporting(false),
        }
      );
    } catch {
      toast({ title: "Could not read file", variant: "destructive" });
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Contacts</h1>
          <p className="text-muted-foreground mt-1">Manage your WhatsApp contacts.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {someChecked && (
            <Button
              variant="destructive"
              onClick={() => setShowDeleteBulk(true)}
              disabled={bulkDelete.isPending}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete {checkedCount} selected
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
          >
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            {importing ? "Importing…" : "Import"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls,.txt"
            className="hidden"
            onChange={handleFileUpload}
          />
          <Button onClick={openAdd}>
            <Plus className="w-4 h-4 mr-2" />
            Add Contact
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by name or phone…"
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            {isLoading ? "Loading…" : `${filtered.length} Contact${filtered.length !== 1 ? "s" : ""}`}
            {someChecked && (
              <span className="ml-auto text-sm font-normal text-muted-foreground">
                {checkedCount} selected
              </span>
            )}
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
              <p className="mb-1">No contacts yet.</p>
              <p className="text-sm">Add one manually or import a CSV, Excel, or TXT file.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-4 px-6 py-2 border-b border-border bg-muted/20">
                <Checkbox
                  checked={allChecked}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                />
                <span className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                  Select all
                </span>
              </div>
              <div className="divide-y divide-border">
                {filtered.map((c) => (
                  <div
                    key={c.id}
                    className={`flex items-center gap-4 px-6 py-4 hover:bg-muted/30 transition-colors ${
                      checkedIds.has(c.id) ? "bg-primary/5" : ""
                    }`}
                  >
                    <Checkbox
                      checked={checkedIds.has(c.id)}
                      onCheckedChange={() => toggleOne(c.id)}
                      aria-label={`Select ${c.name}`}
                    />
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
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => openDeleteOne(c)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
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
              {createContact.isPending ? "Adding…" : "Add"}
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
              {updateContact.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single delete */}
      <AlertDialog open={showDeleteOne} onOpenChange={setShowDeleteOne}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Contact</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <strong>{selected?.name}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteOne}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete */}
      <AlertDialog open={showDeleteBulk} onOpenChange={setShowDeleteBulk}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {checkedCount} contacts?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {checkedCount} selected contact{checkedCount > 1 ? "s" : ""}. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={bulkDelete.isPending}
            >
              {bulkDelete.isPending ? "Deleting…" : `Delete ${checkedCount}`}
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
        <Input
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          placeholder="John Doe"
        />
      </div>
      <div className="space-y-1">
        <Label>Phone *</Label>
        <Input
          value={form.phone}
          onChange={(e) => onChange({ ...form, phone: e.target.value })}
          placeholder="+1234567890"
        />
      </div>
      <div className="space-y-1">
        <Label>Tags (comma separated)</Label>
        <Input
          value={form.tags}
          onChange={(e) => onChange({ ...form, tags: e.target.value })}
          placeholder="vip, customer, prospect"
        />
      </div>
      <div className="space-y-1">
        <Label>Notes</Label>
        <Input
          value={form.notes}
          onChange={(e) => onChange({ ...form, notes: e.target.value })}
          placeholder="Optional notes…"
        />
      </div>
    </div>
  );
}
