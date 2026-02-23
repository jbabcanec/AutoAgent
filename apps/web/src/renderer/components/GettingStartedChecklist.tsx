import { CheckCircle2, Circle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ChecklistState {
  hasConnectedKey: boolean;
  hasStartedTask: boolean;
  hasReviewedOutput: boolean;
}

export function GettingStartedChecklist({ state }: { state: ChecklistState }): React.JSX.Element {
  const items = [
    { label: "Connect your API key", done: state.hasConnectedKey },
    { label: "Start your first task", done: state.hasStartedTask },
    { label: "Review results in Tasks", done: state.hasReviewedOutput }
  ];
  const completed = items.filter((i) => i.done).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Get Started</CardTitle>
          <span className="text-sm text-muted-foreground">
            {completed}/{items.length}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item) => (
          <div
            key={item.label}
            className={`flex items-center gap-3 rounded-md border p-3 text-sm ${
              item.done ? "border-emerald-200 bg-emerald-50" : ""
            }`}
          >
            {item.done ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <span className={item.done ? "text-emerald-900" : ""}>{item.label}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
