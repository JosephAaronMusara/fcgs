import { Package } from "lucide-react";
import { ComingSoonModulePage } from "@/components/coming-soon-module-page";

export default function AssetsInventoryPage() {
  return (
    <ComingSoonModulePage
      title="Assets & Inventory"
      description="The Assets & Inventory workspace will group the Asset Register and Inventory tabs on one page."
      icon={Package}
    />
  );
}
