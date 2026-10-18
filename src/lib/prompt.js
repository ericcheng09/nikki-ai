// Prompt for diary feedback (spec 5.5). Pure string building; the API
// call lives in gemini.js.
import { AUTO_LANGUAGE, resolveLanguageInput } from './languages.js'

// Copied verbatim from spec 5.5; prompt.test.js compares it with the spec
// so the two cannot drift apart.
export const PROMPT_TEMPLATE = `你是一位外語寫作老師。使用者正在學習外語，以下是他用外語撰寫的日記。{{LANGUAGE_INSTRUCTION}}

請分析這篇日記，提出以下項目：

1. 文法錯誤：附上正確或恰當的修改。若無明顯錯誤，此項回傳空陣列。
2. 句子不通順或可能造成誤會之處：附上恰當的修改建議。
3. 更貼近母語者日常使用的說法：針對日記中使用的句子或詞彙，若有更自然的說法，個別推薦 1 至 2 個範例。

規則：

- 日記中允許口語化的用法，不需要改成書面語。
- 分析須提供詳細的說明，並配合你從日記中判斷出的使用者程度。
- 所有說明一律使用繁體中文。
- 提供修改後的完整日記，以 ** 標示修改處。
- 提供修改後日記的中文翻譯。
- 只依指定的 JSON 格式回傳，不要加入其他文字。

日記內容：
"""
{{DIARY}}
"""`

const AUTO_INSTRUCTION = '請先判斷日記使用的語言。'

function languageInstruction(language) {
  // Missing or invalid values count as auto, like in the editor.
  const resolved = resolveLanguageInput(language)?.language ?? AUTO_LANGUAGE
  return resolved === AUTO_LANGUAGE ? AUTO_INSTRUCTION : `這篇日記使用的語言是${resolved}。`
}

// Fills the template in a single pass over the template itself, with a
// replacer function: inserted text is never scanned again (so a diary
// containing "{{DIARY}}" stays literal) and "$&"-style patterns are not
// interpreted. The diary content is inserted exactly as stored.
export function buildPrompt({ content, language } = {}) {
  const values = {
    LANGUAGE_INSTRUCTION: languageInstruction(language),
    DIARY: typeof content === 'string' ? content : '',
  }
  return PROMPT_TEMPLATE.replace(/\{\{(LANGUAGE_INSTRUCTION|DIARY)\}\}/g, (_, key) => values[key])
}
