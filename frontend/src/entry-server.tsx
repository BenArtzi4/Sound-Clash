import { StrictMode } from "react";
import { prerender } from "react-dom/static";
import { StaticRouter } from "react-router-dom";
import { AppRoutes } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { llmsFullTxt, llmsTxt } from "./seo/llms";
import { structuredDataFor } from "./seo/structuredData";

// Build-time renderer for the content pages (Home, How to play, the search
// landing pages). `npm run build` bundles this file for Node
// (`vite build --ssr`) and scripts/prerender.mjs calls render() once per
// pages.json entry marked `prerender`, writing the markup into that page's
// #root. Crawlers that never run JavaScript (Bing in part, every AI search
// crawler, link-preview bots) then read the page's real text, and a browser
// paints it before the bundle arrives; main.tsx hydrates it in place.
//
// The tree is App's tree with a StaticRouter in place of the BrowserRouter,
// so the markup is exactly what the client renders at that URL. `prerender`
// (not renderToString) waits for the lazy route chunks to resolve, so a lazy
// page is written out in full instead of as its Suspense fallback.

export type Rendered = {
  html: string;
};

export async function render(path: string): Promise<Rendered> {
  const { prelude } = await prerender(
    <StrictMode>
      <ErrorBoundary>
        <StaticRouter location={path}>
          <AppRoutes />
        </StaticRouter>
      </ErrorBoundary>
    </StrictMode>,
  );
  const html = await new Response(prelude).text();
  return { html };
}

export { llmsFullTxt, llmsTxt, structuredDataFor };
