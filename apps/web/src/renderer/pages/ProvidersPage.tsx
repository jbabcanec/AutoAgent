import { CheckCircle2, Plug } from "lucide-react";
import type { ProviderItem } from "../../lib/types.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "../components/EmptyState";

export function ProvidersPage({
  providers,
  onSetActive,
  activeProviderId
}: {
  providers: ProviderItem[];
  onSetActive: (providerId: string) => void;
  activeProviderId: string;
}): React.JSX.Element {
  if (providers.length === 0) {
    return (
      <EmptyState
        icon={Plug}
        title="No connections configured"
        description="Add a connection from the dashboard to get started."
      />
    );
  }
  return (
    <div className="space-y-3">
      {providers.map((provider) => {
        const isActive = activeProviderId === provider.id;
        return (
          <Card key={provider.id} className={isActive ? "ring-2 ring-primary" : ""}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{provider.displayName}</p>
                    {isActive ? <Badge variant="default">Active</Badge> : null}
                  </div>
                  <p className="text-xs text-muted-foreground">{provider.kind}</p>
                  <p className="text-xs text-muted-foreground">{provider.baseUrl}</p>
                  <p className="text-xs text-muted-foreground">
                    Model: {provider.defaultModel ?? "Not set"}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {provider.apiKeyStored ? (
                    <Badge variant="outline" className="text-emerald-700 border-emerald-300 gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Key stored
                    </Badge>
                  ) : (
                    <Badge variant="outline">No key</Badge>
                  )}
                </div>
              </div>
              {!isActive ? (
                <Button variant="outline" size="sm" className="mt-3" onClick={() => onSetActive(provider.id)}>
                  Set as Active
                </Button>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
