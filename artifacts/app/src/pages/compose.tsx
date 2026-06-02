import { useState } from "react";
import {
  useComposeMessage,
  useListTemplates,
  useCreateTemplate,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Copy, Save, RefreshCw, FileText } from "lucide-react";

const TONES = ["professional", "friendly", "urgent", "casual", "formal"];
const PURPOSES = [
  "community announcement",
  "event invitation",
  "product promotion",
  "welcome message",
  "follow-up",
  "survey request",
  "exclusive offer",
];

export default function Compose() {
  const generateMessage = useComposeMessage();
  const { data: templates, isLoading: isLoadingTemplates } = useListTemplates();
  const saveTemplate = useCreateTemplate();
  const { toast } = useToast();

  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState("professional");
  const [purpose, setPurpose] = useState("community announcement");
  const [generatedMessage, setGeneratedMessage] = useState("");
  const [showSave, setShowSave] = useState(false);
  const [templateName, setTemplateName] = useState("");

  function handleGenerate() {
    if (!topic) {
      toast({ title: "Please enter a topic", variant: "destructive" });
      return;
    }
    generateMessage.mutate(
      { data: { topic, tone, purpose } },
      {
        onSuccess: (res) => {
          setGeneratedMessage(res.message ?? "");
        },
        onError: () => toast({ title: "Failed to generate message", variant: "destructive" }),
      }
    );
  }

  function handleCopy() {
    navigator.clipboard.writeText(generatedMessage);
    toast({ title: "Copied to clipboard!" });
  }

  function handleSave() {
    if (!templateName || !generatedMessage) return;
    saveTemplate.mutate(
      {
        data: {
          name: templateName,
          content: generatedMessage,
          tone,
          purpose,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Template saved!" });
          setShowSave(false);
          setTemplateName("");
        },
        onError: () => toast({ title: "Failed to save template", variant: "destructive" }),
      }
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">AI Compose</h1>
        <p className="text-muted-foreground mt-1">Generate WhatsApp-ready messages with AI assistance.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Generator */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              Message Generator
            </CardTitle>
            <CardDescription>Describe what you want to say and let AI craft the perfect message.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label>Topic / Context *</Label>
              <Textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Invite members to our weekly Saturday meetup at Central Park at 10am..."
                className="min-h-[80px] resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Tone</Label>
                <Select value={tone} onValueChange={setTone}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TONES.map((t) => (
                      <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Purpose</Label>
                <Select value={purpose} onValueChange={setPurpose}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PURPOSES.map((p) => (
                      <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button className="w-full" onClick={handleGenerate} disabled={generateMessage.isPending}>
              {generateMessage.isPending ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Generating...</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" />Generate Message</>
              )}
            </Button>

            {generatedMessage && (
              <div className="space-y-2">
                <Label>Generated Message</Label>
                <Textarea
                  value={generatedMessage}
                  onChange={(e) => setGeneratedMessage(e.target.value)}
                  className="min-h-[150px] resize-none font-medium"
                />
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleCopy}>
                    <Copy className="w-4 h-4 mr-1" /> Copy
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowSave(true)}>
                    <Save className="w-4 h-4 mr-1" /> Save as Template
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleGenerate} disabled={generateMessage.isPending}>
                    <RefreshCw className="w-4 h-4 mr-1" /> Regenerate
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Templates */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Saved Templates
            </CardTitle>
            <CardDescription>Reuse previously saved messages.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingTemplates ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}
              </div>
            ) : (templates ?? []).length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">
                <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>No templates yet. Generate and save a message.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {(templates ?? []).map((t) => (
                  <div key={t.id} className="border border-border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-sm">{t.name}</p>
                      <div className="flex gap-1">
                        {t.tone && <Badge variant="secondary" className="text-xs capitalize">{t.tone}</Badge>}
                        {t.purpose && <Badge variant="outline" className="text-xs capitalize">{t.purpose}</Badge>}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-3">{t.content}</p>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-full"
                      onClick={() => {
                        setGeneratedMessage(t.content ?? "");
                        toast({ title: "Template loaded" });
                      }}
                    >
                      <Copy className="w-3 h-3 mr-1" /> Use This Template
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Save Template Dialog */}
      <Dialog open={showSave} onOpenChange={setShowSave}>
        <DialogContent>
          <DialogHeader><DialogTitle>Save as Template</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Template Name *</Label>
              <Input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g. Weekend Meetup Invite"
              />
            </div>
            <div className="space-y-1">
              <Label>Preview</Label>
              <p className="text-sm text-muted-foreground bg-muted rounded p-3 line-clamp-4">{generatedMessage}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSave(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saveTemplate.isPending || !templateName}>
              {saveTemplate.isPending ? "Saving..." : "Save Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
