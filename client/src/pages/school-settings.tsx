import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, schoolFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useUpload } from "@/hooks/use-upload";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Building2, Settings, Save, School, Shield, Plus, Pencil, Trash2, Users, Lock, ChevronDown, ChevronRight, ChevronLeft, Calendar, Clock, Upload, ImageIcon, Stamp, User, Mail, Phone, MapPin, FileText, GraduationCap, BookOpen, Download, Filter, ClipboardList, Search, ArrowLeft, ArrowRight, AlertTriangle } from "lucide-react";
import type { School as SchoolType, ActivityLog } from "@shared/schema";

function normalizeSchoolType(value?: string | null): "primary" | "secondary" {
  const normalized = (value ?? "").toString().trim().toLowerCase();
  return normalized.startsWith("primary") ? "primary" : "secondary";
}

function getCurrentHarareTime(): string {
  return new Date().toLocaleString("en-US", {
    timeZone: "Africa/Harare",
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }) + " (CAT)";
}

export default function SchoolSettingsPage() {
  const { toast } = useToast();
  const { currentSchoolId, user } = useAuth();
  const [school, setSchool] = useState<SchoolType | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingFeatures, setIsEditingFeatures] = useState(false);
  const [isEditingBranding, setIsEditingBranding] = useState(false);
  const [brandingValues, setBrandingValues] = useState({ motto: "", logo: "", stamp: "" });
  
  // Form values for edit mode
  const [formValues, setFormValues] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    latitude: "",
    longitude: "",
    principalName: "",
    principalEmail: "",
    principalPhone: "",
    callCentrePhone: "",
    callCentreWhatsApp: "",
  });
  
  // Feature toggle values for edit mode
  const [featureValues, setFeatureValues] = useState({
    enableFinance: true,
    enableELibrary: false,
    enablePOS: false,
    enableELogbook: false,
    enableESchemes: false,
    enableHostel: false,
    enableTransport: false,
  });

  const { data: schools = [], isLoading } = useQuery<SchoolType[]>({
    queryKey: ["/api/schools"],
  });

  // Auto-select the current school
  useEffect(() => {
    if (schools.length > 0 && currentSchoolId) {
      const foundSchool = schools.find(s => s.id === currentSchoolId);
      if (foundSchool) {
        setSchool(foundSchool);
      }
    } else if (schools.length > 0 && user?.schoolId) {
      const foundSchool = schools.find(s => s.id === user.schoolId);
      if (foundSchool) {
        setSchool(foundSchool);
      }
    } else if (schools.length === 1) {
      setSchool(schools[0]);
    }
  }, [schools, currentSchoolId, user?.schoolId]);

  // Sync form values when school changes
  useEffect(() => {
    if (school) {
      setFormValues({
        name: school.name || "",
        email: school.email || "",
        phone: school.phone || "",
        address: school.address || "",
        latitude: school.latitude || "",
        longitude: school.longitude || "",
        principalName: school.principalName || "",
        principalEmail: school.principalEmail || "",
        principalPhone: school.principalPhone || "",
        callCentrePhone: school.callCentrePhone || "",
        callCentreWhatsApp: school.callCentreWhatsApp || "",
      });
      setFeatureValues({
        enableFinance: school.enableFinance !== false,
        enableELibrary: school.enableELibrary || false,
        enablePOS: school.enablePOS || false,
        enableELogbook: school.enableELogbook || false,
        enableESchemes: school.enableESchemes || false,
        enableHostel: school.enableHostel || false,
        enableTransport: school.enableTransport || false,
      });
    }
  }, [school]);

  const updateSchool = useMutation({
    mutationFn: async (data: Partial<SchoolType>) => {
      return apiRequest("PUT", `/api/schools/${school?.id}`, data);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/schools"] });
      queryClient.invalidateQueries({ queryKey: [`/api/schools/${school?.id}`] });
      if (variables.schoolType) {
        queryClient.invalidateQueries({ predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === "string" && key.startsWith("/api/streams");
        }});
      }
      if (school) {
        setSchool({ ...school, ...variables });
      }
      toast({ title: "Settings saved successfully" });
    },
    onError: () => {
      toast({ title: "Failed to save settings", variant: "destructive" });
    },
  });

  const handleToggle = (field: keyof typeof featureValues, value: boolean) => {
    setFeatureValues(prev => ({ ...prev, [field]: value }));
  };
  
  const handleSaveFeatures = () => {
    if (!school) return;
    updateSchool.mutate({
      enableFinance: featureValues.enableFinance,
      enableELibrary: featureValues.enableELibrary,
      enablePOS: featureValues.enablePOS,
      enableELogbook: featureValues.enableELogbook,
      enableESchemes: featureValues.enableESchemes,
      enableHostel: featureValues.enableHostel,
      enableTransport: featureValues.enableTransport,
    });
    setIsEditingFeatures(false);
  };
  
  const handleCancelFeatures = () => {
    if (school) {
      setFeatureValues({
        enableFinance: school.enableFinance !== false,
        enableELibrary: school.enableELibrary || false,
        enablePOS: school.enablePOS || false,
        enableELogbook: school.enableELogbook || false,
        enableESchemes: school.enableESchemes || false,
        enableHostel: school.enableHostel || false,
        enableTransport: school.enableTransport || false,
      });
    }
    setIsEditingFeatures(false);
  };

  const handleSaveGeneral = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    updateSchool.mutate({
      name: formValues.name,
      address: formValues.address,
      latitude: formValues.latitude || null,
      longitude: formValues.longitude || null,
      phone: formValues.phone,
      email: formValues.email,
      principalName: formValues.principalName,
      principalEmail: formValues.principalEmail,
      principalPhone: formValues.principalPhone,
      callCentrePhone: formValues.callCentrePhone,
      callCentreWhatsApp: formValues.callCentreWhatsApp,
    }, {
      onSuccess: () => {
        setIsEditing(false);
      }
    });
  };

  const handleCancelEdit = () => {
    if (school) {
      setFormValues({
        name: school.name || "",
        email: school.email || "",
        phone: school.phone || "",
        address: school.address || "",
        latitude: school.latitude || "",
        longitude: school.longitude || "",
        principalName: school.principalName || "",
        principalEmail: school.principalEmail || "",
        principalPhone: school.principalPhone || "",
        callCentrePhone: school.callCentrePhone || "",
        callCentreWhatsApp: school.callCentreWhatsApp || "",
      });
    }
    setIsEditing(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!school) {
    return (
      <div className="text-center py-12">
        <School className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">No School Found</h2>
        <p className="text-muted-foreground">Contact your organization administrator to add schools.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* School Header with Logo, Name, Address, Contact */}
      <Card className="overflow-hidden">
        <div className="flex flex-col md:flex-row gap-6 p-6">
          <div className="flex-shrink-0 flex items-center justify-center">
            {school.logo ? (
              <Avatar className="h-24 w-24 rounded-lg">
                <AvatarImage src={school.logo} alt={school.name} className="object-cover" />
                <AvatarFallback className="rounded-lg text-2xl">
                  {school.name.substring(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            ) : (
              <div className="h-24 w-24 rounded-lg bg-muted flex items-center justify-center">
                <Building2 className="h-12 w-12 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="flex-1 space-y-2">
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-school-name">{school.name}</h1>
            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
              {school.address && (
                <div className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  <span data-testid="text-school-address">{school.address}</span>
                </div>
              )}
              {school.phone && (
                <div className="flex items-center gap-1">
                  <Phone className="h-4 w-4" />
                  <span data-testid="text-school-phone">{school.phone}</span>
                </div>
              )}
              {school.email && (
                <div className="flex items-center gap-1">
                  <Mail className="h-4 w-4" />
                  <span data-testid="text-school-email">{school.email}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      <Tabs defaultValue="general" className="space-y-4">
        <TabsList className="mx-auto flex w-fit" data-testid="tabs-settings">
          <TabsTrigger value="general" data-testid="tab-general">
            <Building2 className="h-4 w-4 mr-1" />
            School Information
          </TabsTrigger>
          <TabsTrigger value="features" data-testid="tab-features">
            <Settings className="h-4 w-4 mr-1" />
            Features
          </TabsTrigger>
          <TabsTrigger value="academic" data-testid="tab-academic">
            <GraduationCap className="h-4 w-4 mr-1" />
            Academic
          </TabsTrigger>
          <TabsTrigger value="activity-logs" data-testid="tab-activity-logs">
            <ClipboardList className="h-4 w-4 mr-1" />
            Activity Logs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <div className="space-y-6">
            {/* Logo and Stamp Upload Section */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <div>
                  <CardTitle>School Branding</CardTitle>
                  <CardDescription>Upload your school logo and official stamp</CardDescription>
                </div>
                {!isEditingBranding && (
                  <Button variant="outline" onClick={() => {
                    setBrandingValues({
                      motto: school.motto || "",
                      logo: school.logo || "",
                      stamp: school.stamp || "",
                    });
                    setIsEditingBranding(true);
                  }} data-testid="button-edit-branding">
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                <div className="grid gap-6 md:grid-cols-2">
                  <ImageUploadSection
                    label="School Logo"
                    description="Upload a logo image that will appear on documents and reports"
                    currentImage={isEditingBranding ? brandingValues.logo : school.logo}
                    onUploadComplete={(url) => {
                      setBrandingValues(prev => ({ ...prev, logo: url }));
                    }}
                    icon={<ImageIcon className="h-8 w-8 text-muted-foreground" />}
                    testIdPrefix="logo"
                    disabled={!isEditingBranding}
                  />
                  <ImageUploadSection
                    label="School Stamp"
                    description="Upload the official school stamp image"
                    currentImage={isEditingBranding ? brandingValues.stamp : school.stamp}
                    onUploadComplete={(url) => {
                      setBrandingValues(prev => ({ ...prev, stamp: url }));
                    }}
                    icon={<Stamp className="h-8 w-8 text-muted-foreground" />}
                    testIdPrefix="stamp"
                    disabled={!isEditingBranding}
                  />
                </div>
                <div className="mt-4 space-y-2">
                  <Label htmlFor="motto">School Motto</Label>
                  <Input
                    id="motto"
                    placeholder="Enter school motto"
                    value={isEditingBranding ? brandingValues.motto : (school.motto || "")}
                    disabled={!isEditingBranding}
                    onChange={(e) => {
                      setBrandingValues(prev => ({ ...prev, motto: e.target.value }));
                    }}
                    data-testid="input-motto"
                  />
                  <p className="text-xs text-muted-foreground">This appears on the dashboard and school documents</p>
                </div>
                {isEditingBranding && (
                  <div className="flex gap-2 pt-4 border-t mt-4">
                    <Button
                      type="button"
                      disabled={updateSchool.isPending}
                      onClick={() => {
                        updateSchool.mutate({
                          motto: brandingValues.motto,
                          logo: brandingValues.logo,
                          stamp: brandingValues.stamp,
                        }, {
                          onSuccess: () => {
                            setIsEditingBranding(false);
                          }
                        });
                      }}
                      data-testid="button-save-branding"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      Save Changes
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={updateSchool.isPending}
                      onClick={() => setIsEditingBranding(false)}
                      data-testid="button-cancel-branding"
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* School Details Form */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <div>
                  <CardTitle>School Details</CardTitle>
                  <CardDescription>Basic school information and contact details</CardDescription>
                </div>
                {!isEditing && (
                  <Button
                    variant="outline"
                    onClick={() => setIsEditing(true)}
                    data-testid="button-edit-details"
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSaveGeneral} className="space-y-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="name">School Name</Label>
                      <Input
                        id="name"
                        name="name"
                        value={formValues.name}
                        onChange={(e) => setFormValues({ ...formValues, name: e.target.value })}
                        disabled={!isEditing}
                        data-testid="input-school-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        value={formValues.email}
                        onChange={(e) => setFormValues({ ...formValues, email: e.target.value })}
                        disabled={!isEditing}
                        data-testid="input-school-email"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone">Phone</Label>
                      <Input
                        id="phone"
                        name="phone"
                        value={formValues.phone}
                        onChange={(e) => setFormValues({ ...formValues, phone: e.target.value })}
                        disabled={!isEditing}
                        data-testid="input-school-phone"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="address">Address</Label>
                      <Input
                        id="address"
                        name="address"
                        value={formValues.address}
                        onChange={(e) => setFormValues({ ...formValues, address: e.target.value })}
                        disabled={!isEditing}
                        data-testid="input-school-address"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="latitude">Latitude</Label>
                        <Input
                          id="latitude"
                          name="latitude"
                          placeholder="e.g., -17.8292"
                          value={formValues.latitude}
                          onChange={(e) => setFormValues({ ...formValues, latitude: e.target.value })}
                          disabled={!isEditing}
                          data-testid="input-school-latitude"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="longitude">Longitude</Label>
                        <Input
                          id="longitude"
                          name="longitude"
                          placeholder="e.g., 31.0522"
                          value={formValues.longitude}
                          onChange={(e) => setFormValues({ ...formValues, longitude: e.target.value })}
                          disabled={!isEditing}
                          data-testid="input-school-longitude"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Principal Information Section */}
                  <div className="border-t pt-6">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                      <User className="h-5 w-5" />
                      Principal Information
                    </h3>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="principalName">Principal Name</Label>
                        <Input
                          id="principalName"
                          name="principalName"
                          placeholder="Enter principal's full name"
                          value={formValues.principalName}
                          onChange={(e) => setFormValues({ ...formValues, principalName: e.target.value })}
                          disabled={!isEditing}
                          data-testid="input-principal-name"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="principalEmail">Principal Email</Label>
                        <Input
                          id="principalEmail"
                          name="principalEmail"
                          type="email"
                          placeholder="principal@school.com"
                          value={formValues.principalEmail}
                          onChange={(e) => setFormValues({ ...formValues, principalEmail: e.target.value })}
                          disabled={!isEditing}
                          data-testid="input-principal-email"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="principalPhone">Principal Phone</Label>
                        <Input
                          id="principalPhone"
                          name="principalPhone"
                          placeholder="+263..."
                          value={formValues.principalPhone}
                          onChange={(e) => setFormValues({ ...formValues, principalPhone: e.target.value })}
                          disabled={!isEditing}
                          data-testid="input-principal-phone"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-muted-foreground">Call Centre / SMS Contact</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="callCentrePhone">Call Centre Phone</Label>
                        <Input
                          id="callCentrePhone"
                          name="callCentrePhone"
                          placeholder="+263..."
                          value={formValues.callCentrePhone}
                          onChange={(e) => setFormValues({ ...formValues, callCentrePhone: e.target.value })}
                          disabled={!isEditing}
                          data-testid="input-call-centre-phone"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="callCentreWhatsApp">Call Centre WhatsApp</Label>
                        <Input
                          id="callCentreWhatsApp"
                          name="callCentreWhatsApp"
                          placeholder="+263..."
                          value={formValues.callCentreWhatsApp}
                          onChange={(e) => setFormValues({ ...formValues, callCentreWhatsApp: e.target.value })}
                          disabled={!isEditing}
                          data-testid="input-call-centre-whatsapp"
                        />
                      </div>
                    </div>
                  </div>

                  {isEditing && (
                    <div className="flex gap-2">
                      <Button type="submit" disabled={updateSchool.isPending} data-testid="button-save-general">
                        <Save className="h-4 w-4 mr-2" />
                        Save Changes
                      </Button>
                      <Button 
                        type="button" 
                        variant="outline" 
                        onClick={handleCancelEdit}
                        disabled={updateSchool.isPending}
                        data-testid="button-cancel-edit"
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </form>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="features">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle>Feature Toggles</CardTitle>
                <CardDescription>Enable or disable modules for this school</CardDescription>
              </div>
              {!isEditingFeatures && (
                <Button variant="outline" onClick={() => setIsEditingFeatures(true)} data-testid="button-edit-features">
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Accounting & Finance</Label>
                  <p className="text-sm text-muted-foreground">Student payments, expenses, incomes and financial reports</p>
                </div>
                <Switch
                  checked={featureValues.enableFinance}
                  onCheckedChange={(checked) => handleToggle("enableFinance", checked)}
                  disabled={!isEditingFeatures}
                  data-testid="switch-finance"
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>E-Library</Label>
                  <p className="text-sm text-muted-foreground">Digital resource library for students</p>
                </div>
                <Switch
                  checked={featureValues.enableELibrary}
                  onCheckedChange={(checked) => handleToggle("enableELibrary", checked)}
                  disabled={!isEditingFeatures}
                  data-testid="switch-elibrary"
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Point of Sale (POS)</Label>
                  <p className="text-sm text-muted-foreground">Sell school items with Sage export</p>
                </div>
                <Switch
                  checked={featureValues.enablePOS}
                  onCheckedChange={(checked) => handleToggle("enablePOS", checked)}
                  disabled={!isEditingFeatures}
                  data-testid="switch-pos"
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Staff Attendance</Label>
                  <p className="text-sm text-muted-foreground">Clock in/out with geofencing</p>
                </div>
                <Switch
                  checked={featureValues.enableELogbook}
                  onCheckedChange={(checked) => handleToggle("enableELogbook", checked)}
                  disabled={!isEditingFeatures}
                  data-testid="switch-elogbook"
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>E-Schemes</Label>
                  <p className="text-sm text-muted-foreground">Teaching schemes of work</p>
                </div>
                <Switch
                  checked={featureValues.enableESchemes}
                  onCheckedChange={(checked) => handleToggle("enableESchemes", checked)}
                  disabled={!isEditingFeatures}
                  data-testid="switch-eschemes"
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Boarding School</Label>
                  <p className="text-sm text-muted-foreground">Enable hostel roll call and boarding student management</p>
                </div>
                <Switch
                  checked={featureValues.enableHostel}
                  onCheckedChange={(checked) => handleToggle("enableHostel", checked)}
                  disabled={!isEditingFeatures}
                  data-testid="switch-hostel"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Transport</Label>
                  <p className="text-sm text-muted-foreground">Enable transport management for student commutes</p>
                </div>
                <Switch
                  checked={featureValues.enableTransport}
                  onCheckedChange={(checked) => handleToggle("enableTransport", checked)}
                  disabled={!isEditingFeatures}
                  data-testid="switch-transport"
                />
              </div>
              
              {isEditingFeatures && (
                <div className="pt-4 border-t flex gap-2">
                  <Button onClick={handleSaveFeatures} disabled={updateSchool.isPending} data-testid="button-save-features">
                    <Save className="h-4 w-4 mr-2" />
                    Save Features
                  </Button>
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={handleCancelFeatures}
                    disabled={updateSchool.isPending}
                    data-testid="button-cancel-features"
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="academic">
          <AcademicSettingsSection 
            school={school} 
            onUpdate={(data) => {
              updateSchool.mutate(data);
              setSchool({ ...school, ...data });
            }}
            isPending={updateSchool.isPending}
          />
        </TabsContent>

        <TabsContent value="activity-logs">
          <ActivityLogsSection schoolId={school?.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface AcademicSettingsProps {
  school: SchoolType;
  onUpdate: (data: Partial<SchoolType>) => void;
  isPending: boolean;
}

function AcademicSettingsSection({ school, onUpdate, isPending }: AcademicSettingsProps) {
  const [currentTime, setCurrentTime] = useState(getCurrentHarareTime());
  const [isEditingClassPosition, setIsEditingClassPosition] = useState(false);
  const [isEditingIdentity, setIsEditingIdentity] = useState(false);
  const [showClassPosition, setShowClassPosition] = useState(!!school.showClassPositionOnReports);
  const [draftSchoolType, setDraftSchoolType] = useState((school.schoolType || "secondary") as string);
  const [draftExamBoard, setDraftExamBoard] = useState(school.examinationBoard || "ZIMSEC");
  const [preEditWarningOpen, setPreEditWarningOpen] = useState(false);
  const [confirmSaveWarningOpen, setConfirmSaveWarningOpen] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(getCurrentHarareTime());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setDraftSchoolType((school.schoolType || "secondary") as string);
    setDraftExamBoard(school.examinationBoard || "ZIMSEC");
    setShowClassPosition(!!school.showClassPositionOnReports);
  }, [school.schoolType, school.examinationBoard, school.showClassPositionOnReports]);

  const hasIdentityChanges = draftSchoolType !== (school.schoolType || "secondary") || draftExamBoard !== (school.examinationBoard || "ZIMSEC");

  const handleSaveClassPosition = () => {
    onUpdate({ showClassPositionOnReports: showClassPosition });
    setIsEditingClassPosition(false);
  };

  const handleCancelClassPosition = () => {
    setShowClassPosition(!!school.showClassPositionOnReports);
    setIsEditingClassPosition(false);
  };

  const proceedToEditIdentity = () => {
    setPreEditWarningOpen(false);
    setIsEditingIdentity(true);
  };

  const handleSaveIdentity = () => {
    if (!hasIdentityChanges) {
      setIsEditingIdentity(false);
      return;
    }
    setConfirmSaveWarningOpen(true);
  };

  const handleConfirmSaveIdentity = () => {
    onUpdate({ schoolType: draftSchoolType, examinationBoard: draftExamBoard });
    setConfirmSaveWarningOpen(false);
    setIsEditingIdentity(false);
  };

  const handleCancelIdentity = () => {
    setDraftSchoolType((school.schoolType || "secondary") as string);
    setDraftExamBoard(school.examinationBoard || "ZIMSEC");
    setIsEditingIdentity(false);
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Academic Settings
            </CardTitle>
            <CardDescription>Manage academic settings and high-impact academic identity values for this school.</CardDescription>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted px-3 py-2 rounded-md">
              <Clock className="h-4 w-4" />
              <span data-testid="text-current-time">{currentTime}</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-lg border p-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="space-y-1">
                <Label className="text-base font-semibold">Show Class Position on Report Cards</Label>
                <p className="text-xs text-muted-foreground">
                  When enabled, report summaries include a class-based ranking column next to the overall stream position.
                </p>
              </div>
              {!isEditingClassPosition && (
                <Button variant="outline" onClick={() => setIsEditingClassPosition(true)} data-testid="button-edit-class-position">
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </Button>
              )}
            </div>
            <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border p-4 bg-muted/20">
              <div className="space-y-1">
                <div className="text-sm font-medium">Report Card Class Position</div>
                <div className="text-xs text-muted-foreground">{showClassPosition ? "Class Position is visible on report cards." : "Class Position is hidden on report cards."}</div>
              </div>
              <Switch
                checked={showClassPosition}
                onCheckedChange={setShowClassPosition}
                disabled={!isEditingClassPosition}
                data-testid="switch-show-class-position"
              />
            </div>
            {isEditingClassPosition && (
              <div className="pt-4 border-t mt-4 flex gap-2">
                <Button onClick={handleSaveClassPosition} disabled={isPending} data-testid="button-save-class-position">
                  <Save className="h-4 w-4 mr-2" />
                  Save
                </Button>
                <Button type="button" variant="outline" onClick={handleCancelClassPosition} disabled={isPending} data-testid="button-cancel-class-position">
                  Cancel
                </Button>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-amber-300 bg-amber-50/90 p-4 text-amber-950">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 mt-0.5 text-amber-700" />
              <div className="space-y-1">
                <p className="text-sm font-semibold">High-impact academic identity settings</p>
                <p className="text-xs leading-relaxed text-amber-900">
                  Changing School Type or Examination Board changes the school&apos;s academic processing identity. This can affect grading families, subject type availability, assessment and report comment categories, ECD routing, report-card logic, and grade/comment lookup behavior.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-red-300 bg-red-50/60 p-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="space-y-1">
                <Label className="text-base font-semibold text-red-900">Academic Identity</Label>
                <p className="text-xs text-red-900/80">
                  These values define the academic identity used by grading, comments, reports, and ECD processing for this school.
                </p>
              </div>
              {!isEditingIdentity && (
                <Button variant="outline" className="border-red-300 text-red-900 hover:bg-red-100" onClick={() => setPreEditWarningOpen(true)} data-testid="button-edit-academic-identity">
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </Button>
              )}
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-base font-semibold">School Type</Label>
                {isEditingIdentity ? (
                  <Select value={draftSchoolType} onValueChange={setDraftSchoolType}>
                    <SelectTrigger data-testid="select-school-type" className="max-w-sm bg-white">
                      <SelectValue placeholder="Select school type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="primary">Primary School</SelectItem>
                      <SelectItem value="secondary">Secondary School</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="rounded-md border bg-white px-3 py-2 text-sm" data-testid="text-school-type-readonly">
                    {normalizeSchoolType(school.schoolType) === "primary" ? "Primary School" : "Secondary School"}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-base font-semibold">Examination Board</Label>
                {isEditingIdentity ? (
                  <Select value={draftExamBoard} onValueChange={setDraftExamBoard}>
                    <SelectTrigger data-testid="select-exam-board" className="max-w-sm bg-white">
                      <SelectValue placeholder="Select board" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ZIMSEC">ZIMSEC</SelectItem>
                      <SelectItem value="Cambridge">Cambridge</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="rounded-md border bg-white px-3 py-2 text-sm" data-testid="text-exam-board-readonly">
                    {school.examinationBoard || "ZIMSEC"}
                  </div>
                )}
              </div>
            </div>

            {isEditingIdentity && (
              <div className="pt-4 border-t mt-4 flex gap-2">
                <Button onClick={handleSaveIdentity} disabled={isPending} className="bg-red-700 hover:bg-red-800 text-white" data-testid="button-save-academic-identity">
                  <Save className="h-4 w-4 mr-2" />
                  Save Academic Identity
                </Button>
                <Button type="button" variant="outline" onClick={handleCancelIdentity} disabled={isPending} data-testid="button-cancel-academic-identity">
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={preEditWarningOpen} onOpenChange={setPreEditWarningOpen}>
        <DialogContent className="border-red-500 bg-red-50/95">
          <DialogHeader>
            <DialogTitle className="text-red-900 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Critical Academic Configuration Warning
            </DialogTitle>
            <DialogDescription className="text-red-950 space-y-2">
              <span className="block">You are about to edit the school&apos;s academic identity.</span>
              <span className="block">Changing School Type and Examination Board affects grading-system families, subject type options, assessment and report comment categories, ECD assessment availability, report-card generation rules, and grade/comment lookup logic.</span>
              <span className="block font-semibold text-red-900">Existing academic records are not automatically migrated or rewritten when these settings change.</span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreEditWarningOpen(false)} data-testid="button-cancel-academic-warning">Cancel</Button>
            <Button className="bg-red-700 hover:bg-red-800 text-white" onClick={proceedToEditIdentity} data-testid="button-continue-edit-academic-warning">Continue to edit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmSaveWarningOpen} onOpenChange={setConfirmSaveWarningOpen}>
        <DialogContent className="border-red-600 bg-red-50/95">
          <DialogHeader>
            <DialogTitle className="text-red-900 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Confirm Critical Academic Configuration Change
            </DialogTitle>
            <DialogDescription className="text-red-950 space-y-2">
              <span className="block">You changed the school&apos;s academic identity.</span>
              <span className="block">Saving these changes will switch the academic processing context used for grading families, subject type rules, assessment and report comment categories, ECD routing, report-card logic, and grade/comment resolution for future operations.</span>
              <span className="block font-semibold text-red-900">This action does not migrate existing academic data.</span>
              <span className="block">Previously configured grades, subjects, comments, and reports may no longer align with the active academic configuration for this school.</span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmSaveWarningOpen(false)} data-testid="button-cancel-save-academic-warning">Cancel</Button>
            <Button className="bg-red-700 hover:bg-red-800 text-white" onClick={handleConfirmSaveIdentity} data-testid="button-confirm-save-academic-warning">Yes, save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface ImageUploadSectionProps {
  label: string;
  description: string;
  currentImage: string | null | undefined;
  onUploadComplete: (url: string) => void;
  icon: React.ReactNode;
  testIdPrefix: string;
  disabled?: boolean;
}

function ImageUploadSection({
  label,
  description,
  currentImage,
  onUploadComplete,
  icon,
  testIdPrefix,
  disabled = false,
}: ImageUploadSectionProps) {
  const { uploadFile, isUploading, error } = useUpload({
    onSuccess: (response) => {
      onUploadComplete(response.objectPath);
    },
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await uploadFile(file);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-base font-medium">{label}</Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-4">
        <div className="h-24 w-24 rounded-lg border-2 border-dashed border-muted-foreground/25 flex items-center justify-center overflow-hidden bg-muted/50">
          {currentImage ? (
            <img
              src={currentImage}
              alt={label}
              className="h-full w-full object-contain"
              data-testid={`img-${testIdPrefix}`}
            />
          ) : (
            icon
          )}
        </div>
        <div className="flex-1 space-y-2">
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            disabled={isUploading}
            className="hidden"
            id={`file-${testIdPrefix}`}
            data-testid={`input-${testIdPrefix}-file`}
          />
          <Button
            type="button"
            variant="outline"
            disabled={disabled || isUploading}
            onClick={() => document.getElementById(`file-${testIdPrefix}`)?.click()}
            data-testid={`button-upload-${testIdPrefix}`}
          >
            <Upload className="h-4 w-4 mr-2" />
            {isUploading ? "Uploading..." : currentImage ? "Change Image" : "Upload Image"}
          </Button>
          {error && (
            <p className="text-sm text-destructive">{error.message}</p>
          )}
          {currentImage && (
            <p className="text-xs text-muted-foreground">Image uploaded successfully</p>
          )}
        </div>
      </div>
    </div>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  authentication: "Authentication",
  staff: "Staff Management",
  students: "Student Management",
  schools: "School Management",
  classes: "Classes",
  subjects: "Subjects",
  attendance: "Attendance",
  fees: "Fees & Payments",
  settings: "Settings",
  assessments: "Assessments",
  reports: "Reports",
};

const ACTION_LABELS: Record<string, string> = {
  login: "Logged In",
  logout: "Logged Out",
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  schedule_termination: "Scheduled Termination",
  restore: "Restored",
  import: "Imported",
  export: "Exported",
  send: "Sent",
  reset_password: "Reset Password",
};

const CATEGORY_COLORS: Record<string, string> = {
  authentication: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  staff: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  students: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  schools: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  settings: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
  assessments: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  reports: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
};

function ActivityLogsSection({ schoolId }: { schoolId?: number }) {
  const [page, setPage] = useState(0);
  const [category, setCategory] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const pageSize = 25;

  const queryParams = new URLSearchParams();
  if (category && category !== "all") queryParams.set("category", category);
  if (fromDate) queryParams.set("fromDate", fromDate);
  if (toDate) queryParams.set("toDate", toDate);
  if (schoolId) queryParams.set("schoolId", String(schoolId));
  queryParams.set("limit", String(pageSize));
  queryParams.set("offset", String(page * pageSize));

  const queryString = queryParams.toString();
  const { data, isLoading } = useQuery<{ logs: ActivityLog[]; total: number }>({
    queryKey: ["/api/activity-logs", schoolId, category, fromDate, toDate, page],
    queryFn: async () => {
      const res = await schoolFetch(`/api/activity-logs?${queryString}`);
      if (!res.ok) throw new Error("Failed to fetch logs");
      return res.json();
    },
  });

  const logs = data?.logs || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize);

  const handleExport = (format: "txt" | "csv") => {
    const exportParams = new URLSearchParams();
    if (category && category !== "all") exportParams.set("category", category);
    if (fromDate) exportParams.set("fromDate", fromDate);
    if (toDate) exportParams.set("toDate", toDate);
    if (schoolId) exportParams.set("schoolId", String(schoolId));
    exportParams.set("format", format);
    window.open(`/api/activity-logs/export?${exportParams.toString()}`, "_blank");
  };

  const formatTimestamp = (ts: string | Date | null) => {
    if (!ts) return "N/A";
    return new Date(ts).toLocaleString("en-US", {
      timeZone: "Africa/Harare",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  };

  const getRelativeTime = (ts: string | Date | null) => {
    if (!ts) return "";
    const now = Date.now();
    const diff = now - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return "";
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Activity Logs
          </CardTitle>
          <CardDescription>Track all system activities and changes for audit purposes</CardDescription>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" data-testid="button-export-logs">
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleExport("txt")} data-testid="button-export-txt">
              <FileText className="h-4 w-4 mr-2" />
              Download (.txt)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("csv")} data-testid="button-export-csv">
              <Download className="h-4 w-4 mr-2" />
              Download (.csv)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Category</Label>
            <Select value={category} onValueChange={(v) => { setCategory(v); setPage(0); }}>
              <SelectTrigger className="w-[180px]" data-testid="select-log-category">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">From Date</Label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => { setFromDate(e.target.value); setPage(0); }}
              className="w-[160px]"
              data-testid="input-from-date"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">To Date</Label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => { setToDate(e.target.value); setPage(0); }}
              className="w-[160px]"
              data-testid="input-to-date"
            />
          </div>
          {(category !== "all" || fromDate || toDate) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setCategory("all"); setFromDate(""); setToDate(""); setPage(0); }}
              data-testid="button-clear-filters"
            >
              Clear Filters
            </Button>
          )}
        </div>

        <div className="text-sm text-muted-foreground">
          {total} {total === 1 ? "record" : "records"} found
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="animate-pulse flex items-start gap-3 p-3 rounded-lg border">
                <div className="w-10 h-10 rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted rounded w-2/3" />
                  <div className="h-3 bg-muted rounded w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <ClipboardList className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No activity logs found</p>
            <p className="text-sm">Activity will appear here as users interact with the system</p>
          </div>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => (
              <div
                key={log.id}
                className="flex items-start gap-3 p-3 rounded-lg border"
                data-testid={`log-entry-${log.id}`}
              >
                <div className="flex-shrink-0 mt-0.5">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center ${
                    log.action === "login" || log.action === "logout" ? "bg-blue-100 dark:bg-blue-900" :
                    log.action === "create" ? "bg-green-100 dark:bg-green-900" :
                    log.action === "delete" || log.action === "schedule_termination" ? "bg-red-100 dark:bg-red-900" :
                    log.action === "restore" ? "bg-emerald-100 dark:bg-emerald-900" :
                    "bg-amber-100 dark:bg-amber-900"
                  }`}>
                    {log.action === "login" || log.action === "logout" ? (
                      <User className={`h-4 w-4 ${log.action === "login" ? "text-blue-600 dark:text-blue-300" : "text-blue-500 dark:text-blue-400"}`} />
                    ) : log.action === "create" ? (
                      <Plus className="h-4 w-4 text-green-600 dark:text-green-300" />
                    ) : log.action === "delete" || log.action === "schedule_termination" ? (
                      <Trash2 className="h-4 w-4 text-red-600 dark:text-red-300" />
                    ) : log.action === "update" ? (
                      <Pencil className="h-4 w-4 text-amber-600 dark:text-amber-300" />
                    ) : (
                      <Settings className="h-4 w-4 text-gray-600 dark:text-gray-300" />
                    )}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm" data-testid={`log-description-${log.id}`}>{log.description}</span>
                    <Badge variant="secondary" className={`text-xs ${CATEGORY_COLORS[log.category] || ""}`}>
                      {CATEGORY_LABELS[log.category] || log.category}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {log.userName || "System"}
                    </span>
                    {log.userRole && (
                      <span className="capitalize">{log.userRole.replace("_", " ")}</span>
                    )}
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatTimestamp(log.createdAt)}
                    </span>
                    {getRelativeTime(log.createdAt) && (
                      <span className="text-muted-foreground/70">({getRelativeTime(log.createdAt)})</span>
                    )}
                    {log.targetType && log.targetName && (
                      <span>
                        Target: {log.targetType} &mdash; {log.targetName}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <div className="text-sm text-muted-foreground">
              Page {page + 1} of {totalPages}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
                data-testid="button-prev-page"
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => p + 1)}
                data-testid="button-next-page"
              >
                Next
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
