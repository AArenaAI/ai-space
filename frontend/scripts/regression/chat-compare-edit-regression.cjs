#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const userContent = read("components/chat/UserMessageContent.tsx");
const messageList = read("components/chat/MessageList.tsx");
const editRuntime = read("hooks/useChatUserMessageEditRuntime.ts");
const compareRuntime = read("hooks/useChatCompareSendRuntime.ts");
const sendRuntime = read("hooks/useChatSendRuntime.ts");
const useChat = read("hooks/useChat.ts");

assert.equal(userContent.includes("发送中"), false, "user message must not render sending label");
assert.equal(userContent.includes("user-message-send-status"), false, "user message send status test id should be removed");
assert.equal(messageList.includes("canEditUserMessages && !effectiveIsCompare"), false, "Compare mode must not disable user edit actions");
assert.equal(editRuntime.includes("对比模式暂不支持编辑历史问题"), false, "edit runtime must not block Compare editing");
assert.match(editRuntime, /inferGroups\(messages\)/, "Compare edit should resolve the edited user group");
assert.match(editRuntime, /rerunCompareForEditedUserMessage\(\{/, "Compare edit should call the Compare rerun path");
assert.match(compareRuntime, /const rerunCompareForEditedUserMessage = useCallback/, "Compare send runtime should implement edit rerun helper");
assert.match(compareRuntime, /explicitGroupContext: groupContext/, "Compare edit rerun must reuse existing group/user context");
assert.match(compareRuntime, /modelMessages: toModelMessages\(baseMessages\)/, "Compare edit rerun should stream from truncated edited history");
assert.match(sendRuntime, /rerunCompareForEditedUserMessage/, "send runtime should expose Compare edit rerun helper");
assert.match(useChat, /rerunCompareForEditedUserMessage,/, "useChat should pass Compare edit rerun helper into edit runtime");
console.log("chat compare edit regression passed");
