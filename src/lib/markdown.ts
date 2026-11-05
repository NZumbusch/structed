import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

export function renderMd(src: string): string {
  return DOMPurify.sanitize(marked.parse(src ?? '', { async: false }) as string);
}
