import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface TreeNode extends DirectoryEntry {
  children?: TreeNode[];
  loaded: boolean;
  expanded: boolean;
}

export function FileBrowserPage({
  rootDirectory
}: {
  rootDirectory: string;
}): React.JSX.Element {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [fileTruncated, setFileTruncated] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [loadingTree, setLoadingTree] = useState(true);

  useEffect(() => {
    if (!rootDirectory) return;
    setLoadingTree(true);
    window.autoagent.fsReadDirectory(rootDirectory).then((entries) => {
      setTree(entries.map((e): TreeNode => ({ ...e, loaded: false, expanded: false })));
      setLoadingTree(false);
    });
  }, [rootDirectory]);

  const toggleExpand = useCallback(
    async (nodePath: string) => {
      const node = findNode(tree, nodePath);
      if (!node || !node.isDirectory) return;

      if (!node.loaded) {
        const entries = await window.autoagent.fsReadDirectory(nodePath);
        const children: TreeNode[] = entries.map((e): TreeNode => ({
          ...e,
          loaded: false,
          expanded: false
        }));
        setTree((prev) => updateNodeInTree(prev, nodePath, { children, loaded: true, expanded: true }));
      } else {
        setTree((prev) => updateNodeInTree(prev, nodePath, { expanded: !node.expanded }));
      }
    },
    [tree]
  );

  const selectFile = useCallback(async (filePath: string) => {
    setSelectedFile(filePath);
    setLoadingFile(true);
    try {
      const result = await window.autoagent.fsReadFile(filePath);
      setFileContent(result.content);
      setFileTruncated(result.truncated);
    } catch {
      setFileContent("Failed to read file.");
      setFileTruncated(false);
    } finally {
      setLoadingFile(false);
    }
  }, []);

  if (!rootDirectory) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Set a project folder on the Home page to browse files.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex gap-4 h-[calc(100vh-8rem)]">
      <Card className="w-[320px] shrink-0 overflow-hidden flex flex-col">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FolderOpen className="h-4 w-4" />
            {rootDirectory.split(/[\\/]/).pop()}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-auto p-2">
          {loadingTree ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          ) : (
            <TreeView
              nodes={tree}
              onToggle={toggleExpand}
              onSelectFile={selectFile}
              selectedFile={selectedFile}
            />
          )}
        </CardContent>
      </Card>

      <Card className="flex-1 overflow-hidden flex flex-col">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium truncate">
            {selectedFile
              ? selectedFile.replace(rootDirectory, "").replace(/^[\\/]/, "")
              : "Select a file"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-auto p-0">
          {loadingFile ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          ) : selectedFile ? (
            <div className="relative">
              {fileTruncated && (
                <div className="sticky top-0 bg-yellow-50 text-yellow-800 text-xs px-4 py-1 border-b">
                  File truncated to 256 KB for display.
                </div>
              )}
              <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-words leading-relaxed">
                {fileContent}
              </pre>
            </div>
          ) : (
            <div className="p-8 text-center text-muted-foreground text-sm">
              Click a file in the tree to view its contents.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TreeView({
  nodes,
  onToggle,
  onSelectFile,
  selectedFile,
  depth = 0
}: {
  nodes: TreeNode[];
  onToggle: (path: string) => void;
  onSelectFile: (path: string) => void;
  selectedFile: string | null;
  depth?: number;
}): React.JSX.Element {
  return (
    <div>
      {nodes.map((node) => (
        <div key={node.path}>
          <button
            className={cn(
              "flex items-center gap-1 w-full text-left text-sm py-0.5 px-1 rounded hover:bg-muted transition-colors",
              !node.isDirectory && selectedFile === node.path && "bg-muted font-medium"
            )}
            style={{ paddingLeft: `${depth * 16 + 4}px` }}
            onClick={() => {
              if (node.isDirectory) {
                void onToggle(node.path);
              } else {
                void onSelectFile(node.path);
              }
            }}
          >
            {node.isDirectory ? (
              node.expanded ? (
                <ChevronDown className="h-3 w-3 shrink-0" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0" />
              )
            ) : (
              <span className="w-3 shrink-0" />
            )}
            {node.isDirectory ? (
              node.expanded ? (
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-blue-500" />
              ) : (
                <Folder className="h-3.5 w-3.5 shrink-0 text-blue-500" />
              )
            ) : (
              <File className="h-3 w-3 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{node.name}</span>
          </button>
          {node.isDirectory && node.expanded && node.children && (
            <TreeView
              nodes={node.children}
              onToggle={onToggle}
              onSelectFile={onSelectFile}
              selectedFile={selectedFile}
              depth={depth + 1}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function findNode(nodes: TreeNode[], targetPath: string): TreeNode | undefined {
  for (const node of nodes) {
    if (node.path === targetPath) return node;
    if (node.children) {
      const found = findNode(node.children, targetPath);
      if (found) return found;
    }
  }
  return undefined;
}

function updateNodeInTree(
  nodes: TreeNode[],
  targetPath: string,
  update: Partial<TreeNode>
): TreeNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return { ...node, ...update };
    }
    if (node.children) {
      return { ...node, children: updateNodeInTree(node.children, targetPath, update) };
    }
    return node;
  });
}
