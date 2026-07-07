// Ensures a relative path never escapes a root directory (protects tools from ../../ traversal).
// Kept free of the vscode module so it can be unit-tested with plain Node.
import * as path from 'path';

export function resolveInside(root: string, rel: string): string {
  const abs = path.resolve(root, rel || '.');
  const normRoot = path.resolve(root);
  if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) {
    throw new Error(`Path "${rel}" escapes the project folder — refused.`);
  }
  return abs;
}
