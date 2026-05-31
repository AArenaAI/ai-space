type MarkdownPlugin = unknown;

export interface MarkdownPlugins {
  remarkPlugins: MarkdownPlugin[];
  rehypePlugins: MarkdownPlugin[];
}

let cachedBasicPlugins: MarkdownPlugins | null = null;
let cachedMathPlugins: MarkdownPlugins | null = null;
let basicPluginPromise: Promise<MarkdownPlugins> | null = null;
let mathPluginPromise: Promise<MarkdownPlugins> | null = null;

export function contentMayContainMath(content: string) {
  return /(^|[^\\])\$\$?[\s\S]*?\$\$?|\\\(|\\\)|\\\[|\\\]/.test(content);
}

export function getCachedMarkdownPlugins(withMath: boolean) {
  return withMath ? cachedMathPlugins : cachedBasicPlugins;
}

export function loadMarkdownPlugins(withMath: boolean) {
  if (withMath && cachedMathPlugins) return Promise.resolve(cachedMathPlugins);
  if (!withMath && cachedBasicPlugins) return Promise.resolve(cachedBasicPlugins);

  if (!basicPluginPromise) {
    basicPluginPromise = Promise.all([
      import("remark-gfm").then((mod) => mod.default),
      import("@/lib/remark-fix-bold").then((mod) => mod.default),
    ]).then(([remarkGfm, remarkFixBold]) => {
      cachedBasicPlugins = {
        remarkPlugins: [remarkGfm, remarkFixBold],
        rehypePlugins: [],
      };
      return cachedBasicPlugins;
    });
  }

  if (!withMath) return basicPluginPromise;

  if (!mathPluginPromise) {
    mathPluginPromise = Promise.all([
      basicPluginPromise,
      import("remark-math").then((mod) => mod.default),
      import("rehype-katex").then((mod) => mod.default),
    ]).then(([basic, remarkMath, rehypeKatex]) => {
      cachedMathPlugins = {
        remarkPlugins: [...basic.remarkPlugins, remarkMath],
        rehypePlugins: [rehypeKatex],
      };
      return cachedMathPlugins;
    });
  }
  return mathPluginPromise;
}
