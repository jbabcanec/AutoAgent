import type { SettingsItem } from "../../lib/types.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";

export function SettingsPage({
  settings,
  onUpdate
}: {
  settings: SettingsItem | null;
  onUpdate: (input: Partial<SettingsItem>) => Promise<void>;
}): React.JSX.Element {
  if (!settings) return <Skeleton className="h-32 w-full" />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Preferences</CardTitle>
        <CardDescription>Control how AutoAgent behaves.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="approval-toggle" className="flex flex-col gap-1 cursor-pointer">
            <span>Require approval for sensitive actions</span>
            <span className="text-sm text-muted-foreground font-normal">
              AutoAgent will pause and ask before running destructive commands.
            </span>
          </Label>
          <Switch
            id="approval-toggle"
            checked={settings.requireApproval}
            onCheckedChange={(checked) => void onUpdate({ requireApproval: checked })}
          />
        </div>
        <Separator />
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="max-tokens" className="flex flex-col gap-1">
            <span>Max response tokens</span>
            <span className="text-sm text-muted-foreground font-normal">
              Maximum tokens in LLM responses. Applies to all providers.
            </span>
          </Label>
          <Input
            id="max-tokens"
            type="number"
            min={1}
            max={200000}
            step={256}
            defaultValue={settings.maxTokens}
            onBlur={(e) => {
              const value = parseInt(e.target.value, 10);
              if (value > 0) void onUpdate({ maxTokens: value });
            }}
            className="w-28 text-right"
          />
        </div>
        <Separator />
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="routing-mode" className="flex flex-col gap-1">
            <span>Model routing mode</span>
            <span className="text-sm text-muted-foreground font-normal">
              Choose whether to optimize for latency, quality, or cost.
            </span>
          </Label>
          <select
            id="routing-mode"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={settings.routingMode ?? "balanced"}
            onChange={(event) =>
              void onUpdate({
                routingMode: event.target.value as "balanced" | "latency" | "quality" | "cost"
              })
            }
          >
            <option value="balanced">Balanced</option>
            <option value="latency">Latency-first</option>
            <option value="quality">Quality-first</option>
            <option value="cost">Cost-first</option>
          </select>
        </div>
      </CardContent>
    </Card>
  );
}
