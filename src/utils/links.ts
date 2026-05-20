import { promises as fs } from "fs";
import path from "path";
import { getAllMarkdownFiles } from "./files.js";

// Escape characters with special meaning in a RegExp source. Without this,
// a filename like ".*" or "(a+)+" turns the link-rewriter into a vault-wide
// content shredder (matches every link) or a ReDoS vector.
function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// In a String.prototype.replace replacement string, "$" is the only
// metacharacter ($1, $&, $$ etc.). Double it so literal "$" in a filename
// is preserved instead of being interpreted as a back-reference.
function escapeReplacement(input: string): string {
  return input.replace(/\$/g, "$$$$");
}

interface LinkUpdateOptions {
  filePath: string;
  oldPath: string;
  newPath?: string;
  isMovedToOtherVault?: boolean;
  isMovedFromOtherVault?: boolean;
  sourceVaultName?: string;
  destVaultName?: string;
}

/**
 * Updates markdown links in a file
 * @returns true if any links were updated
 */
export async function updateLinksInFile({
  filePath,
  oldPath,
  newPath,
  isMovedToOtherVault,
  isMovedFromOtherVault,
  sourceVaultName,
  destVaultName
}: LinkUpdateOptions): Promise<boolean> {
  const content = await fs.readFile(filePath, "utf-8");
  
  const oldName = path.basename(oldPath, ".md");
  const newName = newPath ? path.basename(newPath, ".md") : null;

  // Escape filename components going into the regex pattern, and any
  // value interpolated into the replacement string.
  const oldNameRe = escapeRegExp(oldName);
  const oldNameRepl = escapeReplacement(oldName);
  const newNameRepl = newName !== null ? escapeReplacement(newName) : null;
  const destVaultRepl = destVaultName ? escapeReplacement(destVaultName) : "";
  const sourceVaultRepl = sourceVaultName ? escapeReplacement(sourceVaultName) : "";

  let newContent: string;

  if (isMovedToOtherVault) {
    // Handle move to another vault - add vault reference
    newContent = content
      .replace(
        new RegExp(`\\[\\[${oldNameRe}(\\|[^\\]]*)?\\]\\]`, "g"),
        `[[${destVaultRepl}/${oldNameRepl}$1]]`
      )
      .replace(
        new RegExp(`\\[([^\\]]*)\\]\\(${oldNameRe}\\.md\\)`, "g"),
        `[$1](${destVaultRepl}/${oldNameRepl}.md)`
      );
  } else if (isMovedFromOtherVault) {
    // Handle move from another vault - add note about original location
    newContent = content
      .replace(
        new RegExp(`\\[\\[${oldNameRe}(\\|[^\\]]*)?\\]\\]`, "g"),
        `[[${newNameRepl}$1]] *(moved from ${sourceVaultRepl})*`
      )
      .replace(
        new RegExp(`\\[([^\\]]*)\\]\\(${oldNameRe}\\.md\\)`, "g"),
        `[$1](${newNameRepl}.md) *(moved from ${sourceVaultRepl})*`
      );
  } else if (!newPath) {
    // Handle deletion - strike through the links
    newContent = content
      .replace(
        new RegExp(`\\[\\[${oldNameRe}(\\|[^\\]]*)?\\]\\]`, "g"),
        `~~[[${oldNameRepl}$1]]~~`
      )
      .replace(
        new RegExp(`\\[([^\\]]*)\\]\\(${oldNameRe}\\.md\\)`, "g"),
        `~~[$1](${oldNameRepl}.md)~~`
      );
  } else {
    // Handle move/rename within same vault
    newContent = content
      .replace(
        new RegExp(`\\[\\[${oldNameRe}(\\|[^\\]]*)?\\]\\]`, "g"),
        `[[${newNameRepl}$1]]`
      )
      .replace(
        new RegExp(`\\[([^\\]]*)\\]\\(${oldNameRe}\\.md\\)`, "g"),
        `[$1](${newNameRepl}.md)`
      );
  }

  if (content !== newContent) {
    await fs.writeFile(filePath, newContent, "utf-8");
    return true;
  }
  
  return false;
}

/**
 * Updates all markdown links in the vault after a note is moved or deleted
 * @returns number of files updated
 */
export async function updateVaultLinks(
  vaultPath: string,
  oldPath: string | null | undefined,
  newPath: string | null | undefined,
  sourceVaultName?: string,
  destVaultName?: string
): Promise<number> {
  const files = await getAllMarkdownFiles(vaultPath);
  let updatedFiles = 0;

  // Determine the type of operation
  const isMovedToOtherVault: boolean = Boolean(oldPath !== null && newPath === null && sourceVaultName && destVaultName);
  const isMovedFromOtherVault: boolean = Boolean(oldPath === null && newPath !== null && sourceVaultName && destVaultName);

  for (const file of files) {
    // Skip the target file itself if it's a move operation
    if (newPath && file === path.join(vaultPath, newPath)) continue;
    
    if (await updateLinksInFile({
      filePath: file,
      oldPath: oldPath || "",
      newPath: newPath || undefined,
      isMovedToOtherVault,
      isMovedFromOtherVault,
      sourceVaultName,
      destVaultName
    })) {
      updatedFiles++;
    }
  }

  return updatedFiles;
}
