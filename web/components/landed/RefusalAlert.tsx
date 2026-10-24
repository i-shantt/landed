"use client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { refusalLabel } from "@/lib/labels";

/** Renders a payment/release refusal in plain English, with the machine code as a secondary token. */
export function RefusalAlert({ reason, title = "Payment refused by the server" }: { reason: string; title?: string }) {
  return (
    <Alert variant="destructive" role="alert">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <span className="text-red-800 font-medium">{refusalLabel(reason)}</span>
        <span className="ml-2 font-mono text-[11px] opacity-70">{reason}</span>
      </AlertDescription>
    </Alert>
  );
}
