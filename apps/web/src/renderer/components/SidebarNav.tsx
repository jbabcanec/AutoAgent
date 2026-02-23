import type { ReactNode } from "react";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export interface NavItem {
  key: string;
  label: string;
  icon: React.ElementType;
}

export function SidebarNav({
  status,
  items,
  activeKey,
  onSelect
}: {
  status: ReactNode;
  items: NavItem[];
  activeKey: string;
  onSelect: (key: string) => void;
}): React.JSX.Element {
  return (
    <aside className="w-[260px] border-r bg-muted/40 flex flex-col p-4">
      <div className="flex items-center gap-2 px-2">
        <Zap className="h-5 w-5 text-primary" />
        <span className="text-lg font-semibold tracking-tight">AutoAgent</span>
      </div>
      <div className="mt-2 px-2">{status}</div>
      <Separator className="my-3" />
      <nav className="flex flex-col gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              key={item.key}
              variant={activeKey === item.key ? "secondary" : "ghost"}
              className="justify-start gap-2 w-full"
              onClick={() => onSelect(item.key)}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Button>
          );
        })}
      </nav>
    </aside>
  );
}
