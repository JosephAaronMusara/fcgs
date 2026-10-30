import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell, CheckCheck, Mail, MessageSquare, Megaphone } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Notification {
  id: number;
  userId: number;
  title: string;
  message: string;
  type: string;
  channel?: string;
  isRead: boolean;
  createdAt: string;
}

const channelIcon = (channel?: string) => {
  switch (channel) {
    case "email": return Mail;
    case "sms": return MessageSquare;
    case "newsletter": return Megaphone;
    default: return Bell;
  }
};

export default function MyNotificationsPage() {
  const { data: notifications, isLoading } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/notifications/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/notifications/read-all");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const unreadCount = notifications?.filter(n => !n.isRead).length || 0;

  if (isLoading) {
    return (
      <div className="p-3 sm:p-4 lg:p-6 space-y-6">
        <Skeleton className="h-10 w-48" />
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20 w-full" />)}
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-notifications-title">Notifications</h1>
          <p className="text-muted-foreground">
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount > 1 ? "s" : ""}` : "All caught up"}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}
            data-testid="button-mark-all-read"
          >
            <CheckCheck className="w-4 h-4 mr-2" />
            Mark All Read
          </Button>
        )}
      </div>

      {notifications && notifications.length > 0 ? (
        <div className="space-y-3">
          {notifications.map(notification => {
            const ChannelIcon = channelIcon(notification.channel);
            return (
              <Card
                key={notification.id}
                className={`cursor-pointer hover-elevate ${!notification.isRead ? "border-primary/30" : ""}`}
                onClick={() => {
                  if (!notification.isRead) markReadMutation.mutate(notification.id);
                }}
                data-testid={`card-notification-${notification.id}`}
              >
                <CardContent className="py-4">
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 shrink-0 ${!notification.isRead ? "text-primary" : "text-muted-foreground"}`}>
                      <ChannelIcon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`font-medium ${!notification.isRead ? "" : "text-muted-foreground"}`}>
                          {notification.title}
                        </span>
                        {!notification.isRead && <Badge variant="default">New</Badge>}
                        {notification.channel && (
                          <Badge variant="outline" className="text-xs capitalize">{notification.channel}</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">{notification.message}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(notification.createdAt).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Bell className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No notifications yet.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
