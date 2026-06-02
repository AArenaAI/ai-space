const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../../lib/translatorFormat.ts'), 'utf8');
const js = source
  .replace(/type PunctuationStyle = [^;]+;\n\n/g, '')
  .replace(/export function /g, 'function ')
  .replace(/const ASCII_WRAPPER_PAIRS: Array<\[string, string\]>/g, 'const ASCII_WRAPPER_PAIRS')
  .replace(/const LOCALIZED_WRAPPER_PAIRS: Array<\[string, string\]>/g, 'const LOCALIZED_WRAPPER_PAIRS')
  .replace(/: RegExp/g, '')
  .replace(/\?: string/g, '')
  .replace(/: PunctuationStyle/g, '')
  .replace(/: \[string, string\]/g, '')
  .replace(/: string\[\]/g, '')
  .replace(/: unknown/g, '')
  .replace(/: string/g, '');

const moduleScope = {};
Function('moduleScope', `${js}\nmoduleScope.postProcessTranslationFormat = postProcessTranslationFormat;`)(moduleScope);
const { postProcessTranslationFormat } = moduleScope;

const cases = [
  {
    name: 'localized Japanese quote restored to source ASCII quote',
    source: '"请告诉我。"',
    translated: '「教えてください。」',
    targetLanguage: 'ja',
    expected: '「教えてください。」',
  },
  {
    name: 'English ASCII quote maps to Chinese smart quote when provider drops it',
    source: '"Please let me know."',
    translated: '请告诉我。',
    targetLanguage: 'zh',
    expected: '“请告诉我。”',
  },
  {
    name: 'ASCII parentheses restored from fullwidth parentheses',
    source: '(hello)',
    translated: '（你好）',
    targetLanguage: 'en',
    expected: '(你好)',
  },
  {
    name: 'already correct wrapper preserved',
    source: '[hello]',
    translated: '[你好。]',
    expected: '[你好。]',
  },
  {
    name: 'no wrapper means no wrapper added',
    source: 'hello',
    translated: '你好。',
    expected: '你好。',
  },
  {
    name: 'no source wrapper means no wrapper added for short greeting',
    source: '你好',
    translated: 'Hello',
    expected: 'Hello',
  },
  {
    name: 'Chinese smart quotes mapped to English ASCII quotes when provider drops them',
    source: '“你好”',
    translated: 'Hello',
    targetLanguage: 'en',
    expected: '"Hello"',
  },
  {
    name: 'Japanese corner quotes mapped to English ASCII quotes when provider drops them',
    source: '「你好」',
    translated: 'Hello',
    targetLanguage: 'en',
    expected: '"Hello"',
  },
  {
    name: 'English ASCII quote maps to Chinese smart quote',
    source: '"Hello"',
    translated: '你好',
    targetLanguage: 'zh',
    expected: '“你好”',
  },
  {
    name: 'Chinese smart quote maps to French guillemets',
    source: '“你好”',
    translated: 'Bonjour',
    targetLanguage: 'fr',
    expected: '« Bonjour »',
  },
  {
    name: 'Chinese smart quote maps to German low-high quotes',
    source: '“你好”',
    translated: 'Hallo',
    targetLanguage: 'de',
    expected: '„Hallo“',
  },
  {
    name: 'Chinese smart quote maps to Korean smart quotes',
    source: '“你好”',
    translated: '안녕하세요',
    targetLanguage: 'ko',
    expected: '“안녕하세요”',
  },
  {
    name: 'Chinese smart quote maps to ASCII quotes for Spanish',
    source: '“你好”',
    translated: 'Hola',
    targetLanguage: 'es',
    expected: '"Hola"',
  },
  {
    name: 'fullwidth parentheses map to ASCII parentheses for French',
    source: '（必填）',
    translated: 'obligatoire',
    targetLanguage: 'fr',
    expected: '(obligatoire)',
  },
  {
    name: 'ASCII parentheses map to Korean fullwidth parentheses',
    source: '(required)',
    translated: '필수',
    targetLanguage: 'ko',
    expected: '（필수）',
  },
  {
    name: 'unknown target language keeps source wrapper shape',
    source: '“hello”',
    translated: 'hello',
    targetLanguage: 'xx',
    expected: '“hello”',
  },
  {
    name: 'boundary whitespace preserved',
    source: '\n  "hello"  \n',
    translated: '“你好。”',
    targetLanguage: 'zh',
    expected: '\n  “你好。”  \n',
  },
  {
    name: 'internal URL and punctuation untouched',
    source: '"Visit https://a.b/c?q=1."',
    translated: '「访问 https://a.b/c?q=1。」',
    targetLanguage: 'zh',
    expected: '“访问 https://a.b/c?q=1。”',
  },
  {
    name: 'inline code content restored by position',
    source: 'Run `npm run build` before deploying.',
    translated: '部署前运行 `npm run 构建`。',
    expected: '部署前运行 `npm run build`。',
  },
  {
    name: 'multiple inline code tokens restored by position',
    source: 'Use `fooBar` instead of `foo_bar`.',
    translated: '请使用 `fooBar`，而不是 `foo＿bar`。',
    expected: '请使用 `fooBar`，而不是 `foo_bar`。',
  },
  {
    name: 'url token restored when model localizes path/query punctuation',
    source: 'Open https://example.com/docs/api?lang=en for details.',
    translated: '打开 https://example.com/docs/API?lang=zh 查看详情。',
    expected: '打开 https://example.com/docs/api?lang=en 查看详情。',
  },
  {
    name: 'email token restored exactly',
    source: 'Contact support@example.com if needed.',
    translated: '如有需要，请联系 support＠example.com。',
    expected: '如有需要，请联系 support@example.com。',
  },
  {
    name: 'icu and handlebars placeholders restored exactly',
    source: 'Hello {userName}, your order {{order_id}} is ready.',
    translated: '你好 {用户名}，你的订单 {{订单_id}} 已准备好。',
    expected: '你好 {userName}，你的订单 {{order_id}} 已准备好。',
  },
  {
    name: 'dollar and uppercase snake placeholders restored exactly',
    source: 'Set $API_URL and CLIENT_SECRET before launch.',
    translated: '发布前设置 $接口地址 和 CLIENT＿SECRET。',
    expected: '发布前设置 $API_URL 和 CLIENT_SECRET。',
  },
  {
    name: 'token guard skipped when token counts differ',
    source: 'Use `alpha` and `beta`.',
    translated: '使用 `阿尔法`。',
    expected: '使用 `阿尔法`。',
  },
  {
    name: 'markdown link target restored while link text remains translated',
    source: 'Read [the guide](https://example.com/docs/get-started?lang=en).',
    translated: '阅读 [指南](https://example.com/docs/开始?lang=zh)。',
    expected: '阅读 [指南](https://example.com/docs/get-started?lang=en)。',
  },
  {
    name: 'html tags restored while inner text remains translated',
    source: '<strong class="warning">Delete</strong> this item.',
    translated: '<strong class="警告">删除</strong>此项目。',
    expected: '<strong class="warning">删除</strong>此项目。',
  },
  {
    name: 'fenced code block restored exactly',
    source: 'Example:\n```js\nconst greeting = "hello";\n```\nRun it.',
    translated: '示例：\n```js\nconst greeting = "你好";\n```\n运行它。',
    expected: '示例：\n```js\nconst greeting = "hello";\n```\n运行它。',
  },
  {
    name: 'markdown link guard skipped when link counts differ',
    source: 'Read [one](https://a.example) and [two](https://b.example).',
    translated: '阅读 [一个](https://a.example)。',
    expected: '阅读 [一个](https://a.example)。',
  },
];

for (const testCase of cases) {
  const actual = postProcessTranslationFormat(testCase.source, testCase.translated, testCase.targetLanguage);
  if (actual !== testCase.expected) {
    console.error(`FAIL ${testCase.name}`);
    console.error('expected:', JSON.stringify(testCase.expected));
    console.error('actual  :', JSON.stringify(actual));
    process.exit(1);
  }
}

console.log(`translator-format-regression: ${cases.length} cases passed`);
