import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function TrialTaskRepo({
  onRun,
  disabled
}: {
  onRun: (input: { directory: string; objective: string }) => Promise<string>;
  disabled?: boolean;
}): React.JSX.Element {
  const [directory, setDirectory] = useState("c:\\Users\\josep\\Dropbox\\Babcanec Works\\Programming\\AutoAgent");
  const [objective, setObjective] = useState("Summarize risk areas and propose first implementation steps.");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function runTrial(): Promise<void> {
    setLoading(true);
    setError("");
    try {
      const text = await onRun({ directory, objective });
      setResult(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Repo trial failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Project Test</CardTitle>
        <CardDescription>Run a safe starter task on a local folder.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label>Project Folder</Label>
          <Input value={directory} onChange={(event) => setDirectory(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Task Description</Label>
          <Textarea rows={3} value={objective} onChange={(event) => setObjective(event.target.value)} />
        </div>
        <Button className="w-full" variant="outline" disabled={disabled || loading} onClick={() => void runTrial()}>
          {loading ? "Running..." : "Run Project Test"}
        </Button>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {result ? (
          <div className="rounded-md border bg-muted/50 p-4">
            <pre className="text-sm whitespace-pre-wrap">{result}</pre>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
