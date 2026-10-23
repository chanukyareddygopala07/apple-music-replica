/** Not-found view. */

import { emptyStateHtml } from '@/ui/media'

export function renderNotFound(root: HTMLElement, path: string): void {
  root.innerHTML = `
    <h1 class="page-title">Page not found</h1>
    ${emptyStateHtml('search', `Nothing at ${path}`, 'The page you’re looking for doesn’t exist.', '<a class="btn btn-primary" href="/" data-nav>Go Home</a>')}`
}
