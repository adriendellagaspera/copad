import type { Node as PMNode, Mark } from 'prosemirror-model';

// ProseMirror types node/mark attrs as `any`; each function below is the single cast site for its attr.

export function headingLevel(node: PMNode): number {
  const raw = node.attrs['level'];
  return typeof raw === 'number' ? raw : 1;
}

export function linkHref(mark: Mark): string | null {
  const raw = mark.attrs['href'];
  return typeof raw === 'string' ? raw : null;
}

export function taskItemChecked(node: PMNode): boolean {
  return node.attrs['checked'] === true;
}
