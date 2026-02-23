import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function TrialTaskChat({
  onRun,
  disabled
}: {
  onRun: (prompt: string) => Promise<string>;
  disabled?: boolean;
}): React.JSX.Element {
  const [prompt, setPrompt] = useState("Explain this repository architecture in 5 bullets.");
  const [output, setOutput] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  async function handleRun(): Promise<void> {
    setLoading(true);
    setError("");
    try {
      const text = await onRun(prompt);
      setOutput(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chat trial failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Chat Test</CardTitle>
        <CardDescription>Verify your key and model are working.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label>Your prompt</Label>
          <Textarea rows={3} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        </div>
        <Button className="w-full" variant="outline" disabled={disabled || loading} onClick={() => void handleRun()}>
          {loading ? "Running..." : "Run Chat Test"}
        </Button>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {output ? (
          <div className="rounded-md border bg-muted/50 p-4">
            <p className="text-xs font-medium text-muted-foreground mb-2">Model Output</p>
            <pre className="text-sm whitespace-pre-wrap">{output}</pre>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
