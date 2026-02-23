import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ShellLayout({
  sidebar,
  title,
  onRefresh,
  children
}: {
  sidebar: ReactNode;
  title: string;
  onRefresh: () => void;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex h-full">
      {sidebar}
      <main className="flex-1 flex flex-col min-h-0">
        <header className="flex items-center justify-between px-6 py-3 border-b">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          <Button variant="outline" size="icon" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </header>
        <div className="flex-1 overflow-auto p-6">{children}</div>
      </main>
    </div>
  );
}
