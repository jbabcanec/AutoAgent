import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function StartTaskCard({
  directory,
  objective,
  onDirectoryChange,
  onObjectiveChange,
  onStartTask,
  notice
}: {
  directory: string;
  objective: string;
  onDirectoryChange: (value: string) => void;
  onObjectiveChange: (value: string) => void;
  onStartTask: () => Promise<void>;
  notice: string | undefined;
}): React.JSX.Element {
  const [submitting, setSubmitting] = useState(false);

  async function submit(): Promise<void> {
    setSubmitting(true);
    try {
      await onStartTask();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Start Task</CardTitle>
        <CardDescription>Define a task for AutoAgent to execute.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label>Project folder</Label>
          <div className="flex gap-2">
            <Input className="flex-1" value={directory} onChange={(event) => onDirectoryChange(event.target.value)} />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={async () => {
                const selected = await window.autoagent.dialogSelectDirectory();
                if (selected) onDirectoryChange(selected);
              }}
              title="Browse for folder"
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Task request</Label>
          <Textarea rows={3} value={objective} onChange={(event) => onObjectiveChange(event.target.value)} />
        </div>
        {notice ? (
          <Alert>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}
        <Button
          className={`w-full transition-all duration-300 ${submitting ? "scale-[0.98]" : ""}`}
          onClick={() => void submit()}
          disabled={submitting || !directory.trim() || !objective.trim()}
        >
          {submitting ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Launching task...
            </span>
          ) : (
            "Start Task"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
