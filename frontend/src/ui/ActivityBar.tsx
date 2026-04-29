import {
  Database,
  FolderOpen,
  Globe,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Shapes,
} from 'lucide-react';
import type { SidebarPanel } from '../App';
import { Button } from '../components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';

interface ActivityBarProps {
  activePanel: SidebarPanel;
  onTogglePanel: (panel: SidebarPanel) => void;
  isSidebarVisible: boolean;
  onToggleSidebarVisibility: () => void;
}

const panels: { key: SidebarPanel; icon: typeof Shapes; label: string }[] = [
  { key: 'palette', icon: Shapes, label: 'Palette (types)' },
  { key: 'diagrams', icon: FolderOpen, label: 'Diagrams' },
  { key: 'gallery', icon: Globe, label: 'Diagram Gallery' },
  { key: 'schemas', icon: Database, label: 'Schemas' },
  { key: 'settings', icon: Settings2, label: 'Settings' },
];

export function ActivityBar({
  activePanel,
  onTogglePanel,
  isSidebarVisible,
  onToggleSidebarVisibility,
}: ActivityBarProps) {
  const sidebarToggleLabel = isSidebarVisible ? 'Hide sidebar (\u2318E)' : 'Show sidebar (\u2318E)';

  return (
    <TooltipProvider delayDuration={150}>
      <nav className="flex flex-col items-center w-12 shrink-0 py-2 gap-1 border-r border-border bg-background">
        {panels.map(({ key, icon: Icon, label }) => {
          const isActive = activePanel === key;
          return (
            <Tooltip key={key}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={label}
                  className={`relative h-10 w-10 ${
                    isActive
                      ? 'bg-accent/12 text-accent hover:bg-accent/12 hover:text-accent'
                      : 'text-muted-foreground hover:text-foreground hover:bg-surface-hover'
                  }`}
                  onClick={() => onTogglePanel(key)}
                >
                  {isActive && (
                    <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-accent" />
                  )}
                  <Icon size={18} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          );
        })}

        <div className="flex-1" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={sidebarToggleLabel}
              className={isSidebarVisible ? undefined : 'text-muted-foreground/60'}
              onClick={onToggleSidebarVisibility}
            >
              {isSidebarVisible ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{sidebarToggleLabel}</TooltipContent>
        </Tooltip>
      </nav>
    </TooltipProvider>
  );
}
