const ASCII_WRAPPER_PAIRS: Array<[string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
  ['`', '`'],
];

const LOCALIZED_WRAPPER_PAIRS: Array<[string, string]> = [
  ['「', '」'],
  ['『', '』'],
  ['“', '”'],
  ['‘', '’'],
  ['（', '）'],
  ['［', '］'],
  ['｛', '｝'],
];

function uniqueMatches(value: string, pattern: RegExp) {
  const matches = value.match(pattern) ?? [];
  return Array.from(new Set(matches));
}

function replaceMatchedTokensByIndex(translatedText: string, translatedPattern: RegExp, sourceTokens: string[]) {
  const translatedTokens = translatedText.match(translatedPattern) ?? [];
  if (sourceTokens.length === 0 || translatedTokens.length !== sourceTokens.length) {
    return translatedText;
  }

  let index = 0;
  return translatedText.replace(translatedPattern, () => sourceTokens[index++] ?? '');
}

function stripTrailingTokenPunctuation(token: string) {
  return token.replace(/[.,!?。！？、，;；:：]+$/g, '');
}

function uniqueMatchesWithoutTrailingPunctuation(value: string, pattern: RegExp) {
  return uniqueMatches(value, pattern)
    .map(stripTrailingTokenPunctuation)
    .filter(Boolean);
}

export function preserveInlineCode(sourceText: string, translatedText: string) {
  const inlineCodePattern = /`[^`\n]+`/g;
  const sourceTokens = sourceText.match(inlineCodePattern) ?? [];
  return replaceMatchedTokensByIndex(translatedText, inlineCodePattern, sourceTokens);
}

export function preserveFencedCodeBlocks(sourceText: string, translatedText: string) {
  const fencedCodeBlockPattern = /```[\s\S]*?```/g;
  const sourceTokens = sourceText.match(fencedCodeBlockPattern) ?? [];
  return replaceMatchedTokensByIndex(translatedText, fencedCodeBlockPattern, sourceTokens);
}

export function preserveHtmlTags(sourceText: string, translatedText: string) {
  const htmlTagPattern = /<\/?[A-Za-z][^>\n]*>/g;
  const sourceTokens = sourceText.match(htmlTagPattern) ?? [];
  return replaceMatchedTokensByIndex(translatedText, htmlTagPattern, sourceTokens);
}

export function preserveMarkdownLinkTargets(sourceText: string, translatedText: string) {
  const markdownLinkPattern = /\[[^\]\n]+\]\(([^)\s]+)\)/g;
  const sourceTargets = Array.from(sourceText.matchAll(markdownLinkPattern), match => match[1]);
  const translatedMatches = Array.from(translatedText.matchAll(markdownLinkPattern));

  if (sourceTargets.length === 0 || translatedMatches.length !== sourceTargets.length) {
    return translatedText;
  }

  let index = 0;
  return translatedText.replace(markdownLinkPattern, (fullMatch, _target) => {
    const sourceTarget = sourceTargets[index++];
    return fullMatch.replace(/\([^)]*\)$/, `(${sourceTarget})`);
  });
}

export function preserveUrlsAndEmails(sourceText: string, translatedText: string) {
  const urlPattern = /https?:\/\/[^\s)\]}>"'`。！？、，；：]+/g;
  const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  const translatedEmailPattern = /\b[A-Z0-9._%+-]+[@＠][A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

  const withUrls = replaceMatchedTokensByIndex(
    translatedText,
    urlPattern,
    uniqueMatchesWithoutTrailingPunctuation(sourceText, urlPattern),
  );
  return replaceMatchedTokensByIndex(withUrls, translatedEmailPattern, uniqueMatches(sourceText, emailPattern));
}

export function preservePlaceholders(sourceText: string, translatedText: string) {
  const placeholderPattern = /\{\{[^{}\n]+\}\}|\{[A-Za-z_][A-Za-z0-9_]*\}|%\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Za-z_][A-Za-z0-9_]*|\b[A-Z][A-Z0-9]*_[A-Z0-9_]*\b/g;
  const translatedPlaceholderPattern = /\{\{[^{}\n]+\}\}|\{[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*\}|%\{[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*\}|\$[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*|\b[A-Z][A-Z0-9＿_]*[＿_][A-Z0-9＿_]*\b/g;
  return replaceMatchedTokensByIndex(
    translatedText,
    translatedPlaceholderPattern,
    uniqueMatches(sourceText, placeholderPattern),
  );
}

export function preserveProtectedTokens(sourceText: string, translatedText: string) {
  let result = translatedText;
  result = preserveFencedCodeBlocks(sourceText, result);
  result = preserveHtmlTags(sourceText, result);
  result = preserveMarkdownLinkTargets(sourceText, result);
  result = preserveInlineCode(sourceText, result);
  result = preserveUrlsAndEmails(sourceText, result);
  result = preservePlaceholders(sourceText, result);
  return result;
}

export function preserveOuterAsciiWrapper(sourceText: string, translatedText: string) {
  const sourceTrimmed = sourceText.trim();
  let result = translatedText.trim();

  for (const [open, close] of ASCII_WRAPPER_PAIRS) {
    if (!sourceTrimmed.startsWith(open) || !sourceTrimmed.endsWith(close) || sourceTrimmed.length < open.length + close.length) {
      continue;
    }

    if (result.startsWith(open) && result.endsWith(close)) {
      return result;
    }

    for (const [localOpen, localClose] of LOCALIZED_WRAPPER_PAIRS) {
      if (result.startsWith(localOpen) && result.endsWith(localClose)) {
        result = result.slice(localOpen.length, result.length - localClose.length).trim();
        return `${open}${result}${close}`;
      }
    }

    return `${open}${result}${close}`;
  }

  return translatedText;
}

export function preserveBoundaryWhitespace(sourceText: string, translatedText: string) {
  const leading = sourceText.match(/^\s*/)?.[0] ?? '';
  const trailing = sourceText.match(/\s*$/)?.[0] ?? '';
  return `${leading}${translatedText.trim()}${trailing}`;
}

export function postProcessTranslationFormat(sourceText: string, translatedText: string) {
  const withProtectedTokens = preserveProtectedTokens(sourceText, translatedText);
  const withOuterWrapper = preserveOuterAsciiWrapper(sourceText, withProtectedTokens);
  return preserveBoundaryWhitespace(sourceText, withOuterWrapper);
}
