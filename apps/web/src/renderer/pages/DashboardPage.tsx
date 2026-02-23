import { AlertCircle, CheckCircle2, ListTodo, Play } from "lucide-react";
import type { DashboardStats, ProviderItem } from "../../lib/types.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GettingStartedChecklist } from "../components/GettingStartedChecklist";
import { QuickConnectCard } from "../components/QuickConnectCard";
import { StartTaskCard } from "../components/StartTaskCard";

export function DashboardPage({
  dashboard,
  providers,
  activeProviderId,
  playDirectory,
  playObjective,
  onSetActiveProvider,
  onQuickConnect,
  onChangeDirectory,
  onChangeObjective,
  onPlay,
  setupNotice,
  taskNotice
}: {
  dashboard: DashboardStats | null;
  providers: ProviderItem[];
  activeProviderId: string;
  playDirectory: string;
  playObjective: string;
  onSetActiveProvider: (providerId: string) => void;
  onQuickConnect: (input: {
    providerId: string;
    displayName: string;
    baseUrl: string;
    defaultModel: string;
    apiKey: string;
  }) => Promise<void>;
  onChangeDirectory: (value: string) => void;
  onChangeObjective: (value: string) => void;
  onPlay: () => Promise<void>;
  setupNotice: string | undefined;
  taskNotice: string | undefined;
}): React.JSX.Element {
  const hasConnectedKey = providers.some((provider) => provider.apiKeyStored);
  const hasStartedTask = (dashboard?.totalRuns ?? 0) > 0;
  const hasReviewedOutput = (dashboard?.completedRuns ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <KpiCard title="Tasks Created" value={dashboard?.totalRuns ?? 0} icon={ListTodo} />
        <KpiCard title="In Progress" value={dashboard?.activeRuns ?? 0} icon={Play} />
        <KpiCard title="Done" value={dashboard?.completedRuns ?? 0} icon={CheckCircle2} />
        <KpiCard title="Needs Approval" value={dashboard?.pendingApprovals ?? 0} icon={AlertCircle} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-4">
          <GettingStartedChecklist
            state={{
              hasConnectedKey,
              hasStartedTask,
              hasReviewedOutput
            }}
          />
          <QuickConnectCard
            providers={providers}
            activeProviderId={activeProviderId}
            onSetActiveProvider={onSetActiveProvider}
            onConnect={onQuickConnect}
            notice={setupNotice}
          />
        </div>
        <div className="space-y-4">
          <StartTaskCard
            directory={playDirectory}
            objective={playObjective}
            onDirectoryChange={onChangeDirectory}
            onObjectiveChange={onChangeObjective}
            onStartTask={onPlay}
            notice={taskNotice}
          />
        </div>
      </div>
    </div>
  );
}

function KpiCard({ title, value, icon: Icon }: { title: string; value: number; icon: React.ElementType }): React.JSX.Element {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
