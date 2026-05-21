import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Mail, MessageSquare, MessageCircle, Bell, AlertCircle, CheckCircle } from "lucide-react";

interface NotifyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientType: "staff" | "student" | "parent";
  recipients: Array<{ id: number; name: string; email?: string | null; phone?: string | null }>;
  schoolId?: number | null;
}

type CommunicationStatus = {
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
  in_app: boolean;
};

type ChannelType = "email" | "sms" | "in_app" | "whatsapp";

export function NotifyModal({ open, onOpenChange, recipientType, recipients, schoolId }: NotifyModalProps) {
  const { toast } = useToast();
  const [selectedChannels, setSelectedChannels] = useState<Set<ChannelType>>(() => new Set<ChannelType>(["email"]));
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const { data: status } = useQuery<CommunicationStatus>({
    queryKey: ["/api/communication/status"],
    enabled: open,
  });

  const sendNotification = useMutation({
    mutationFn: async (data: { channels: string[]; recipientType: string; recipientIds: number[]; subject?: string; message: string; schoolId?: number }) => {
      return apiRequest("POST", "/api/communication/send", data);
    },
    onSuccess: async (response) => {
      const result = await response.json();
      toast({
        title: result.queued ? "Notification queued" : "Notification sent",
        description: result.message || `Sent: ${result.sent}, Failed: ${result.failed}`,
      });
      onOpenChange(false);
      setSubject("");
      setMessage("");
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to send",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const toggleChannel = (channel: ChannelType) => {
    const newChannels = new Set<ChannelType>(selectedChannels);
    if (newChannels.has(channel)) {
      newChannels.delete(channel);
    } else {
      newChannels.add(channel);
    }
    setSelectedChannels(newChannels);
  };

  const handleSend = () => {
    if (!message.trim()) {
      toast({ title: "Please enter a message", variant: "destructive" });
      return;
    }
    if (selectedChannels.has("email") && !subject.trim()) {
      toast({ title: "Please enter a subject for email", variant: "destructive" });
      return;
    }
    if (selectedChannels.size === 0) {
      toast({ title: "Please select at least one channel", variant: "destructive" });
      return;
    }

    const channels = Array.from(selectedChannels).filter(ch => ch !== "whatsapp");
    if (channels.length === 0) {
      toast({ title: "No available channels selected", variant: "destructive" });
      return;
    }

    sendNotification.mutate({
      channels,
      recipientType,
      recipientIds: recipients.map(r => r.id),
      subject: selectedChannels.has("email") ? subject : undefined,
      message,
      schoolId: schoolId || undefined,
    });
  };

  const emailRecipients = recipients.filter(r => r.email);
  const smsRecipients = recipients.filter(r => r.phone);

  const canSend = () => {
    if (selectedChannels.size === 0) return false;
    const activeChannels = Array.from(selectedChannels).filter(ch => ch !== "whatsapp");
    if (activeChannels.length === 0) return false;
    if (selectedChannels.has("email") && (!status?.email || emailRecipients.length === 0)) return false;
    if (selectedChannels.has("sms") && (!status?.sms || smsRecipients.length === 0)) return false;
    return true;
  };

  const getButtonText = () => {
    const channels = Array.from(selectedChannels).filter(ch => ch !== "whatsapp");
    if (channels.length === 0) return "Send";
    if (channels.length === 1) {
      if (channels[0] === "email") return "Send Email";
      if (channels[0] === "sms") return "Send SMS";
      if (channels[0] === "in_app") return "Send In-App";
    }
    return "Send All";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Send Notification
          </DialogTitle>
          <DialogDescription>
            Send a message to {recipients.length} selected {recipientType}{recipients.length !== 1 ? "s" : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-3">
            <Label>Select Channels</Label>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 p-3 rounded-lg border">
                <Checkbox
                  id="channel-email"
                  checked={selectedChannels.has("email")}
                  onCheckedChange={() => toggleChannel("email")}
                  disabled={!status?.email}
                  data-testid="checkbox-email"
                />
                <Label htmlFor="channel-email" className="flex items-center gap-2 flex-1 cursor-pointer">
                  <Mail className="h-4 w-4" />
                  Email
                  <span className="text-xs text-muted-foreground">
                    ({emailRecipients.length} recipients)
                  </span>
                </Label>
                {status?.email ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-yellow-500" />
                )}
              </div>

              <div className="flex items-center gap-3 p-3 rounded-lg border">
                <Checkbox
                  id="channel-sms"
                  checked={selectedChannels.has("sms")}
                  onCheckedChange={() => toggleChannel("sms")}
                  disabled={!status?.sms}
                  data-testid="checkbox-sms"
                />
                <Label htmlFor="channel-sms" className="flex items-center gap-2 flex-1 cursor-pointer">
                  <MessageSquare className="h-4 w-4" />
                  SMS
                  <span className="text-xs text-muted-foreground">
                    ({smsRecipients.length} recipients)
                  </span>
                </Label>
                {status?.sms ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-yellow-500" />
                )}
              </div>

              <div className="flex items-center gap-3 p-3 rounded-lg border">
                <Checkbox
                  id="channel-in-app"
                  checked={selectedChannels.has("in_app")}
                  onCheckedChange={() => toggleChannel("in_app")}
                  data-testid="checkbox-in-app"
                />
                <Label htmlFor="channel-in-app" className="flex items-center gap-2 flex-1 cursor-pointer">
                  <Bell className="h-4 w-4" />
                  In-App
                  <span className="text-xs text-muted-foreground">
                    ({recipients.length} recipients)
                  </span>
                </Label>
                <CheckCircle className="h-4 w-4 text-green-500" />
              </div>

              <div className="flex items-center gap-3 p-3 rounded-lg border opacity-60">
                <Checkbox
                  id="channel-whatsapp"
                  checked={false}
                  disabled
                  data-testid="checkbox-whatsapp"
                />
                <Label htmlFor="channel-whatsapp" className="flex items-center gap-2 flex-1 cursor-not-allowed">
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp
                </Label>
                <div className="flex items-center gap-1.5">
                  <div className="flex items-center justify-center w-4 h-4 rounded-full bg-yellow-500 text-white text-xs font-bold">
                    !
                  </div>
                  <span className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">Coming Soon</span>
                </div>
              </div>
            </div>
          </div>

          {selectedChannels.has("email") && (
            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Enter email subject"
                data-testid="input-email-subject"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="message">Message</Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Enter your message..."
              rows={5}
              data-testid="input-message"
            />
            {selectedChannels.has("sms") && !selectedChannels.has("email") && (
              <div className="text-xs text-muted-foreground text-right">
                {message.length} / 160 characters (standard SMS)
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={sendNotification.isPending || !canSend()}
            data-testid="button-send-notification"
          >
            {sendNotification.isPending ? "Sending..." : getButtonText()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
