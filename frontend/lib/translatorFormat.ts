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

function normalizeTargetLanguage(targetLanguage?: string) {
  const lower = (targetLanguage || '').toLowerCase();
  if (lower.startsWith('zh')) return 'zh';
  if (lower.startsWith('ja')) return 'ja';
  if (lower.startsWith('en')) return 'en';
  return '';
}

function targetWrapperFor(sourceOpen: string, sourceClose: string, targetLanguage?: string): [string, string] {
  const target = normalizeTargetLanguage(targetLanguage);

  if (sourceOpen === '"' && sourceClose === '"' || sourceOpen === '“' && sourceClose === '”' || sourceOpen === '「' && sourceClose === '」') {
    if (target === 'en') return ['"', '"'];
    if (target === 'zh') return ['“', '”'];
    if (target === 'ja') return ['「', '」'];
  }

  if (sourceOpen === "'" && sourceClose === "'" || sourceOpen === '‘' && sourceClose === '’') {
    if (target === 'en') return ["'", "'"];
    if (target === 'zh') return ['‘', '’'];
    if (target === 'ja') return ['「', '」'];
  }

  if (sourceOpen === '(' && sourceClose === ')' || sourceOpen === '（' && sourceClose === '）') {
    if (target === 'en') return ['(', ')'];
    if (target === 'zh' || target === 'ja') return ['（', '）'];
  }

  return [sourceOpen, sourceClose];
}

export function preserveOuterWrapper(sourceText: string, translatedText: string, targetLanguage?: string) {
  const sourceTrimmed = sourceText.trim();
  let result = translatedText.trim();
  const wrapperPairs = [...ASCII_WRAPPER_PAIRS, ...LOCALIZED_WRAPPER_PAIRS];

  for (const [sourceOpen, sourceClose] of wrapperPairs) {
    if (!sourceTrimmed.startsWith(sourceOpen) || !sourceTrimmed.endsWith(sourceClose) || sourceTrimmed.length < sourceOpen.length + sourceClose.length) {
      continue;
    }

    for (const [resultOpen, resultClose] of wrapperPairs) {
      if (result.startsWith(resultOpen) && result.endsWith(resultClose)) {
        result = result.slice(resultOpen.length, result.length - resultClose.length).trim();
        break;
      }
    }

    const [targetOpen, targetClose] = targetWrapperFor(sourceOpen, sourceClose, targetLanguage);
    if (result.startsWith(targetOpen) && result.endsWith(targetClose)) {
      return result;
    }

    return `${targetOpen}${result}${targetClose}`;
  }

  return translatedText;
}

export function preserveBoundaryWhitespace(sourceText: string, translatedText: string) {
  const leading = sourceText.match(/^\s*/)?.[0] ?? '';
  const trailing = sourceText.match(/\s*$/)?.[0] ?? '';
  return `${leading}${translatedText.trim()}${trailing}`;
}

export function postProcessTranslationFormat(sourceText: string, translatedText: string, targetLanguage?: string) {
  const withProtectedTokens = preserveProtectedTokens(sourceText, translatedText);
  const withOuterWrapper = preserveOuterWrapper(sourceText, withProtectedTokens, targetLanguage);
  return preserveBoundaryWhitespace(sourceText, withOuterWrapper);
}
