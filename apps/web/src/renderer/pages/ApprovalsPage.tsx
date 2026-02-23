import { ShieldCheck } from "lucide-react";
import type { ApprovalItem } from "../../lib/types.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "../components/EmptyState";

export function ApprovalsPage({
  approvals,
  onResolve
}: {
  approvals: ApprovalItem[];
  onResolve: (approvalId: string, approved: boolean) => void;
}): React.JSX.Element {
  if (approvals.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No approvals waiting"
        description="When a task needs permission for a sensitive action, it will appear here."
      />
    );
  }
  return (
    <div className="space-y-3">
      {approvals.map((approval) => (
        <Card key={approval.id}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">{approval.reason}</p>
                <p className="text-xs text-muted-foreground">Run: {approval.runId}</p>
              </div>
              <Badge variant={approval.status === "pending" ? "secondary" : "outline"}>
                {approval.status}
              </Badge>
            </div>
            <div className="flex gap-2 mt-3">
              <Button size="sm" onClick={() => onResolve(approval.id, true)}>
                Approve
              </Button>
              <Button variant="destructive" size="sm" onClick={() => onResolve(approval.id, false)}>
                Reject
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
