import { ShoppingCart } from "lucide-react";
import { ComingSoonModulePage } from "@/components/coming-soon-module-page";

export default function ProductsPage() {
  return (
    <ComingSoonModulePage
      title="Products"
      description="The Products module is coming soon. The final module will be implemented in this same page file."
      icon={ShoppingCart}
    />
  );
}
