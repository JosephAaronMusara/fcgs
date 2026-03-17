import { Bus } from "lucide-react";
import { ComingSoonModulePage } from "@/components/coming-soon-module-page";

export default function TransportPage() {
  return (
    <ComingSoonModulePage
      title="Transport"
      description="The Transport module is coming soon. This page is already wired into navigation and access rights, and the production implementation will replace this placeholder."
      icon={Bus}
    />
  );
}
