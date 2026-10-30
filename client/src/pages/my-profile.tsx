import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/lib/auth";
import { User, School, Mail, Phone, MapPin, Calendar, GraduationCap, Users } from "lucide-react";

export default function MyProfilePage() {
  const { user } = useAuth();

  const { data: studentProfile, isLoading: loadingStudent } = useQuery<any>({
    queryKey: ["/api/me/student-profile"],
    enabled: user?.role === "student",
  });

  const { data: parentProfile, isLoading: loadingParent } = useQuery<any>({
    queryKey: ["/api/me/parent-profile"],
    enabled: user?.role === "parent",
  });

  const isLoading = user?.role === "student" ? loadingStudent : loadingParent;
  const profile = user?.role === "student" ? studentProfile : parentProfile;

  if (isLoading) {
    return (
      <div className="p-3 sm:p-4 lg:p-6 space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="p-4 sm:p-6">
        <Card>
          <CardContent className="py-12 text-center">
            <User className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">Profile not found.</p>
            <p className="text-sm text-muted-foreground mt-2">Please contact your school administrator.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const initials = `${profile.firstName?.[0] || ""}${profile.lastName?.[0] || ""}`;

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-my-profile-title">My Profile</h1>
        <p className="text-muted-foreground">Your personal information</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-6 mb-6">
            <Avatar className="w-20 h-20">
              <AvatarFallback className="text-2xl bg-primary/10 text-primary">{initials}</AvatarFallback>
            </Avatar>
            <div>
              <h2 className="text-2xl font-bold" data-testid="text-profile-name">
                {profile.firstName} {profile.lastName}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className="capitalize">{user?.role}</Badge>
                {user?.role === "student" && profile.admissionNo && (
                  <Badge variant="outline" className="font-mono">{profile.admissionNo}</Badge>
                )}
                {user?.role === "student" && (
                  <Badge variant={profile.status === "active" ? "default" : "secondary"}>
                    {profile.status}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <InfoSection title="Personal Information">
              {profile.email && (
                <InfoRow icon={Mail} label="Email" value={profile.email} />
              )}
              {profile.phone && (
                <InfoRow icon={Phone} label="Phone" value={profile.phone} />
              )}
              {(profile.address || profile.streetAddress || profile.residentialArea) && (
                <InfoRow
                  icon={MapPin}
                  label="Address"
                  value={[profile.streetAddress, profile.residentialArea, profile.address].filter(Boolean).join(", ")}
                />
              )}
              {user?.role === "student" && profile.gender && (
                <InfoRow icon={User} label="Gender" value={profile.gender.charAt(0).toUpperCase() + profile.gender.slice(1)} />
              )}
              {user?.role === "student" && profile.dateOfBirth && (
                <InfoRow
                  icon={Calendar}
                  label="Date of Birth"
                  value={new Date(profile.dateOfBirth).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                />
              )}
            </InfoSection>

            <InfoSection title="Academic Information">
              {user?.role === "student" && (
                <>
                  {profile.className && (
                    <InfoRow icon={School} label="Class" value={profile.className} />
                  )}
                  {profile.enrollmentDate && (
                    <InfoRow
                      icon={Calendar}
                      label="Enrolled"
                      value={new Date(profile.enrollmentDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                    />
                  )}
                  {profile.parentName && (
                    <InfoRow icon={Users} label="Parent/Guardian" value={profile.parentName} />
                  )}
                  {profile.isBoarding && (
                    <InfoRow icon={GraduationCap} label="Boarding" value="Yes" />
                  )}
                </>
              )}
              {user?.role === "parent" && (
                <>
                  {profile.occupation && (
                    <InfoRow icon={User} label="Occupation" value={profile.occupation} />
                  )}
                  {profile.relationship && (
                    <InfoRow icon={Users} label="Relationship" value={profile.relationship.charAt(0).toUpperCase() + profile.relationship.slice(1)} />
                  )}
                </>
              )}
            </InfoSection>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-semibold text-lg mb-3">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="font-medium">{value}</p>
      </div>
    </div>
  );
}
