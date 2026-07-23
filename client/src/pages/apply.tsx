import { useState } from "react";
import { ApplicationFormModal } from "@/components/application-form-modal";
import { Button } from "@/components/ui/button";

export default function ApplyPage() {
  const [open, setOpen] = useState(true);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-primary/5 p-4">
      <ApplicationFormModal open={open} onOpenChange={setOpen} />
      {!open && (
        <div className="text-center">
          <Button onClick={() => setOpen(true)} data-testid="button-reopen-form">
            Open Application Form
          </Button>
        </div>
      )}
    </div>
  );
}
