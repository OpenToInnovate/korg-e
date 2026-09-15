import { File, Folder, FolderOpen } from 'lucide-react';

const EXT_COLORS: Record<string, string> = {
  '.md': 'text-primary',
  '.json': 'text-orange',
  '.ts': 'text-primary',
  '.tsx': 'text-primary',
  '.js': 'text-orange',
  '.jsx': 'text-orange',
  '.yaml': 'text-purple',
  '.yml': 'text-purple',
  '.toml': 'text-purple',
  '.txt': 'text-muted-foreground',
  '.sh': 'text-green',
  '.css': 'text-info',
  '.html': 'text-orange',
  '.py': 'text-info',
  '.png': 'text-green',
  '.jpg': 'text-green',
  '.jpeg': 'text-green',
  '.gif': 'text-green',
  '.svg': 'text-green',
  '.webp': 'text-green',
};

export function FileIcon({ name, className }: { name: string; className?: string }) {
  const ext = name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : '';
  const color = EXT_COLORS[ext] || 'text-muted-foreground';
  return <File className={`${color} ${className || ''}`} size={14} />;
}

export function FolderIcon({ open, className }: { open: boolean; className?: string }) {
  const Icon = open ? FolderOpen : Folder;
  return <Icon className={`text-muted-foreground ${className || ''}`} size={14} />;
}
