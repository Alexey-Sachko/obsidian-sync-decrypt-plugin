export function joinVaultPath(targetFolder: string, relPath: string): string {
  const folder = targetFolder.replace(/^\/+|\/+$/g, "");
  const rel = relPath.replace(/^\/+/, "");
  return folder ? `${folder}/${rel}` : rel;
}
