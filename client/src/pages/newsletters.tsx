import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Newspaper, Plus, Calendar, Send, Eye, Trash2, Mail, MessageSquare, Bell, CheckCircle2, AlertCircle, FileText } from "lucide-react";
import type { Newsletter } from "@shared/schema";

export default function NewslettersPage() {
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [viewNewsletter, setViewNewsletter] = useState<Newsletter | null>(null);
  const [selectedChannels, setSelectedChannels] = useState<string[]>(["email"]);
  const [selectedAudience, setSelectedAudience] = useState("all");

  const { data: newsletters = [], isLoading } = useQuery<Newsletter[]>({
    queryKey: ["/api/newsletters"],
  });

  const { data: recipientCounts } = useQuery<{ email: number; sms: number; inApp: number }>({
    queryKey: ["/api/newsletters/recipient-counts", selectedAudience],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/newsletters/recipient-counts?audience=${selectedAudience}`);
      return res.json();
    },
  });

  const createNewsletter = useMutation({
    mutationFn: async (data: Partial<Newsletter>) => {
      return apiRequest("POST", "/api/newsletters", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters"] });
      setIsAddOpen(false);
      setSelectedChannels(["email"]);
      setSelectedAudience("all");
      toast({ title: "Newsletter created" });
    },
    onError: () => {
      toast({ title: "Failed to create newsletter", variant: "destructive" });
    },
  });

  const updateNewsletter = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      return apiRequest("PUT", `/api/newsletters/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters"] });
      toast({ title: "Newsletter updated" });
    },
  });

  const deleteNewsletter = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/newsletters/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters"] });
      toast({ title: "Newsletter deleted" });
    },
  });

  const toggleChannel = (channel: string) => {
    setSelectedChannels(prev =>
      prev.includes(channel)
        ? prev.filter(c => c !== channel)
        : [...prev, channel]
    );
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (selectedChannels.length === 0) {
      toast({ title: "Please select at least one channel", variant: "destructive" });
      return;
    }
    const formData = new FormData(e.currentTarget);
    createNewsletter.mutate({
      title: formData.get("title") as string,
      content: formData.get("content") as string,
      targetAudience: selectedAudience,
      channels: selectedChannels,
      status: "draft",
    });
  };

  const formatDate = (date: string | null) => {
    if (!date) return "Not published";
    return new Date(date).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "published":
        return "default";
      case "sent":
        return "secondary";
      default:
        return "outline";
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <FileText className="h-8 w-8" style={{ color: "#1b2a5c" }} />
          <div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }} data-testid="text-page-title">Newsletters</h1>
            <p className="text-muted-foreground">School announcements and communications</p>
          </div>
        </div>
        <Dialog open={isAddOpen} onOpenChange={(open) => {
          setIsAddOpen(open);
          if (!open) {
            setSelectedChannels(["email"]);
            setSelectedAudience("all");
          }
        }}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-newsletter">
              <Plus className="h-4 w-4 mr-2" />
              New Newsletter
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Newsletter</DialogTitle>
              <DialogDescription>Compose a new newsletter for parents and students</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input id="title" name="title" required data-testid="input-newsletter-title" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="targetAudience">Target Audience</Label>
                <Select value={selectedAudience} onValueChange={setSelectedAudience}>
                  <SelectTrigger data-testid="select-audience">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Everyone</SelectItem>
                    <SelectItem value="parents">Parents Only</SelectItem>
                    <SelectItem value="students">Students Only</SelectItem>
                    <SelectItem value="staff">Staff Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="content">Content</Label>
                <Textarea
                  id="content"
                  name="content"
                  rows={8}
                  required
                  placeholder="Write your newsletter content here..."
                  data-testid="input-newsletter-content"
                />
              </div>

              <div className="space-y-3">
                <Label>Select Channels</Label>
                <div className="space-y-2">
                  <Card
                    className={`cursor-pointer transition-colors ${selectedChannels.includes("email") ? "border-primary/50 bg-primary/5" : ""}`}
                    onClick={() => toggleChannel("email")}
                    data-testid="channel-email"
                  >
                    <CardContent className="flex items-center gap-3 p-3">
                      <Checkbox
                        checked={selectedChannels.includes("email")}
                        onClick={(e) => e.stopPropagation()}
                        onCheckedChange={() => toggleChannel("email")}
                        data-testid="checkbox-email"
                      />
                      <Mail className="h-5 w-5 text-muted-foreground" />
                      <span className="font-medium flex-1">Email</span>
                      <span className="text-sm text-muted-foreground">
                        ({recipientCounts?.email ?? 0} recipients)
                      </span>
                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    </CardContent>
                  </Card>

                  <Card
                    className={`cursor-pointer transition-colors ${selectedChannels.includes("sms") ? "border-primary/50 bg-primary/5" : ""}`}
                    onClick={() => toggleChannel("sms")}
                    data-testid="channel-sms"
                  >
                    <CardContent className="flex items-center gap-3 p-3">
                      <Checkbox
                        checked={selectedChannels.includes("sms")}
                        onClick={(e) => e.stopPropagation()}
                        onCheckedChange={() => toggleChannel("sms")}
                        data-testid="checkbox-sms"
                      />
                      <MessageSquare className="h-5 w-5 text-muted-foreground" />
                      <span className="font-medium flex-1">SMS</span>
                      <span className="text-sm text-muted-foreground">
                        ({recipientCounts?.sms ?? 0} recipients)
                      </span>
                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    </CardContent>
                  </Card>

                  <Card
                    className={`cursor-pointer transition-colors ${selectedChannels.includes("in_app") ? "border-primary/50 bg-primary/5" : ""}`}
                    onClick={() => toggleChannel("in_app")}
                    data-testid="channel-in-app"
                  >
                    <CardContent className="flex items-center gap-3 p-3">
                      <Checkbox
                        checked={selectedChannels.includes("in_app")}
                        onClick={(e) => e.stopPropagation()}
                        onCheckedChange={() => toggleChannel("in_app")}
                        data-testid="checkbox-in-app"
                      />
                      <Bell className="h-5 w-5 text-muted-foreground" />
                      <span className="font-medium flex-1">In-App</span>
                      <span className="text-sm text-muted-foreground">
                        ({recipientCounts?.inApp ?? 0} recipients)
                      </span>
                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    </CardContent>
                  </Card>

                  <Card className="opacity-60 cursor-not-allowed" data-testid="channel-whatsapp">
                    <CardContent className="flex items-center gap-3 p-3">
                      <Checkbox disabled data-testid="checkbox-whatsapp" />
                      <MessageSquare className="h-5 w-5 text-muted-foreground" />
                      <span className="font-medium flex-1">WhatsApp</span>
                      <div className="flex items-center gap-1.5 text-amber-500">
                        <AlertCircle className="h-4 w-4" />
                        <span className="text-sm font-medium">Coming Soon</span>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={createNewsletter.isPending || selectedChannels.length === 0} data-testid="button-submit-newsletter">
                Save as Draft
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {newsletters.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Newspaper className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Newsletters Yet</h3>
            <p className="text-muted-foreground">Create your first newsletter to communicate with parents and students</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {newsletters.map((newsletter) => (
            <Card key={newsletter.id} className="hover-elevate" data-testid={`card-newsletter-${newsletter.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <Badge variant={getStatusColor(newsletter.status)}>{newsletter.status}</Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteNewsletter.mutate(newsletter.id)}
                    data-testid={`button-delete-newsletter-${newsletter.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <CardTitle className="text-lg mt-2">{newsletter.title}</CardTitle>
                <CardDescription className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {formatDate(newsletter.publishDate)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground line-clamp-3 mb-4">
                  {newsletter.content}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline">{newsletter.targetAudience || "All"}</Badge>
                  {newsletter.channels?.map((ch) => (
                    <Badge key={ch} variant="secondary">{ch === "in_app" ? "In-App" : ch.toUpperCase()}</Badge>
                  ))}
                </div>
                <div className="flex gap-2 mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setViewNewsletter(newsletter)}
                    data-testid={`button-view-${newsletter.id}`}
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    View
                  </Button>
                  {newsletter.status === "draft" && (
                    <Button
                      size="sm"
                      onClick={() => updateNewsletter.mutate({ id: newsletter.id, status: "published" })}
                      data-testid={`button-publish-${newsletter.id}`}
                    >
                      <Send className="h-4 w-4 mr-1" />
                      Publish
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!viewNewsletter} onOpenChange={() => setViewNewsletter(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewNewsletter?.title}</DialogTitle>
            <DialogDescription>
              Published: {formatDate(viewNewsletter?.publishDate || null)}
            </DialogDescription>
          </DialogHeader>
          <div className="prose prose-sm max-w-none">
            <p className="whitespace-pre-wrap">{viewNewsletter?.content}</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
