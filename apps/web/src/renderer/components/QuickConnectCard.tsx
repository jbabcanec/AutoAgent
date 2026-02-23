import { useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import type { ProviderItem } from "../../lib/types.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface QuickConnectInput {
  providerId: string;
  displayName: string;
  baseUrl: string;
  defaultModel: string;
  apiKey: string;
}

export function QuickConnectCard({
  providers,
  activeProviderId,
  onSetActiveProvider,
  onConnect,
  notice
}: {
  providers: ProviderItem[];
  activeProviderId: string;
  onSetActiveProvider: (providerId: string) => void;
  onConnect: (input: QuickConnectInput) => Promise<void>;
  notice: string | undefined;
}): React.JSX.Element {
  const selected = useMemo(
    () => providers.find((provider) => provider.id === activeProviderId) ?? providers[0],
    [providers, activeProviderId]
  );
  const [apiKey, setApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(): Promise<void> {
    if (!selected || !apiKey.trim()) return;
    setIsSaving(true);
    setError("");
    try {
      await onConnect({
        providerId: selected.id,
        displayName: selected.displayName,
        baseUrl: selected.baseUrl,
        defaultModel: selected.defaultModel ?? "gpt-4o-mini",
        apiKey: apiKey.trim()
      });
      setApiKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save API key.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Quick Connect</CardTitle>
          {selected?.apiKeyStored ? (
            <Badge variant="outline" className="text-emerald-700 border-emerald-300 gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Key stored
            </Badge>
          ) : null}
        </div>
        <CardDescription>Connect an OpenAI-compatible API key.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label>Connection</Label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={selected?.id ?? ""}
            onChange={(event) => onSetActiveProvider(event.target.value)}
          >
            {providers.map((provider) => (
              <option value={provider.id} key={provider.id}>
                {provider.displayName}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>API key</Label>
          <Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-..." />
        </div>
        {notice ? (
          <Alert>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Button className="w-full" disabled={isSaving || !selected || !apiKey.trim()} onClick={() => void save()}>
          {isSaving ? "Saving..." : "Save API Key"}
        </Button>
      </CardContent>
    </Card>
  );
}
