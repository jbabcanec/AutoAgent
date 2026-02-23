import { Badge } from "@/components/ui/badge";

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  idle: { color: "bg-emerald-500", label: "Idle" },
  creating_run: { color: "bg-amber-500", label: "Creating" },
  approval_required: { color: "bg-blue-500", label: "Approval Required" },
  approved: { color: "bg-emerald-500", label: "Approved" },
  rejected: { color: "bg-red-500", label: "Rejected" },
  executing: { color: "bg-amber-500", label: "Executing" },
  completed: { color: "bg-emerald-500", label: "Completed" },
  failed: { color: "bg-red-500", label: "Failed" },
};

export function StatusBadge({ value }: { value: string }): React.JSX.Element {
  const config = STATUS_CONFIG[value] ?? { color: "bg-gray-400", label: value.replaceAll("_", " ") };
  return (
    <Badge variant="outline" className="gap-1.5 text-xs">
      <span className={`h-2 w-2 rounded-full ${config.color}`} />
      {config.label}
    </Badge>
  );
}
