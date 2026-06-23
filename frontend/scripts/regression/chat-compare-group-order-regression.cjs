const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

function loadGroupsModule() {
  const filePath = path.join(__dirname, '../../lib/groups.ts');
  const source = fs.readFileSync(filePath, 'utf8').replace(/^import \{ Message \} from "@\/lib\/chatTypes";\n/, '');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
    fileName: filePath,
  }).outputText;
  const mod = new Module(filePath, module);
  mod.filename = filePath;
  mod.paths = Module._nodeModulePaths(path.dirname(filePath));
  mod._compile(compiled, filePath);
  return mod.exports;
}

const { inferGroups } = loadGroupsModule();

function msg(id, role, content, extra = {}) {
  return {
    id: String(id),
    serverMessageId: id,
    role,
    content,
    createdAt: id,
    ...extra,
  };
}

function testAuthoritativeUserMessageIdKeepsLateAssistantWithOriginalPrompt() {
  const messages = [
    msg(100, 'user', 'first prompt'),
    msg(101, 'assistant', 'first prompt / model A', {
      model: 'model-a',
      groupId: 900,
      groupIndex: 0,
      groupModels: ['model-a', 'model-b'],
      userMessageId: 100,
    }),
    msg(200, 'user', 'second prompt'),
    msg(201, 'assistant', 'first prompt / model B finished late', {
      model: 'model-b',
      groupId: 900,
      groupIndex: 1,
      groupModels: ['model-a', 'model-b'],
      userMessageId: 100,
    }),
    msg(202, 'assistant', 'second prompt / model A', {
      model: 'model-a',
      groupId: 901,
      groupIndex: 0,
      groupModels: ['model-a', 'model-b'],
      userMessageId: 200,
    }),
  ];

  const groups = inferGroups(messages);
  assert.strictEqual(groups.length, 2);
  assert.strictEqual(groups[0].userMessage.id, '100');
  assert.deepStrictEqual(groups[0].assistantMessages.map((message) => message.id), ['101', '201']);
  assert.deepStrictEqual(groups[0].models, ['model-a', 'model-b']);
  assert.strictEqual(groups[1].userMessage.id, '200');
  assert.deepStrictEqual(groups[1].assistantMessages.map((message) => message.id), ['202']);
}

function testLegacyAdjacentGroupingStillWorks() {
  const messages = [
    msg(1, 'user', 'legacy first'),
    msg(2, 'assistant', 'legacy first answer', { model: 'model-a' }),
    msg(3, 'user', 'legacy second'),
    msg(4, 'assistant', 'legacy second answer', { model: 'model-b' }),
  ];

  const groups = inferGroups(messages);
  assert.strictEqual(groups.length, 2);
  assert.strictEqual(groups[0].userMessage.id, '1');
  assert.deepStrictEqual(groups[0].assistantMessages.map((message) => message.id), ['2']);
  assert.strictEqual(groups[1].userMessage.id, '3');
  assert.deepStrictEqual(groups[1].assistantMessages.map((message) => message.id), ['4']);
}

testAuthoritativeUserMessageIdKeepsLateAssistantWithOriginalPrompt();
testLegacyAdjacentGroupingStillWorks();
console.log('chat compare group order regression tests passed');
