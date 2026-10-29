// scripts/prerender.mjs stamps each page it writes markup into with the path
// it rendered: <div id="root" data-prerendered="/how-to-play">. The markup can
// only be hydrated at that path; anywhere else it is a different page's HTML.
export function isPrerenderedFor(root: HTMLElement, pathname: string): boolean {
  const rendered = root.dataset.prerendered;
  if (rendered === undefined || !root.hasChildNodes()) return false;
  return rendered === (pathname.replace(/\/+$/, "") || "/");
}
